/**
 * Runtime validation at the network boundary (`docs/DEVELOPMENT_RULES.md`;
 * technical plan §10.2, §33). Every untrusted payload — join options, every
 * inbound message, the health response — passes through exactly one function
 * here before any field is read.
 *
 * Two rules hold throughout: nothing is **coerced** (a wrong type is a
 * rejection, never a silent `Number(x)`), and nothing is **partially applied**
 * (a payload is accepted whole or not at all). `docs/DECISIONS.md` D23 comes due
 * in M4: `validateInputMessage` ships in the same change that first makes the
 * server consume `InputMessage` over a socket.
 */
import { HealthResponse } from "./http";
import {
  ClientHandshake,
  DiscardItemMessage,
  InputMessage,
  MatchJoinOptions,
  PointTotalsPayload,
  SecureItemMessage,
  SettlementMessage,
} from "./messages";
import { isBuildVersion } from "./version";

/**
 * Result of validating an untrusted value. A discriminated union so callers must
 * check `ok` before reading `value`, and get a human-readable `error` otherwise.
 */
export type ValidationResult<T> =
  { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: string };

function ok<T>(value: T): ValidationResult<T> {
  return { ok: true, value };
}

function fail<T>(error: string): ValidationResult<T> {
  return { ok: false, error };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// A protocol version is a small positive integer; reject anything else outright
// rather than coercing, so a malformed or hostile payload cannot slip through.
const MAX_PROTOCOL_VERSION = 1_000_000;

function isProtocolVersionValue(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isInteger(value) &&
    value >= 1 &&
    value <= MAX_PROTOCOL_VERSION
  );
}

/**
 * A per-client input counter. Bounded well below `Number.MAX_SAFE_INTEGER` so
 * an absurd value is refused rather than accepted and then compared against
 * every later input forever (a client that got `Number.MAX_SAFE_INTEGER`
 * accepted could never send another valid input, and neither could its
 * replacement session).
 */
const MAX_INPUT_SEQUENCE = 2_147_483_647;

/** Aim is an angle in radians; `Math.atan2` — what the client actually sends — is bounded by ±π. */
const MAX_AIM_ANGLE_RAD = Math.PI * 2;

/** Longest accepted content id. Ids in `@carry-or-fall/game-content` are short snake_case strings. */
const MAX_CONTENT_ID_LENGTH = 64;

/**
 * Longest accepted access token. A Supabase JWT is well under this; the cap
 * exists so a client cannot make the server allocate — and then forward to
 * Supabase Auth — an arbitrarily large string at the join boundary.
 */
const MAX_ACCESS_TOKEN_LENGTH = 4096;

/**
 * Upper bound on an id list arriving from the server (the account's unlock set).
 * Generous relative to the content table, tight enough that a malformed or
 * hostile payload cannot make the client allocate without limit.
 */
const MAX_CONTENT_ID_COUNT = 256;

function isMoveAxis(value: unknown): value is -1 | 0 | 1 {
  return value === -1 || value === 0 || value === 1;
}

function isBooleanValue(value: unknown): value is boolean {
  return typeof value === "boolean";
}

/** A slot index a client may name: an integer in `[0, slotCount)`. Rejects `-0.5`, `1.5`, `NaN`, and `6`. */
function isSlotIndex(value: unknown, slotCount: number): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 && value < slotCount;
}

/**
 * Validate an untrusted client handshake. This is the network-boundary check the
 * server runs before admitting a client: it enforces shape, types, and ranges
 * before any field is trusted, and never mutates or coerces the input.
 *
 * `contentVersion` became required in protocol version 2 (`docs/DECISIONS.md`
 * D34); a payload without it is refused, which is exactly how a pre-M4 browser
 * tab gets stopped at the join boundary.
 */
export function validateClientHandshake(input: unknown): ValidationResult<ClientHandshake> {
  if (!isRecord(input)) {
    return fail("client handshake must be an object");
  }

  if (!isProtocolVersionValue(input["protocolVersion"])) {
    return fail("client handshake protocolVersion must be a positive integer");
  }

  if (!isProtocolVersionValue(input["contentVersion"])) {
    return fail("client handshake contentVersion must be a positive integer");
  }

  if (!isBuildVersion(input["buildVersion"])) {
    return fail("client handshake buildVersion must be a valid build version string");
  }

  return ok({
    protocolVersion: input["protocolVersion"],
    contentVersion: input["contentVersion"],
    buildVersion: input["buildVersion"],
  });
}

/**
 * Validate untrusted match-room join options: the handshake plus the pre-run
 * skill selection. `maxSkillIds` is supplied by the caller (the room, from
 * `simulation-core`'s `MAX_SKILL_SLOTS`) so the slot budget has exactly one
 * source of truth and this package keeps its no-dependencies property.
 *
 * This bounds the payload only. Whether the named skills exist, are unique, and
 * fit the slot budget is decided by `createSkillLoadout` on the server — the
 * same function the client's picker uses, now run on the trusted side.
 */
