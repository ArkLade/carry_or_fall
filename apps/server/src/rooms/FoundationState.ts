/**
 * Synchronized state for the foundation room. The server is the sole authority
 * over these fields; the client only ever reads them (its mirror is the plain
 * `FoundationRoomState` interface in `@carry-or-fall/protocol`).
 *
 * Uses the decorator-free `schema()` form from `@colyseus/schema` v4 so the
 * project needs no `experimentalDecorators` compiler setting.
 */
import { schema, type SchemaType } from "@colyseus/schema";

export const FoundationState = schema({
  /** Build version the server is running, surfaced to clients for diagnostics. */
  serverBuildVersion: "string",
  /** Number of clients currently connected to this room. */
  connectedPlayers: "number",
});

export type FoundationStateType = SchemaType<typeof FoundationState>;
