/**
 * Assembles the Colyseus server. Split from the process bootstrap (`index.ts`)
 * so integration tests can construct a server, listen on an ephemeral port, and
 * shut it down without going through signal handling or `process.exit`.
 */
import http from "node:http";

import { Server } from "@colyseus/core";
import { WebSocketTransport } from "@colyseus/ws-transport";
import { HEALTH_PATH, type HealthResponse, PROTOCOL_VERSION } from "@carry-or-fall/protocol";

import type { Logger } from "./logger";
import { defineFoundationRoom } from "./rooms/FoundationRoom";
import { defineMatchRoom, type MatchRoomDeps } from "./rooms/MatchRoom";

const DEFAULT_MAX_CLIENTS = 64;

export interface GameServerDeps {
  readonly buildVersion: string;
  readonly logger: Logger;
  readonly allowedOrigins: readonly string[];
  /** Per-room client cap for the connection-only probe room. Overridable in tests. */
  readonly maxClients?: number;
  /**
   * Match-room timings and seed. Every field is optional and defaults to the
   * real values; integration tests override them so a suite does not sit
   * through a real 8-second lobby or a 12-minute match (M4.3). The match room's
   * own client cap is fixed at eight (technical plan §8.1) and is deliberately
   * not configurable.
   */
  readonly match?: Omit<MatchRoomDeps, "buildVersion" | "logger">;
}

export interface GameServerHandle {
  readonly gameServer: Server;
  /** The HTTP server the transport is bound to; exposed so tests can read the bound port. */
  readonly httpServer: http.Server;
}

/**
 * Build (but do not start) the game server. Owns its own HTTP server so the
 * `/health` route and the WebSocket transport share one port, and so callers
 * can read the bound address after `listen()`.
 */
export function createGameServer(deps: GameServerDeps): GameServerHandle {
  const { buildVersion, logger, allowedOrigins } = deps;

  const httpServer = http.createServer();
  const transport = new WebSocketTransport({ server: httpServer });

  const gameServer = new Server({
    transport,
    greet: false,
    // We register our own signal handlers in index.ts so shutdown is logged;
    // disable Colyseus's built-in handlers to avoid double-handling.
    gracefullyShutdown: false,
    // Custom health endpoint. Colyseus's built-in /__healthcheck returns a bare
    // "OK"; this one also reports the build and protocol versions for diagnostics
    // and, crucially, is reachable cross-origin by the browser client (which runs
    // on a different origin than the server). Registering via the `express`
    // option lets Colyseus's router fall through to it for unmatched routes,
    // avoiding a competing HTTP request listener.
    express: (app) => {
      app.get(HEALTH_PATH, (req, res) => {
        // Colyseus's router reflects any request Origin by default (its default
        // Access-Control-Allow-Origin is `*`/reflected). Enforce our allowlist on
        // this endpoint instead: reflect only a configured origin so the browser
        // client on the Vite dev origin can read this cross-origin response, and
        // strip the grant for any other origin — never a wildcard (technical
        // plan §20.3).
        res.setHeader("Vary", "Origin");
        const origin = req.headers.origin;
        if (typeof origin === "string" && allowedOrigins.includes(origin)) {
          res.setHeader("Access-Control-Allow-Origin", origin);
        } else {
          res.removeHeader("Access-Control-Allow-Origin");
        }
        const body: HealthResponse = {
          status: "ok",
          buildVersion,
          protocolVersion: PROTOCOL_VERSION,
          uptime: process.uptime(),
        };
        res.json(body);
      });
    },
  });

  defineFoundationRoom(gameServer, {
    buildVersion,
    logger,
    maxClients: deps.maxClients ?? DEFAULT_MAX_CLIENTS,
  });

  // One room per match (docs/DECISIONS.md D7), alongside the connection-only
  // probe room above (D40).
  defineMatchRoom(gameServer, { buildVersion, logger, ...deps.match });

  return { gameServer, httpServer };
}
