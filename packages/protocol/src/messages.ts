/**
 * Shared client/server payload shapes.
 *
 * At join time the only thing a client tells the server is who it is and what
 * it chose before the match: the version handshake plus its pre-run skill
 * loadout, supplied as Colyseus *join options* so the server can refuse an
 * incompatible or illegal client before it ever occupies a seat (technical plan
 * §35; `docs/M4_ISSUES.md` §1.5).
 *
 * After joining, a client sends only intent (§2 below). The read models at the
 * bottom of this file describe what flows the other way: a **public**
 * {@link MatchView}, synchronized to every client, and a **private**
 * {@link LocalPlayerState}, sent only to its owner. They are separate types on
 * purpose — technical plan §10.3 requires filtering private data, and keeping
 * inventory out of the public type makes "a remote player has no inventory" a
 * fact the compiler knows rather than a rule a renderer has to remember.
 */

/**
 * Version handshake the client supplies as Colyseus join options. It reports only
 * information the client legitimately owns; the server never trusts a client for
 * anything beyond identifying its version. The server validates this at the join
 * boundary and rejects a malformed or incompatible client.
 *
 * `contentVersion` activated in M4 (`docs/DECISIONS.md` D34) — it was reserved
 * while there was no content whose disagreement could matter.
 */
export interface ClientHandshake {
  readonly protocolVersion: number;
  readonly contentVersion: number;
  readonly buildVersion: string;
}

/**
 * The full join-options payload for the match room: the handshake plus the
 * player's pre-run permanent skill selection (concept §8.3, chosen "before
 * entering the match").
 *
 * The loadout arrives at join rather than as a post-join message because the
 * match starts together and late join is disabled (technical plan §8.3), so
 * there is exactly one moment at which it can be chosen. The ids are untrusted
 * strings: the server re-validates them through the same `createSkillLoadout`
 * the client's picker uses, and refuses the join if they are illegal.
 */
export interface MatchJoinOptions extends ClientHandshake {
  readonly skillLoadoutIds: readonly string[];
  /**
   * The Supabase access token from the client's anonymous (or linked) session
   * (M5, technical plan §17.1). **This is the only thing the server accepts as
   * identity** — a client never sends a user id, because an id it could send is
   * an id it could choose.
   *
   * `null` when the client has no session, which happens only where no Supabase
   * project is configured (a fresh clone, CI, the browser suite). A server that
   * *is* configured refuses a null or unverifiable token at the join boundary
   * (`docs/DECISIONS.md` D45).
   *
   * Validation splits in two by necessity: this package bounds the *shape* (a
   * non-empty string under a length cap), and only Supabase Auth can judge
   * *authenticity*. Neither check is sufficient alone, and the server runs both.
   */
  readonly accessToken: string | null;
}

/**
 * Join options for the party room (M6, technical plan §8.4).
 *
 * `joinCode` is the whole of the routing decision a client gets to make:
 * `null` means "create a party and mint me a code", a string means "put me in
 * the party that answers to this code". Everything else about membership — who
 * leads, whether there is room, whether the code is still live — is the
 * server's, because technical plan §5.1 lists *party membership authorization*
 * among the things a client must not decide.
 *
 * The handshake, access token, and skill loadout are carried for the same
 * reasons the match room carries them, and are checked by the same functions:
 * a party member's loadout is the loadout they will bring into the match, so
 * an illegal or un-unlocked one is refused at the earliest honest moment rather
 * than when the party finally queues.
 */
export interface PartyJoinOptions extends ClientHandshake {
  /** `null` creates a new party; a code joins an existing one. */
  readonly joinCode: string | null;
  readonly skillLoadoutIds: readonly string[];
  /** As {@link MatchJoinOptions.accessToken} — the only thing accepted as identity. */
  readonly accessToken: string | null;
}

/**
 * Read model of the synchronized foundation-room state. This mirrors the fields
 * of the server-side Colyseus schema so the client can type `room.state` without
 * depending on `@colyseus/schema`. The server remains the sole authority over
 * these values; the client only ever reads them.
 */
export interface FoundationRoomState {
  readonly serverBuildVersion: string;
  readonly connectedPlayers: number;
}

/* ------------------------------------------------------------------ *
 * 1. Client → server message types
 * ------------------------------------------------------------------ */

/**
 * Message-type identifier for {@link InputMessage} (docs/PROTOCOL.md §6). M1
 * consumed it in-process; M4 makes it the authoritative wire message, validated
 * by `validateInputMessage` before any field is read.
 */
export const INPUT_MESSAGE_TYPE = "input";

