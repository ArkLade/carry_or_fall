/**
 * Wire protocol version shared by the client and the authoritative server.
 *
 * Bump this whenever the message contract changes in a way an older peer cannot
 * understand. The client sends its value at join time (see `ClientHandshake`)
 * so the server can refuse a stale client instead of letting it silently desync.
 */
export const PROTOCOL_VERSION = 3;

/**
 * Whether a peer reporting `peerVersion` speaks a compatible protocol. M0 uses
 * exact-match semantics; a later milestone may widen this to a supported range.
 */
export function isProtocolCompatible(peerVersion: number): boolean {
  return peerVersion === PROTOCOL_VERSION;
}

/**
 * Whether a peer's content tables match the server's (technical plan §35's
 * third version). Activated in M4 (`docs/DECISIONS.md` D34): the client renders
 * melee arcs, projectile behavior, loot values, and point previews from its own
 * copy of `@carry-or-fall/game-content` while the server computes outcomes from
 * its copy, so a disagreement is a silent disagreement about game rules.
 *
 * Takes both versions rather than importing the content package, so this
 * package keeps its "no dependencies, shared by both ends" property
 * (`docs/PROTOCOL.md` §1). The caller supplies its own `CONTENT_VERSION`.
 * Exact-match semantics, like {@link isProtocolCompatible}.
 */
export function isContentCompatible(peerVersion: number, localVersion: number): boolean {
  return peerVersion === localVersion;
}

/**
 * Application-defined code the server returns when it refuses an incompatible
 * client at the join boundary. In the app-defined 4000+ range permitted for
 * WebSocket close/error codes.
 */
export const PROTOCOL_MISMATCH_CODE = 4001;

/**
 * Application-defined code the server closes a connection with after that
 * client has sent too many invalid or abusive messages (technical plan §33,
 * "temporary disconnect after repeated invalid behavior"). Distinct from
 * {@link PROTOCOL_MISMATCH_CODE} so a client can tell "you are out of date"
 * from "you were dropped", and so tests can assert which one happened.
 */
export const INVALID_MESSAGE_DISCONNECT_CODE = 4002;

/**
 * Application-defined code the server refuses a join with when the client's
 * identity or entitlements do not hold up (M5): an unverifiable access token, or
 * a loadout naming a skill the account has not unlocked (technical plan §19).
 *
 * Distinct from {@link PROTOCOL_MISMATCH_CODE} and
 * {@link INVALID_MESSAGE_DISCONNECT_CODE} because the remedy is different and
 * the client should say so: refreshing does not fix a locked skill, and
 * re-selecting a loadout does not fix an expired session.
 */
export const UNAUTHORIZED_JOIN_CODE = 4003;

/**
 * Message the server returns with {@link PROTOCOL_MISMATCH_CODE} when it refuses
 * an incompatible client. The technical plan §35 requires showing a
 * refresh/update prompt rather than letting a stale tab talk to a newer server.
 */
export const INCOMPATIBLE_CLIENT_MESSAGE =
  "Your game version is out of date. Please refresh the page to update.";

const MAX_BUILD_VERSION_LENGTH = 64;

// Semver core (major.minor.patch) with an optional pre-release/build suffix,
// e.g. "0.0.0-m0". Kept permissive on the suffix; length is bounded separately.
const BUILD_VERSION_PATTERN = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;

/**
 * Runtime guard for a build-version string. Used to reject malformed values that
 * arrive from configuration or across the network before they are trusted.
 */
export function isBuildVersion(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= MAX_BUILD_VERSION_LENGTH &&
    BUILD_VERSION_PATTERN.test(value)
  );
}