export function validateMatchJoinOptions(
  input: unknown,
  maxSkillIds: number,
): ValidationResult<MatchJoinOptions> {
  const handshake = validateClientHandshake(input);
  if (!handshake.ok) {
    return fail(handshake.error);
  }

  // `isRecord` already held for the handshake to validate, but narrow again so
  // the index access below is type-safe rather than asserted.
  if (!isRecord(input)) {
    return fail("match join options must be an object");
  }

  const rawIds: unknown = input["skillLoadoutIds"];
  if (!Array.isArray(rawIds)) {
    return fail("match join options skillLoadoutIds must be an array");
  }
  if (rawIds.length > maxSkillIds) {
    return fail(`match join options skillLoadoutIds must hold at most ${String(maxSkillIds)} ids`);
  }
  const skillLoadoutIds: string[] = [];
  for (const id of rawIds) {
    if (typeof id !== "string" || id.length === 0 || id.length > MAX_CONTENT_ID_LENGTH) {
      return fail("match join options skillLoadoutIds must hold short non-empty strings");
    }
    skillLoadoutIds.push(id);
  }

  // The access token (M5). Bounded here; *authenticated* only by Supabase Auth,
  // in the server's `onAuth`. Two separate checks because neither can do the
  // other's job: this one cannot tell a forged token from a real one, and
  // Supabase should never be handed a megabyte of attacker-chosen string.
  //
  // `undefined` and `null` both mean "no session", which is legal on the wire —
  // the server decides whether a session is required, because that depends on
  // whether *it* has a Supabase project to verify against, which is not
  // something the protocol package can know.
  const rawToken: unknown = input["accessToken"];
  let accessToken: string | null = null;
  if (rawToken !== undefined && rawToken !== null) {
    if (typeof rawToken !== "string") {
      return fail("match join options accessToken must be a string when present");
    }
    if (rawToken.length === 0 || rawToken.length > MAX_ACCESS_TOKEN_LENGTH) {
      return fail(
        `match join options accessToken must be 1..${String(MAX_ACCESS_TOKEN_LENGTH)} characters`,
      );
    }
    accessToken = rawToken;
  }

  return ok({ ...handshake.value, skillLoadoutIds, accessToken });
}

/**
 * Validate an untrusted {@link InputMessage} (technical plan §10.2's "the server
 * validates numeric ranges … sequence order"). Shape and range only; frequency,
 * ordering, and allowed player state are the room's `InputGuard`, because they
 * depend on per-connection history this pure function does not have.
 *
 * Note what cannot be validated here because it cannot be expressed at all: the
 * message has no field for a position, a damage value, a hit, a pickup, an
 * extraction, or a reward. Extra properties on the payload are ignored — only
 * the fields below are ever read, so a client that bolts an `x`/`y` onto its
 * input is sending decoration, not state.
 */
export function validateInputMessage(input: unknown): ValidationResult<InputMessage> {
  if (!isRecord(input)) {
    return fail("input message must be an object");
  }

  const sequence = input["sequence"];
  if (
    typeof sequence !== "number" ||
    !Number.isInteger(sequence) ||
    sequence < 0 ||
    sequence > MAX_INPUT_SEQUENCE
  ) {
    return fail("input message sequence must be a non-negative integer within range");
  }

  if (!isMoveAxis(input["moveX"]) || !isMoveAxis(input["moveY"])) {
    return fail("input message moveX/moveY must be exactly -1, 0, or 1");
  }

  const aimAngle = input["aimAngle"];
  if (
    typeof aimAngle !== "number" ||
    !Number.isFinite(aimAngle) ||
    Math.abs(aimAngle) > MAX_AIM_ANGLE_RAD
  ) {
    return fail("input message aimAngle must be a finite angle in radians");
  }

  const attackPressed = input["attackPressed"];
  const secondaryAttackPressed = input["secondaryAttackPressed"];
  const dashPressed = input["dashPressed"];
  const interactPressed = input["interactPressed"];
  if (
    !isBooleanValue(attackPressed) ||
    !isBooleanValue(secondaryAttackPressed) ||
    !isBooleanValue(dashPressed) ||
    !isBooleanValue(interactPressed)
  ) {
    return fail("input message action flags must be booleans");
  }

  return ok({
    sequence,
    moveX: input["moveX"],
    moveY: input["moveY"],
    aimAngle,
    attackPressed,
    secondaryAttackPressed,
    dashPressed,
    interactPressed,
  });
}

/**
 * Validate an untrusted {@link SecureItemMessage}. `slotCount` is supplied by
 * the caller (the room, from `simulation-core`'s `INVENTORY_SIZE`), keeping one
 * source of truth for the inventory size.
 */