/** Message-type identifier for {@link SecureItemMessage} (technical plan §14.2). */
export const SECURE_ITEM_MESSAGE_TYPE = "secure_item";

/** Message-type identifier for {@link DiscardItemMessage}. */
export const DISCARD_ITEM_MESSAGE_TYPE = "discard_item";

/**
 * Player input intent, matching docs/PROTOCOL.md §6 and the technical plan
 * §10.2 shape. The client reports only intent — which keys are held, where the
 * player aims, which actions were requested — never an outcome (see
 * `docs/DEVELOPMENT_RULES.md`, "Architecture and authority"). There is
 * deliberately no field on this type, or on any other, capable of expressing a
 * position, a damage number, a pickup, an extraction, or a reward.
 *
 * `secondaryAttackPressed` (the bow trigger) is folded in here rather than sent
 * as its own message, which `docs/PROTOCOL.md` §6's message table already
 * permits for discrete attack intents: it is a held-button state sampled every
 * tick, exactly like `attackPressed`.
 *
 * `sequence` is a per-client monotonic counter. The server drops any input
 * whose sequence does not strictly increase, which makes a replayed or
 * reordered packet inert (technical plan §10.2, "sequence order").
 */
export interface InputMessage {
  readonly sequence: number;
  readonly moveX: -1 | 0 | 1;
  readonly moveY: -1 | 0 | 1;
  readonly aimAngle: number;
  readonly attackPressed: boolean;
  readonly secondaryAttackPressed: boolean;
  readonly dashPressed: boolean;
  readonly interactPressed: boolean;
}

/**
 * Request to move the item in `sourceSlot` into the secure slot — the technical
 * plan §14.2 shape exactly. A one-shot command, sent on the keypress rather
 * than folded into the 20-per-second input message, so it is not resent every
 * tick while the key is held.
 *
 * The client names a *slot index*, never an item: it does not own the inventory
 * and cannot assert what is in it. The server checks the player is alive, the
 * slot holds something, and the secure slot is empty (§14.2), and refuses
 * otherwise.
 */
export interface SecureItemMessage {
  readonly sourceSlot: number;
}

/** Request to discard the item in `sourceSlot` (concept §7.1, "can be discarded"). */
export interface DiscardItemMessage {
  readonly sourceSlot: number;
}

/* ------------------------------------------------------------------ *
 * 1b. Client → server: party commands (M6)
 * ------------------------------------------------------------------ */

/**
 * Ask the server to seat this whole party into one match (technical plan §8.4
 * step 4). Leader only; the server checks that, not the client.
 */
export const QUEUE_MATCH_MESSAGE_TYPE = "queue_match";

/** Withdraw a queued party before its seats are consumed. Leader only. */
export const CANCEL_QUEUE_MESSAGE_TYPE = "cancel_queue";

/**
 * Mint a fresh join code, invalidating the previous one immediately. Leader
 * only. This is what makes a code's bounded lifetime usable rather than merely
 * restrictive (`docs/DECISIONS.md` D56): an expired code does not end the
 * party, it just needs replacing.
 */
export const REFRESH_JOIN_CODE_MESSAGE_TYPE = "refresh_join_code";

/** Leave the party deliberately. Any member. */
export const LEAVE_PARTY_MESSAGE_TYPE = "leave_party";

/**
 * Every party command in one union, because they share a shape: **no fields at
 * all**.
 *
 * That is the point rather than an omission. A command that named a member
 * would be a client asserting something about another player, and technical
 * plan §5.1 forbids exactly that for party membership. "Queue us", "cancel",
 * "new code", "I am leaving" each need no subject: the sender is the subject,
 * and the server knows who the sender is because it assigned the session.
 *
 * They are still validated. An empty body arriving over a socket is untrusted
 * like any other, and `validatePartyCommandMessage` refuses anything that is
 * not an object — so a client sending `null`, an array, or a number gets the
 * same treatment as one sending a malformed input message.
 */
export type PartyCommandMessage = Record<string, never>;

/* ------------------------------------------------------------------ *
 * 2. Server → client: the public synchronized read model
 * ------------------------------------------------------------------ */

/**
 * Message-type identifier for the per-owner private-state message. Sent only to
 * the client it describes, and only when that state changes.
 */
export const PRIVATE_STATE_MESSAGE_TYPE = "player_private";

/** Room lifecycle phase (technical plan §8.2), surfaced so the client can show what the match is doing. */
export type MatchPhase = "waiting" | "countdown" | "running" | "ending";

const MATCH_PHASES: readonly string[] = ["waiting", "countdown", "running", "ending"];

