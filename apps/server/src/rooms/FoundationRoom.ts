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
import { type Client, Room, type Server, ServerError } from "@colyseus/core";
import {
  FOUNDATION_ROOM,
  INCOMPATIBLE_CLIENT_MESSAGE,
  isProtocolCompatible,
  PROTOCOL_MISMATCH_CODE,
  PROTOCOL_VERSION,
  validateClientHandshake,
} from "@carry-or-fall/protocol";

import type { Logger } from "../logger";
import { FoundationState, type FoundationStateType } from "./FoundationState";

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

    /**
     * Handshake gate. Runs during the join handshake, before `onJoin` and before
     * the client occupies a seat. The client reports its protocol/build version
     * as join options; a malformed or incompatible client is refused here with a
     * refresh/update message (technical plan §35) rather than accepted and later
     * desynced. The reported version is used only to gate compatibility — never
     * as authoritative game state.
     */
    override onAuth(client: Client, options: unknown): boolean {
      const result = validateClientHandshake(options);
      if (!result.ok) {
        logger.warn("refused malformed client handshake", {
          sessionId: client.sessionId,
          error: result.error,
        });
        throw new ServerError(PROTOCOL_MISMATCH_CODE, INCOMPATIBLE_CLIENT_MESSAGE);
      }

      if (!isProtocolCompatible(result.value.protocolVersion)) {
        logger.warn("refused incompatible client protocol", {
          sessionId: client.sessionId,
          clientProtocol: result.value.protocolVersion,
          serverProtocol: PROTOCOL_VERSION,
        });
        throw new ServerError(PROTOCOL_MISMATCH_CODE, INCOMPATIBLE_CLIENT_MESSAGE);
      }

      logger.info("accepted client handshake", {
        sessionId: client.sessionId,
        clientProtocol: result.value.protocolVersion,
        clientBuildVersion: result.value.buildVersion,
      });
      return true;
    }

    override onCreate(): void {
      this.state = new FoundationState({
        serverBuildVersion: buildVersion,
        connectedPlayers: 0,
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
