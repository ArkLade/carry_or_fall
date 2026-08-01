/**
 * The connection-only probe room. It proves the authoritative loop end-to-end —
 * clients join, the server owns the synchronized state, and the room disposes
 * itself when empty — with no gameplay and no match.
 *
 * M4 added `match_room` but kept this one (`docs/DECISIONS.md` D40): joining the
 * match room now has consequences (it takes one of eight seats and starts a
 * lobby countdown), so a probe that allocates no match is a genuinely different
 * capability, and it is the one `BootScene` and a later deployment health check
 * want. The drift risk of two rooms is removed by both calling the same
 * `authorizeHandshake` gate rather than each implementing the version check.
 *
 * Server configuration (build version, limits, logger) is injected through a
 * closure rather than Colyseus room options on purpose: Colyseus merges a
 * client's join options into the room's create options, so anything read from
 * options could be spoofed by a client. Capturing config in the closure keeps
 * the server the sole authority (see docs/DEVELOPMENT_RULES.md, "Authority").
 */
import { type Client, Room, type Server } from "@colyseus/core";
import { FOUNDATION_ROOM } from "@carry-or-fall/protocol";

import type { Logger } from "../logger";
import { authorizeHandshake } from "./authorize";
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
      authorizeHandshake(options, client.sessionId, logger);
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