/**
 * Narrow a phase string read out of synchronized state. The value crosses a
 * network boundary, so it is checked before it is trusted — even though the
 * server is the one that wrote it.
 */
export function isMatchPhase(value: unknown): value is MatchPhase {
  return typeof value === "string" && MATCH_PHASES.includes(value);
}

/**
 * The public view of one player — technical plan §10.3's list, minus everything
 * private. Every client receives one of these per player in the room.
 * `extractionProgressMs` is public because concept §17.2 wants extraction to
 * "notify nearby players".
 *
 * The in-flight melee swing is flattened into `swing*` fields rather than a
 * nested object, so this interface is exactly the shape of the synchronized
 * schema and no lossy conversion sits between the two.
 * `swingRangePx`/`swingArcDegrees` are the *effective*, post-skill, post-loot
 * values the server actually resolved hits against, so the arc a player sees
 * drawn is the arc that hit (technical plan §13.2).
 */
export interface PlayerView {
  readonly id: string;
  readonly x: number;
  readonly y: number;
  readonly radius: number;
  readonly facing: number;
  readonly health: number;
  readonly maxHealth: number;
  readonly shieldHp: number;
  readonly alive: boolean;
  /** True once this player's run has ended (died or extracted); they are inert. */
  readonly runOver: boolean;
  /** False while the player is disconnected but still occupying the room (technical plan §34.1). */
  readonly connected: boolean;
  readonly extractionProgressMs: number;
  /** Whether a melee swing is in its active (hit-resolving, drawn) window right now. */
  readonly swingActive: boolean;
  readonly swingOriginX: number;
  readonly swingOriginY: number;
  readonly swingFacing: number;
  readonly swingRangePx: number;
  readonly swingArcDegrees: number;
}

export interface EnemyView {
  readonly id: string;
  readonly x: number;
  readonly y: number;
  readonly radius: number;
  readonly health: number;
  readonly maxHealth: number;
  readonly stunnedMs: number;
}

/**
 * A live projectile. Carries the four skill-behavior fields the renderer turns
 * into its visual cues (`apps/client/src/render/world-view.ts`), because
 * concept §13.3 requires those behaviors to stay distinguishable.
 */
export interface ProjectileView {
  readonly id: string;
  readonly ownerId: string;
  readonly x: number;
  readonly y: number;
  readonly velocityX: number;
  readonly velocityY: number;
  readonly radius: number;
  readonly bouncesRemaining: number;
  readonly piercesRemaining: number;
  readonly canReturn: boolean;
  readonly returnsSoFar: number;
  readonly homingStrength: number;
}

/** Ground loot. `lootId` is a content id the client looks up locally — a definition, not authority. */
export interface GroundLootView {
  readonly id: string;
  readonly x: number;
  readonly y: number;
  readonly radius: number;
  readonly lootId: string;
}

/** A wildcard skill chip. `skillId` is a content id, like {@link GroundLootView.lootId}. */
export interface SkillChipView {
  readonly id: string;
  readonly x: number;
  readonly y: number;
  readonly radius: number;
  readonly skillId: string;
}

export interface ExtractionPointView {
  readonly id: string;
  readonly x: number;
  readonly y: number;
  readonly radius: number;
  readonly remainingActiveMs: number;
}

/**
 * A synchronized keyed collection, as the Colyseus client SDK decodes it. This
 * is the read side of the server's `MapSchema`, described structurally so the
 * browser client can type `room.state` without importing `@colyseus/schema`
 * (the same approach {@link FoundationRoomState} already takes for scalars).
 */
export interface SyncedCollection<T> {
  readonly size: number;
  forEach(callback: (value: T, key: string) => void): void;
  get(key: string): T | undefined;
  has(key: string): boolean;
  keys(): IterableIterator<string>;
  values(): IterableIterator<T>;
}

/**
 * Read model of the synchronized match-room state — the mirror of the server's
 * `MatchState` schema. `phase` is typed `string` rather than {@link MatchPhase}
 * because that is genuinely what the wire carries; narrow it with
 * {@link isMatchPhase} at the boundary.
 */
export interface MatchRoomState {
  readonly phase: string;
  readonly arenaId: string;
  readonly serverBuildVersion: string;
  readonly seed: number;
  readonly tick: number;
  readonly countdownRemainingMs: number;
  readonly matchRemainingMs: number;
  readonly players: SyncedCollection<PlayerView>;
  readonly enemies: SyncedCollection<EnemyView>;
  readonly projectiles: SyncedCollection<ProjectileView>;
  readonly groundLoot: SyncedCollection<GroundLootView>;
  readonly skillChips: SyncedCollection<SkillChipView>;
  readonly extractionPoints: SyncedCollection<ExtractionPointView>;
}

