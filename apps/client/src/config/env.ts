/**
 * Client runtime configuration, read from Vite's `import.meta.env` (populated
 * from `.env` at build/dev time). Validated here so a missing or malformed value
 * fails loudly at startup instead of surfacing as a confusing connection error.
 */
import { isBuildVersion } from "@carry-or-fall/protocol";

export interface ClientEnv {
  readonly serverUrl: string;
  readonly buildVersion: string;
}

export function loadClientEnv(): ClientEnv {
  const serverUrl = import.meta.env.VITE_GAME_SERVER_URL;
  const buildVersion = import.meta.env.VITE_BUILD_VERSION;

  // Typed as `string`, but Vite substitutes `undefined` when a variable is
  // absent, so the runtime guard is real despite what the types imply.
  if (typeof serverUrl !== "string" || serverUrl.length === 0) {
    throw new Error("VITE_GAME_SERVER_URL is required (e.g. ws://localhost:2567)");
  }
  if (!isBuildVersion(buildVersion)) {
    throw new Error("VITE_BUILD_VERSION must be a valid build version (e.g. 0.0.0-m0)");
  }

  return { serverUrl, buildVersion };
}
