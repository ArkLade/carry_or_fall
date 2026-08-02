/**
 * Process entry point for the authoritative server. Loads and validates the
 * environment, starts listening, and installs graceful-shutdown handlers so an
 * interrupted process closes rooms and connections cleanly. No gameplay in M0.
 */
import { PROTOCOL_VERSION } from "@carry-or-fall/protocol";

import { matchMaker } from "@colyseus/core";

import { assertPersistenceConfigured, loadServerEnv } from "./config/env";
import { createLogger } from "./logger";
import { startMetricsReporter } from "./metrics";
import { selectProgressionStore } from "./progression/select-store";
import { createGameServer } from "./server";

function toMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function main(): Promise<void> {
  const env = loadServerEnv();
  const logger = createLogger({ level: env.logLevel, buildVersion: env.buildVersion });

  // Refuse to start a production server that would silently discard every
  // account's progression (M5, `config/env.ts`).
  assertPersistenceConfigured(env);
  const progression = selectProgressionStore(env, logger);

  const { gameServer, store } = createGameServer({
    buildVersion: env.buildVersion,
    logger,
    allowedOrigins: env.allowedOrigins,
    progression,
    // Each key is omitted entirely when unset, so the room falls back to its
    // own gameplay defaults rather than being handed a null.
    match: {
      ...(env.matchSeed === null ? {} : { seed: env.matchSeed }),
      ...(env.matchLobbyMs === null ? {} : { lobbyDurationMs: env.matchLobbyMs }),
    },
  });

  let shuttingDown = false;
  const shutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) {
      return;
    }
    shuttingDown = true;
    logger.info("shutdown requested", { signal });
    try {
      await gameServer.gracefullyShutdown(false);
      await store.close();
      logger.info("shutdown complete", { signal });
      process.exit(0);
    } catch (error) {
      logger.error("shutdown failed", { signal, error: toMessage(error) });
      process.exit(1);
    }
  };

  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));

  // Periodic health numbers (technical plan §32.2). Cheap, and the only way a
  // server that degrades over a long session shows up before a user notices.
  startMetricsReporter({
    logger,
    getActiveRooms: async () => (await matchMaker.query({})).length,
  });

  await gameServer.listen(env.port);
  logger.info("server listening", {
    port: env.port,
    nodeEnv: env.nodeEnv,
    buildVersion: env.buildVersion,
    protocolVersion: PROTOCOL_VERSION,
    allowedOrigins: env.allowedOrigins.join(","),
  });
}

main().catch((error: unknown) => {
  // The logger may not exist yet if config validation threw, so write directly.
  console.error("fatal: failed to start server", error);
  process.exit(1);
});