/**
 * One authoritative snapshot of the match, as the client sees it. Built from
 * {@link MatchRoomState}; the client renders it and never steps it.
 *
 * `arenaId` names the `ArenaDefinition` in `@carry-or-fall/game-content` whose
 * walls both ends draw and collide against — shared *definitions*, with
 * authority staying on the server (technical plan §7.1). `seed` is published
 * for diagnostics; §9.4 already records the seed with match results, and it only
 * determines placements the players can see.
 */
export interface MatchView {
  readonly phase: MatchPhase;
  readonly arenaId: string;
  readonly serverBuildVersion: string;
  readonly seed: number;
  readonly tick: number;
  /** Milliseconds left in the lobby countdown; 0 outside the `countdown` phase. */
  readonly countdownRemainingMs: number;
  /** Milliseconds left in the match (concept §22.3's maximum duration). */
  readonly matchRemainingMs: number;
  readonly players: readonly PlayerView[];
  readonly enemies: readonly EnemyView[];
  readonly projectiles: readonly ProjectileView[];
  readonly groundLoot: readonly GroundLootView[];
  readonly skillChips: readonly SkillChipView[];
  readonly extractionPoints: readonly ExtractionPointView[];
}

/* ------------------------------------------------------------------ *
 * 3. Server → client: the private, per-owner read model
 * ------------------------------------------------------------------ */

/** The five progression point categories (concept §6), as they cross the wire. */
export interface PointTotalsPayload {
  readonly force: number;
  readonly precision: number;
  readonly motion: number;
  readonly guard: number;
  readonly signal: number;
}

/**
 * The outcome of one player's finished run. Computed once by the server when
 * the run ends and never recomputed. Not persisted anywhere in M4 — there is no
 * storage until M5 (`docs/DECISIONS.md` D9, D22, D27).
 */
export interface RunResultPayload {
  readonly outcome: "extracted" | "died";
  readonly pointsGained: PointTotalsPayload;
  readonly itemsConverted: number;
  readonly itemsLost: number;
}

/**
 * Message-type identifier for the per-owner settlement result (M5). Sent to one
 * client after their finished run has been **written**, so receiving it means
 * the points are in the account, not that the server intends to put them there.
 */
export const SETTLEMENT_MESSAGE_TYPE = "settlement";

/**
 * What a player's account looks like after their run was settled (M5,
 * `docs/DATA_MODEL.md` §4.3). Server → client only; there is no client → server
 * counterpart, and that absence is the point — no message a client can send
 * carries a point value, an unlock, or an outcome, so there is no reward claim
 * for the server to check (`docs/DATA_MODEL.md` §6).
 *
 * `alreadySettled` is honest rather than cosmetic: a retry or a recovery that
 * found the run already settled awards nothing, and the client says "already
 * recorded" instead of animating a second payout for points it did not just
 * earn.
 */
export interface SettlementMessage {
  readonly alreadySettled: boolean;
  readonly balances: PointTotalsPayload;
  /** Every unlock id the account holds after this settlement. */
  readonly unlockIds: readonly string[];
  /** Only the ids this settlement newly granted; empty on a repeat. */
  readonly newUnlockIds: readonly string[];
  /** Whether this account is anonymous, and therefore unrecoverable (technical plan §17.3). */
  readonly isAnonymous: boolean;
}

/**
 * Everything about a player that only that player may see (technical plan
 * §10.3: "other clients do not need to receive another player's complete
 * inventory"). Delivered as a {@link PRIVATE_STATE_MESSAGE_TYPE} message to one
 * client, and deliberately **absent from the synchronized schema entirely**, so
 * there is no filtering rule to get wrong — the data is never in the document
 * other clients receive.
 *
 * Items and skills are content ids, resolved locally against
 * `@carry-or-fall/game-content` for display. `inventory` is a fixed-length
 * array whose `null` entries are empty slots.
 */
export interface LocalPlayerState {
  readonly playerId: string;
  readonly inventory: readonly (string | null)[];
  readonly secureSlotItemId: string | null;
  readonly skillIds: readonly string[];
  readonly wildcardSkillId: string | null;
  readonly runResult: RunResultPayload | null;
  /**
   * The **other** members of this player's party who are in this match right
   * now (M6; concept §8.4 step 6's "shared visual identifiers", §23.1's "party
   * status"). Empty for a solo player.
   *
   * This rides on the private message rather than the synchronized schema, and
   * that placement is the security claim (`docs/DECISIONS.md` D58): a non-party
   * client is told nothing — not a party id, not a colour, not a count — and a
   * party member is told only ids it already has from its own party roster, of
   * players already visible in the public snapshot. The marker drawn from this
   * grants no authority: no message a client may send becomes valid or invalid
   * because of it.
   */
  readonly partyMemberIds: readonly string[];
}

