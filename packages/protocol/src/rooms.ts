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

/**
 * The party room (M6, technical plan §8.4). One room is one party, capped at
 * three (concept §15.3).
 *
 * It is **not** a match and does not violate D7: it runs no simulation, holds
 * no world, and allocates no match seat of its own. What it holds is a roster,
 * a join code, and a leader — the smallest thing that can carry §8.4's seven
 * steps — and its one consequential action is asking the server to seat its
 * members into one `MATCH_ROOM` together.
 *
 * It is also not a lobby (`docs/DECISIONS.md` D57): there is no room browser,
 * no waiting for strangers, and nothing about a party is persisted. Rooms of
 * this name are addressed only by a join code the server minted, and Colyseus
 * exposes no route that lists them.
 */
export const PARTY_ROOM = "party_room";

export type RoomName = typeof FOUNDATION_ROOM | typeof MATCH_ROOM | typeof PARTY_ROOM;
