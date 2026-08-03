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
  /**
   * Fixes the seed every match is generated from, or `null` for a fresh random
   * seed per match (the normal case; technical plan §9.4). Pinning it makes
   * enemy, loot, chip, and extraction placement reproducible, which is what the
   * browser suite needs to assert about a specific position without depending on
   * whichever layout that run happened to draw.
   */
  readonly matchSeed: number | null;
  /**
   * How long the lobby countdown runs before a match starts, or `null` for the
   * gameplay default (`MatchRoom.DEFAULT_LOBBY_MS`).
   *
   * This exists so an automated suite does not spend real seconds waiting out a
   * countdown that is there for humans: concept §22.2 wants a lobby long enough
   * that a second player can realistically join, which is a human-timescale
   * requirement and pure dead time for a test that drives both clients itself.
   * Shortening it is configuration, exactly like {@link ServerEnv.matchSeed} —
   * not a test backdoor, and it is server-side, so it cannot reach the browser
   * bundle at all.
   */
  readonly matchLobbyMs: number | null;
  /**
   * Supabase project URL and secret key (technical plan §20.2), or `null` when
   * persistence is not configured.
   *
   * **The secret key bypasses row-level security.** It is deliberately not
   * `VITE_`-prefixed, never reaches the client build (asserted by
   * `apps/client/test/build.test.ts`), and is never included in a log line, an
   * error message, or a metrics field — including the "invalid configuration"
   * error this module throws, which names variables and never quotes their
   * values for these two.
   *
   * Both or neither: a URL with no key, or a key with no URL, is a
   * misconfiguration rather than a partial setup, and a server that started
   * half-configured would fail later, at a join, with a much worse error.
   *
   * Absent is legal in development and test, where `select-store.ts` falls back
   * to the in-memory store so a fresh clone with no `.env` still runs
   * (`docs/DECISIONS.md` D46). Absent in **production** is a startup failure —
   * see `assertPersistenceConfigured`.
   */
  readonly supabaseUrl: string | null;
  readonly supabaseSecretKey: string | null;
}

/** Subset of `process.env` this module reads; injectable so it is unit-testable. */
export type EnvSource = Readonly<Record<string, string | undefined>>;

const NODE_ENVS: readonly NodeEnv[] = ["development", "production", "test"];
const LOG_LEVELS: readonly LogLevel[] = ["debug", "info", "warn", "error"];

const DEFAULT_PORT = 2567;
const MIN_PORT = 0; // 0 lets the OS pick an ephemeral port (used by integration tests).
const MAX_PORT = 65535;

/** A seed is reduced to an unsigned 32-bit integer by the PRNG, so bound it there. */
const MAX_MATCH_SEED = 0xffff_ffff;

/** An hour: absurd for a lobby, and low enough that a typo cannot hang a server for a day. */
const MAX_MATCH_LOBBY_MS = 3_600_000;

const DEFAULTS: ServerEnv = {
  nodeEnv: "development",
  port: DEFAULT_PORT,
  allowedOrigins: ["http://localhost:5173"],
  buildVersion: "0.0.0-m0",
  logLevel: "info",
  matchSeed: null,
  matchLobbyMs: null,
  supabaseUrl: null,
  supabaseSecretKey: null,
};

/**
 * Guard against pasting a publishable key into the secret slot — a mistake that
 * would leave the server unable to write anything while looking configured. It
 * checks the documented prefix only; it never logs, echoes, or measures the rest
 * of the value.
 */
const SECRET_KEY_PREFIX = "sb_secret_";

