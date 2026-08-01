/**
 * Thin wrapper over the Colyseus client SDK for M0. It joins the single
 * foundation room and reports connection status and synchronized state back
 * through callbacks so the rendering layer (the Phaser scene) stays decoupled
 * from the networking library.
 *
 * The protocol/build handshake is sent as Colyseus *join options* so the server
 * can refuse an incompatible client at the join boundary (technical plan §35);
 * on refusal the join rejects with the server's refresh/update message.
 */
import {
  type ClientHandshake,
  FOUNDATION_ROOM,
  type FoundationRoomState,
  PROTOCOL_VERSION,
} from "@carry-or-fall/protocol";
import { CONTENT_VERSION } from "@carry-or-fall/game-content";
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

  const handshake: ClientHandshake = {
    protocolVersion: PROTOCOL_VERSION,
    contentVersion: CONTENT_VERSION,
    buildVersion: options.buildVersion,
  };

  try {
    const room = await client.joinOrCreate<FoundationRoomState>(FOUNDATION_ROOM, { ...handshake });

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

    callbacks.onStatusChange("connected");

    return {
      leave: async () => {
        await room.leave(true);
      },
    };
  } catch (error) {
    // An incompatible client is rejected here with the server's refresh/update
    // message (technical plan §35); surface whatever the server reported.
    callbacks.onStatusChange("failed", toDetail(error));
    throw error;
  }
}
