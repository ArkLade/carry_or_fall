/**
 * Wire protocol version shared by the client and the authoritative server.
 *
 * Bump this whenever the message contract changes in a way an older peer cannot
 * understand. The client sends its value at join time (see `ClientHandshake`)
 * so the server can refuse a stale client instead of letting it silently desync.
 */
export const PROTOCOL_VERSION = 1;

/**
 * Whether a peer reporting `peerVersion` speaks a compatible protocol. M0 uses
 * exact-match semantics; a later milestone may widen this to a supported range.
 */
export function isProtocolCompatible(peerVersion: number): boolean {
  return peerVersion === PROTOCOL_VERSION;
}

/**
 * Application-defined code the server returns when it refuses an incompatible
 * client at the join boundary. In the app-defined 4000+ range permitted for
 * WebSocket close/error codes.
 */
export const PROTOCOL_MISMATCH_CODE = 4001;

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
