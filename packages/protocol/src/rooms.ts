/**
 * Registered Colyseus room names. One room equals one match (docs/DECISIONS.md
 * D7), so `MATCH_ROOM` is the room a player actually plays in and its lifetime
 * is the match's lifetime.
 *
 * `FOUNDATION_ROOM` (M0) stays alongside it as the connection-only probe: it
 * allocates no match, consumes no match seat, and starts no lobby countdown, so
 * it remains the cheap way for the client — and, later, a deployment health
 * check — to prove the socket path works without disturbing live play
 * (`docs/DECISIONS.md` D40).
 */
export const FOUNDATION_ROOM = "foundation_room";

export const MATCH_ROOM = "match_room";

export type RoomName = typeof FOUNDATION_ROOM | typeof MATCH_ROOM;
