/**
 * Thin wrapper over the Colyseus client SDK for M0. It joins the single
 * foundation room, sends the protocol handshake, and reports connection status
 * and synchronized state back through callbacks so the rendering layer (the
 * Phaser scene) stays decoupled from the networking library.
 */
import {
  type ClientHelloPayload,
  CLIENT_MESSAGE_TYPES,
  FOUNDATION_ROOM,
  type FoundationRoomState,
  PROTOCOL_VERSION,
} from "@carry-or-fall/protocol";
import { Client } from "@colyseus/sdk";

export type ConnectionStatus = "connecting" | "connected" | "failed";

export interface ConnectionCallbacks {
  onStatusChange(status: ConnectionStatus, detail?: string): void;
  onStateChange(state: FoundationRoomState): void;
}

export interface ConnectionOptions {
  readonly serverUrl: string;
  readonly buildVersion: string;
}

export interface GameServerConnection {
  readonly leave: () => Promise<void>;
}

function toDetail(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export async function connectToFoundationRoom(
  options: ConnectionOptions,
  callbacks: ConnectionCallbacks,
): Promise<GameServerConnection> {
  callbacks.onStatusChange("connecting");

  const client = new Client(options.serverUrl);

  try {
    const room = await client.joinOrCreate<FoundationRoomState>(FOUNDATION_ROOM);

    room.onStateChange((state) => {
      callbacks.onStateChange({
        serverBuildVersion: state.serverBuildVersion,
        connectedPlayers: state.connectedPlayers,
      });
    });

    room.onError((code, message) => {
      callbacks.onStatusChange("failed", `server error ${code}${message ? `: ${message}` : ""}`);
    });

    room.onLeave((code) => {
      callbacks.onStatusChange("failed", `disconnected (code ${code})`);
    });

    const hello: ClientHelloPayload = {
      protocolVersion: PROTOCOL_VERSION,
      buildVersion: options.buildVersion,
    };
    room.send(CLIENT_MESSAGE_TYPES.hello, hello);

    callbacks.onStatusChange("connected");

    return {
      leave: async () => {
        await room.leave(true);
      },
    };
  } catch (error) {
    callbacks.onStatusChange("failed", toDetail(error));
    throw error;
  }
}
