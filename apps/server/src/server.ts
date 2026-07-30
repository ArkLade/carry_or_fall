/**
 * Assembles the Colyseus server. Split from the process bootstrap (`index.ts`)
 * so integration tests can construct a server, listen on an ephemeral port, and
 * shut it down without going through signal handling or `process.exit`.
 */
import http from "node:http";

import { Server } from "@colyseus/core";
import { WebSocketTransport } from "@colyseus/ws-transport";
import { PROTOCOL_VERSION } from "@carry-or-fall/protocol";

import type { Logger } from "./logger";
import { defineFoundationRoom } from "./rooms/FoundationRoom";

const DEFAULT_MAX_CLIENTS = 64;

export interface GameServerDeps {
  readonly buildVersion: string;
  readonly logger: Logger;
  readonly allowedOrigins: readonly string[];
  /** Per-room client cap. Defaults to a sane M0 value; overridable in tests. */
  readonly maxClients?: number;
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
  const { buildVersion, logger } = deps;

  const httpServer = http.createServer();
  const transport = new WebSocketTransport({ server: httpServer });

  const gameServer = new Server({
    transport,
    greet: false,
    // We register our own signal handlers in index.ts so shutdown is logged;
    // disable Colyseus's built-in handlers to avoid double-handling.
    gracefullyShutdown: false,
    // Custom health endpoint. Colyseus's built-in /__healthcheck returns a bare
    // "OK"; this one also reports the build and protocol versions for diagnostics.
    // Registering via the `express` option lets Colyseus's router fall through to
    // it for unmatched routes, avoiding a competing HTTP request listener.
    express: (app) => {
      app.get("/health", (_req, res) => {
        res.json({
          status: "ok",
          buildVersion,
          protocolVersion: PROTOCOL_VERSION,
          uptime: process.uptime(),
        });
      });
    },
  });

  defineFoundationRoom(gameServer, {
    buildVersion,
    logger,
    maxClients: deps.maxClients ?? DEFAULT_MAX_CLIENTS,
  });

  return { gameServer, httpServer };
}
