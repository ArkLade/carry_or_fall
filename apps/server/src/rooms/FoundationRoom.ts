/**
 * The single M0 room. It exists to prove the authoritative loop end-to-end:
 * clients join, the server owns the synchronized state, and the room disposes
 * itself when empty. There is no gameplay here yet.
 *
 * Server configuration (build version, limits, logger) is injected through a
 * closure rather than Colyseus room options on purpose: Colyseus merges a
 * client's join options into the room's create options, so anything read from
 * options could be spoofed by a client. Capturing config in the closure keeps
 * the server the sole authority (see docs/DEVELOPMENT_RULES.md, "Authority").
 */
import { type Client, Room, type Server } from "@colyseus/core";
import {
  CLIENT_MESSAGE_TYPES,
  FOUNDATION_ROOM,
  isProtocolCompatible,
  PROTOCOL_VERSION,
  validateClientHello,
} from "@carry-or-fall/protocol";

import type { Logger } from "../logger";
import { FoundationState, type FoundationStateType } from "./FoundationState";

// WebSocket close code sent when the server rejects a client during handshake.
// 4000+ is the app-defined range permitted by the WebSocket spec.
const CLOSE_PROTOCOL_REJECTED = 4001;

export interface FoundationRoomDeps {
  readonly buildVersion: string;
  readonly logger: Logger;
  readonly maxClients: number;
}

/**
 * Register the foundation room on `gameServer`. Kept as a function (not a bare
 * class) so the injected dependencies above are captured before the room is
 * defined.
 */
export function defineFoundationRoom(gameServer: Server, deps: FoundationRoomDeps): void {
  const { buildVersion, logger } = deps;

  class FoundationRoom extends Room<{ state: FoundationStateType }> {
    override maxClients = deps.maxClients;
    override autoDispose = true;

    override onCreate(): void {
      this.state = new FoundationState({
        serverBuildVersion: buildVersion,
        connectedPlayers: 0,
      });

      // The only client message in M0. It is validated at this boundary before
      // any field is trusted; a malformed or incompatible hello is rejected.
      this.onMessage<unknown>(CLIENT_MESSAGE_TYPES.hello, (client, message) => {
        const result = validateClientHello(message);
        if (!result.ok) {
          logger.warn("rejected malformed client_hello", {
            sessionId: client.sessionId,
            error: result.error,
          });
          client.leave(CLOSE_PROTOCOL_REJECTED);
          return;
        }

        if (!isProtocolCompatible(result.value.protocolVersion)) {
          logger.warn("rejected incompatible client protocol", {
            sessionId: client.sessionId,
            clientProtocol: result.value.protocolVersion,
            serverProtocol: PROTOCOL_VERSION,
          });
          client.leave(CLOSE_PROTOCOL_REJECTED);
          return;
        }

        logger.info("accepted client_hello", {
          sessionId: client.sessionId,
          clientProtocol: result.value.protocolVersion,
          clientBuildVersion: result.value.buildVersion,
        });
      });

      logger.info("room created", { roomId: this.roomId });
    }

    override onJoin(client: Client): void {
      this.state.connectedPlayers += 1;
      logger.info("client joined", {
        roomId: this.roomId,
        sessionId: client.sessionId,
        connectedPlayers: this.state.connectedPlayers,
      });
    }

    override onLeave(client: Client): void {
      this.state.connectedPlayers = Math.max(0, this.state.connectedPlayers - 1);
      logger.info("client left", {
        roomId: this.roomId,
        sessionId: client.sessionId,
        connectedPlayers: this.state.connectedPlayers,
      });
    }

    override onDispose(): void {
      logger.info("room disposed", { roomId: this.roomId });
    }
  }

  gameServer.define(FOUNDATION_ROOM, FoundationRoom);
}
