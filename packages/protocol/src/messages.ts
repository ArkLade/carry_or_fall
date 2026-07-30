/**
 * Shared client/server payload shapes for M0.
 *
 * M0 has no gameplay, so there are no post-join client→server messages. The only
 * thing a client tells the server is who it is: the version handshake below,
 * supplied as Colyseus *join options* so the server can refuse an incompatible
 * client before it ever occupies a seat (see the technical plan §35).
 */

/**
 * Version handshake the client supplies as Colyseus join options. It reports only
 * information the client legitimately owns; the server never trusts a client for
 * anything beyond identifying its version. The server validates this at the join
 * boundary and rejects a malformed or incompatible client.
 */
export interface ClientHandshake {
  readonly protocolVersion: number;
  readonly buildVersion: string;
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