export function validateSecureItemMessage(
  input: unknown,
  slotCount: number,
): ValidationResult<SecureItemMessage> {
  if (!isRecord(input)) {
    return fail("secure_item message must be an object");
  }
  if (!isSlotIndex(input["sourceSlot"], slotCount)) {
    return fail(`secure_item sourceSlot must be an integer in [0, ${String(slotCount)})`);
  }
  return ok({ sourceSlot: input["sourceSlot"] });
}

/** Validate an untrusted {@link DiscardItemMessage}; same bounds as {@link validateSecureItemMessage}. */
export function validateDiscardItemMessage(
  input: unknown,
  slotCount: number,
): ValidationResult<DiscardItemMessage> {
  if (!isRecord(input)) {
    return fail("discard_item message must be an object");
  }
  if (!isSlotIndex(input["sourceSlot"], slotCount)) {
    return fail(`discard_item sourceSlot must be an integer in [0, ${String(slotCount)})`);
  }
  return ok({ sourceSlot: input["sourceSlot"] });
}

/**
 * Validate a {@link SettlementMessage} arriving at the **client** (M5).
 *
 * The server wrote it, but it still crosses a socket, so the client checks it
 * before rendering — the same treatment {@link validateHealthResponse} gives the
 * health body. A client that trusted this blindly would render whatever a
 * man-in-the-middle or a version-skewed server sent it as its account balance.
 *
 * Balances are bounded below at zero and required to be finite: they are
 * displayed as progression, and a `NaN` or a negative would be a visibly broken
 * account rather than a caught error.
 */
export function validateSettlementMessage(input: unknown): ValidationResult<SettlementMessage> {
  if (!isRecord(input)) {
    return fail("settlement message must be an object");
  }
  if (!isBooleanValue(input["alreadySettled"]) || !isBooleanValue(input["isAnonymous"])) {
    return fail("settlement message alreadySettled/isAnonymous must be booleans");
  }

  const balances = validatePointTotals(input["balances"]);
  if (!balances.ok) {
    return fail(balances.error);
  }

  const unlockIds = validateContentIdArray(input["unlockIds"], "unlockIds");
  if (!unlockIds.ok) {
    return fail(unlockIds.error);
  }
  const newUnlockIds = validateContentIdArray(input["newUnlockIds"], "newUnlockIds");
  if (!newUnlockIds.ok) {
    return fail(newUnlockIds.error);
  }

  return ok({
    alreadySettled: input["alreadySettled"],
    isAnonymous: input["isAnonymous"],
    balances: balances.value,
    unlockIds: unlockIds.value,
    newUnlockIds: newUnlockIds.value,
  });
}

/** The five point categories (concept §6), each a finite non-negative number. */
function validatePointTotals(input: unknown): ValidationResult<PointTotalsPayload> {
  if (!isRecord(input)) {
    return fail("point totals must be an object");
  }
  const categories = ["force", "precision", "motion", "guard", "signal"] as const;
  const totals: Record<string, number> = {};
  for (const category of categories) {
    const value = input[category];
    if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
      return fail(`point totals ${category} must be a finite non-negative number`);
    }
    totals[category] = value;
  }
  return ok(totals as unknown as PointTotalsPayload);
}

/** A bounded array of short content ids, with no cap on count beyond the content table's size. */
function validateContentIdArray(
  input: unknown,
  field: string,
): ValidationResult<readonly string[]> {
  if (!Array.isArray(input)) {
    return fail(`settlement message ${field} must be an array`);
  }
  if (input.length > MAX_CONTENT_ID_COUNT) {
    return fail(
      `settlement message ${field} must hold at most ${String(MAX_CONTENT_ID_COUNT)} ids`,
    );
  }
  const ids: string[] = [];
  for (const id of input) {
    if (typeof id !== "string" || id.length === 0 || id.length > MAX_CONTENT_ID_LENGTH) {
      return fail(`settlement message ${field} must hold short non-empty strings`);
    }
    ids.push(id);
  }
  return ok(ids);
}

/**
 * Validate an untrusted health-endpoint response. The client fetches `/health`
 * over HTTP (a network boundary), so the body is validated before it is trusted
 * or displayed, exactly like a message received over the socket.
 */
export function validateHealthResponse(input: unknown): ValidationResult<HealthResponse> {
  if (!isRecord(input)) {
    return fail("health response must be an object");
  }

  if (input["status"] !== "ok") {
    return fail('health response status must be "ok"');
  }

  if (!isBuildVersion(input["buildVersion"])) {
    return fail("health response buildVersion must be a valid build version string");
  }

  if (!isProtocolVersionValue(input["protocolVersion"])) {
    return fail("health response protocolVersion must be a positive integer");
  }

  const uptime = input["uptime"];
  if (typeof uptime !== "number" || !Number.isFinite(uptime) || uptime < 0) {
    return fail("health response uptime must be a non-negative number");
  }

  return ok({
    status: "ok",
    buildVersion: input["buildVersion"],
    protocolVersion: input["protocolVersion"],
    uptime,
  });
}