/** Whether a string is an absolute http(s) URL. The value itself is never echoed. */
function isHttpUrl(value: string): boolean {
  if (!URL.canParse(value)) {
    return false;
  }
  const { protocol } = new URL(value);
  return protocol === "http:" || protocol === "https:";
}

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

  let matchSeed = DEFAULTS.matchSeed;
  const seedRaw = source["MATCH_SEED"];
  if (seedRaw !== undefined && seedRaw !== "") {
    const parsed = Number(seedRaw);
    if (Number.isInteger(parsed) && parsed >= 0 && parsed <= MAX_MATCH_SEED) {
      matchSeed = parsed;
    } else {
      errors.push(
        `MATCH_SEED must be an integer between 0 and ${String(MAX_MATCH_SEED)} (got "${seedRaw}")`,
      );
    }
  }

  let matchLobbyMs = DEFAULTS.matchLobbyMs;
  const lobbyRaw = source["MATCH_LOBBY_MS"];
  if (lobbyRaw !== undefined && lobbyRaw !== "") {
    const parsed = Number(lobbyRaw);
    if (Number.isInteger(parsed) && parsed >= 0 && parsed <= MAX_MATCH_LOBBY_MS) {
      matchLobbyMs = parsed;
    } else {
      errors.push(
        `MATCH_LOBBY_MS must be an integer between 0 and ${String(MAX_MATCH_LOBBY_MS)} (got "${lobbyRaw}")`,
      );
    }
  }

  // Supabase (technical plan §20.2). Note what is absent from every message
  // below: the value. A malformed secret key produces "SUPABASE_SECRET_KEY must
  // start with …", never the key itself — an invalid-configuration error is
  // exactly the kind of thing that ends up in a log aggregator or a screenshot.
  let supabaseUrl = DEFAULTS.supabaseUrl;
  let supabaseSecretKey = DEFAULTS.supabaseSecretKey;
  const urlRaw = source["SUPABASE_URL"]?.trim();
  const secretRaw = source["SUPABASE_SECRET_KEY"]?.trim();
  const hasUrl = urlRaw !== undefined && urlRaw !== "";
  const hasSecret = secretRaw !== undefined && secretRaw !== "";

  if (hasUrl !== hasSecret) {
    errors.push("SUPABASE_URL and SUPABASE_SECRET_KEY must be set together (set both, or neither)");
  } else if (hasUrl && hasSecret) {
    // http/https specifically, not merely "parseable". `URL.canParse` accepts
    // any scheme, so a typo like `hhttps://…` parses cleanly here and then fails
    // several layers down inside the Supabase client with a message that names
    // neither the variable nor the file it came from. Checking the scheme turns
    // that into one line at startup. (Found exactly this way: a stray character
    // in a local `.env` took down the browser suite with a stack trace through
    // `supabase-js`.)
    if (!isHttpUrl(urlRaw)) {
      errors.push("SUPABASE_URL must be an http(s) URL (e.g. https://<project-ref>.supabase.co)");
    } else if (!secretRaw.startsWith(SECRET_KEY_PREFIX)) {
      errors.push(
        `SUPABASE_SECRET_KEY must be a secret key (it starts with "${SECRET_KEY_PREFIX}"); ` +
          "the publishable key belongs in VITE_SUPABASE_PUBLISHABLE_KEY",
      );
    } else {
      supabaseUrl = urlRaw;
      supabaseSecretKey = secretRaw;
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
    matchSeed,
    matchLobbyMs,
    supabaseUrl,
    supabaseSecretKey,
  });
}

/** Whether this configuration can reach a real Supabase project. */
export function hasSupabaseConfig(
  env: ServerEnv,
): env is ServerEnv & { supabaseUrl: string; supabaseSecretKey: string } {
  return env.supabaseUrl !== null && env.supabaseSecretKey !== null;
}

/**
 * Refuse to start a production server with no persistence.
 *
 * The in-memory fallback exists so a fresh clone, CI, and the browser suite can
 * run with no credentials (`docs/DECISIONS.md` D46). The danger of a fallback is
 * that a real deployment silently gets it and loses every player's progression
 * without erroring once. This closes that off at the only place it can be closed
 * — startup — so the fallback is reachable in development and test and nowhere
 * else.
 */
export function assertPersistenceConfigured(env: ServerEnv): void {
  if (env.nodeEnv === "production" && !hasSupabaseConfig(env)) {
    throw new Error(
      "Refusing to start: NODE_ENV=production requires SUPABASE_URL and SUPABASE_SECRET_KEY. " +
        "Without them the server would run on in-memory progression and silently discard " +
        "every account's points, unlocks, and secure-slot rewards.",
    );
  }
}

/**
 * The same refusal, at the seam where the consequence is chosen (M6.8,
 * `docs/M6_ISSUES.md` §9; `docs/DECISIONS.md` D61).
 *
 * {@link assertPersistenceConfigured} guards the **process**: `index.ts` calls
 * it before anything is built. This guards the **server**: `createGameServer`
 * decides, from whether the store is Supabase-backed, that a non-persistent
 * process mints local identities (`docs/DECISIONS.md` D45) and provisions every
 * unlock (D49). Both are right for development and wrong for a deployment, and
 * a check that lives only in the bootstrap is one that a second entry point —
 * an embedding, a different `main`, a test harness someone later trusts — walks
 * straight past.
 *
 * Takes the raw `NODE_ENV` rather than a parsed {@link ServerEnv} because
 * `createGameServer` is handed dependencies, not configuration: the store it
 * was given is the fact that matters, and the environment is the only thing it
 * needs to look up.
 */
export function assertPersistenceSelected(nodeEnv: string | undefined, persistent: boolean): void {
  if (nodeEnv === "production" && !persistent) {
    throw new Error(
      "Refusing to build a production game server on non-persistent progression. " +
        "Without Supabase the server mints a fresh local identity per join and provisions " +
        "every unlock, and every account's points, unlocks, and secure-slot rewards are " +
        "discarded when the process exits.",
    );
  }
}
