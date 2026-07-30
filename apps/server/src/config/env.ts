/**
 * Server environment configuration. Values arrive from the process environment
 * (an untrusted boundary), so every one is validated before use and the whole
 * config fails fast if anything is malformed — a misconfigured server should not
 * start half-working. Missing values fall back to the M0 defaults documented in
 * `.env.example`; present values are always validated.
 */
import { isBuildVersion } from "@carry-or-fall/protocol";

import type { LogLevel } from "../logger";

export type NodeEnv = "development" | "production" | "test";

export interface ServerEnv {
  readonly nodeEnv: NodeEnv;
  readonly port: number;
  readonly allowedOrigins: readonly string[];
  readonly buildVersion: string;
  readonly logLevel: LogLevel;
}

/** Subset of `process.env` this module reads; injectable so it is unit-testable. */
export type EnvSource = Readonly<Record<string, string | undefined>>;

const NODE_ENVS: readonly NodeEnv[] = ["development", "production", "test"];
const LOG_LEVELS: readonly LogLevel[] = ["debug", "info", "warn", "error"];

const DEFAULT_PORT = 2567;
const MIN_PORT = 0; // 0 lets the OS pick an ephemeral port (used by integration tests).
const MAX_PORT = 65535;

const DEFAULTS: ServerEnv = {
  nodeEnv: "development",
  port: DEFAULT_PORT,
  allowedOrigins: ["http://localhost:5173"],
  buildVersion: "0.0.0-m0",
  logLevel: "info",
};

/**
 * Parse and validate the server environment. Throws an `Error` listing every
 * problem at once (rather than failing on the first) so a misconfiguration is
 * cheap to diagnose.
 */
export function loadServerEnv(source: EnvSource = process.env): ServerEnv {
  const errors: string[] = [];

  let nodeEnv = DEFAULTS.nodeEnv;
  const nodeEnvRaw = source["NODE_ENV"];
  if (nodeEnvRaw !== undefined) {
    if ((NODE_ENVS as readonly string[]).includes(nodeEnvRaw)) {
      nodeEnv = nodeEnvRaw as NodeEnv;
    } else {
      errors.push(`NODE_ENV must be one of ${NODE_ENVS.join(", ")} (got "${nodeEnvRaw}")`);
    }
  }

  let port = DEFAULTS.port;
  const portRaw = source["PORT"];
  if (portRaw !== undefined) {
    const parsed = Number(portRaw);
    if (Number.isInteger(parsed) && parsed >= MIN_PORT && parsed <= MAX_PORT) {
      port = parsed;
    } else {
      errors.push(`PORT must be an integer between ${MIN_PORT} and ${MAX_PORT} (got "${portRaw}")`);
    }
  }

  let allowedOrigins = DEFAULTS.allowedOrigins;
  const originsRaw = source["ALLOWED_ORIGINS"];
  if (originsRaw !== undefined) {
    const parsed = originsRaw
      .split(",")
      .map((origin) => origin.trim())
      .filter((origin) => origin.length > 0);
    if (parsed.length > 0) {
      allowedOrigins = parsed;
    } else {
      errors.push("ALLOWED_ORIGINS must list at least one comma-separated origin");
    }
  }

  let buildVersion = DEFAULTS.buildVersion;
  const buildRaw = source["GAME_BUILD_VERSION"];
  if (buildRaw !== undefined) {
    const provided = buildRaw;
    if (isBuildVersion(buildRaw)) {
      buildVersion = buildRaw;
    } else {
      errors.push(`GAME_BUILD_VERSION must be a valid build version (got "${provided}")`);
    }
  }

  let logLevel = DEFAULTS.logLevel;
  const logRaw = source["LOG_LEVEL"];
  if (logRaw !== undefined) {
    if ((LOG_LEVELS as readonly string[]).includes(logRaw)) {
      logLevel = logRaw as LogLevel;
    } else {
      errors.push(`LOG_LEVEL must be one of ${LOG_LEVELS.join(", ")} (got "${logRaw}")`);
    }
  }

  if (errors.length > 0) {
    throw new Error(`Invalid server environment configuration:\n- ${errors.join("\n- ")}`);
  }

  return Object.freeze({
    nodeEnv,
    port,
    allowedOrigins: Object.freeze([...allowedOrigins]),
    buildVersion,
    logLevel,
  });
}
