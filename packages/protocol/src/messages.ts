/**
 * Client -> server message type identifiers. Kept as string literals so both
 * ends share one source of truth and neither hard-codes raw strings.
 *
 * M0 has no gameplay, so the only message is the post-join handshake. It exists
 * to exercise the authoritative rule that every client message is validated at
 * the network boundary before it is trusted.
 */
export const CLIENT_MESSAGE_TYPES = {
  hello: "client_hello",
} as const;

export type ClientMessageType = (typeof CLIENT_MESSAGE_TYPES)[keyof typeof CLIENT_MESSAGE_TYPES];

/**
 * Handshake the client sends immediately after joining. It reports only version
 * information the client legitimately owns; the server never trusts a client for
 * anything beyond identifying itself.
 */
export interface ClientHelloPayload {
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
