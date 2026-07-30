/**
 * Registered Colyseus room names. M0 defines a single connection-only room; one
 * room equals one match in later milestones (see docs/DECISIONS.md D7).
 */
export const FOUNDATION_ROOM = "foundation_room";

export type RoomName = typeof FOUNDATION_ROOM;
