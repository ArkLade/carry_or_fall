/**
 * Process entry point for the authoritative server. Loads and validates the
 * environment, starts listening, and installs graceful-shutdown handlers so an
 * interrupted process closes rooms and connections cleanly. No gameplay in M0.
 */
import { PROTOCOL_VERSION } from "@carry-or-fall/protocol";

import { loadServerEnv } from "./config/env";
import { createLogger } from "./logger";
import { createGameServer } from "./server";

function toMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function main(): Promise<void> {
  const env = loadServerEnv();
  const logger = createLogger({ level: env.logLevel, buildVersion: env.buildVersion });
  const { gameServer } = createGameServer({
    buildVersion: env.buildVersion,
    logger,
    allowedOrigins: env.allowedOrigins,
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
      logger.info("shutdown complete", { signal });
      process.exit(0);
    } catch (error) {
      logger.error("shutdown failed", { signal, error: toMessage(error) });
      process.exit(1);
    }
  };

  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));

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
