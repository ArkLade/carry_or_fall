/**
 * `@carry-or-fall/protocol` — the framework-agnostic contract shared by the
 * browser client and the authoritative server. It holds version constants, room
 * identifiers, message-type literals, payload interfaces, and runtime validators.
 *
 * It deliberately has no `@colyseus/schema` (or any runtime) dependency so it can
 * be imported safely from both ends without pulling networking code into either.
 */
export * from "./version";
export * from "./rooms";
export * from "./messages";
export * from "./party-code";
export * from "./http";
export * from "./validation";