/* ------------------------------------------------------------------ *
 * 4. Server → client: the party room (M6)
 * ------------------------------------------------------------------ */

/** What a party is doing (technical plan §8.4; `docs/M6_ISSUES.md` §4). */
export type PartyStatus = "forming" | "queued" | "in_match";

const PARTY_STATUSES: readonly string[] = ["forming", "queued", "in_match"];

/** Narrow a status read out of synchronized state, at the boundary, before it is trusted. */
export function isPartyStatus(value: unknown): value is PartyStatus {
  return typeof value === "string" && PARTY_STATUSES.includes(value);
}

/** Concept §15.3: "maximum three players". */
export const MAX_PARTY_SIZE = 3;

/**
 * One party member, as the other members see them.
 *
 * Note what is absent, and why it is absent rather than filtered: no access
 * token, no account id, no point balance, no unlock list, no inventory. Being
 * in someone's party is not a licence to read their account
 * (`docs/M6_ISSUES.md` §1.6), so none of it is put in the document the party
 * receives. A name and a connection light is the whole of it.
 */
export interface PartyMemberView {
  /** The member's party-room session id — not their account id, and not their match session id. */
  readonly sessionId: string;
  /** Server-generated (technical plan §17.1); a client never supplies one. */
  readonly displayName: string;
  readonly isLeader: boolean;
  /** False while the member is disconnected but still inside their reconnect window. */
  readonly connected: boolean;
}

/** Read model of the synchronized party-room state — the mirror of the server's `PartyState`. */
export interface PartyRoomState {
  readonly joinCode: string;
  readonly leaderSessionId: string;
  /** One of {@link PartyStatus}; typed `string` because that is what the wire carries. */
  readonly status: string;
  /** Milliseconds until the current join code expires; 0 once it has. */
  readonly joinCodeExpiresInMs: number;
  readonly members: SyncedCollection<PartyMemberView>;
}

/** One snapshot of the party, as the client renders it. */
export interface PartyView {
  readonly joinCode: string;
  readonly leaderSessionId: string;
  readonly status: PartyStatus;
  readonly joinCodeExpiresInMs: number;
  readonly members: readonly PartyMemberView[];
}

/**
 * Message-type identifier for the seat this member has been given in a match
 * (M6). Sent to each member individually once the whole party's seats have been
 * reserved together.
 */
export const MATCH_READY_MESSAGE_TYPE = "match_ready";

/**
 * A Colyseus seat reservation, as it crosses to the client.
 *
 * This is the payload that makes "a party lands in one room, every time" true
 * (`docs/M6_ISSUES.md` §1.2): the seat is already held when this arrives, so
 * the member's join is no longer racing anyone for it. The client turns it into
 * a connection with `consumeSeatReservation`.
 *
 * It is validated on arrival like any other message. That is not a formality —
 * `roomId` is what the client opens a socket to, and `sessionId` is the
 * identity it will hold in the match.
 */
export interface SeatReservationPayload {
  readonly name: string;
  readonly sessionId: string;
  readonly roomId: string;
  readonly processId: string;
  readonly publicAddress?: string;
}

/** What the server sends a party member once their seat is held. */
export interface MatchReadyMessage {
  readonly seatReservation: SeatReservationPayload;
}

/** Message-type identifier for a party action the server refused. */
export const PARTY_ERROR_MESSAGE_TYPE = "party_error";

/** Why a party action was refused. Coarse on purpose — see {@link PartyErrorMessage}. */
export type PartyErrorCode = "not_leader" | "already_queued" | "no_room_available" | "party_empty";

const PARTY_ERROR_CODES: readonly string[] = [
  "not_leader",
  "already_queued",
  "no_room_available",
  "party_empty",
];

export function isPartyErrorCode(value: unknown): value is PartyErrorCode {
  return typeof value === "string" && PARTY_ERROR_CODES.includes(value);
}

/**
 * A refused party action, with a message the panel shows verbatim.
 *
 * The codes are coarse deliberately. A refusal that distinguished "there is no
 * such party" from "that party is full" from "that code expired" would answer
 * questions for whoever is guessing codes; those three are all refused at the
 * join boundary with one code and one message instead (`docs/DECISIONS.md`
 * D56), and this type covers only failures *inside* a party a member already
 * belongs to.
 */
export interface PartyErrorMessage {
  readonly code: PartyErrorCode;
  readonly message: string;
}
