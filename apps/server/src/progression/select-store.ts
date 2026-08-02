/**
 * Which {@link ProgressionStore} this process runs on (M5.4,
 * `docs/M5_ISSUES.md` §1.5).
 *
 * Supabase when it is configured; the in-memory store otherwise, with a warning
 * loud enough that nobody mistakes it for persistence. The dangerous case — a
 * production deployment quietly landing on the fallback and discarding every
 * player's progression — is refused earlier, by
 * `assertPersistenceConfigured` in `config/env.ts`, at startup rather than at
 * the first settlement.
 */
import { hasSupabaseConfig, type ServerEnv } from "../config/env";
import type { Logger } from "../logger";
import { MemoryStore } from "./memory-store";
import type { ProgressionStore } from "./store";
import { SupabaseStore } from "./supabase-store";

export interface SelectedStore {
  readonly store: ProgressionStore;
}

export function selectProgressionStore(env: ServerEnv, logger: Logger): SelectedStore {
  if (hasSupabaseConfig(env)) {
    // The URL is logged; the key is not, and never is.
    logger.info("progression store: supabase", { supabaseUrl: env.supabaseUrl });
    return { store: new SupabaseStore(env.supabaseUrl, env.supabaseSecretKey) };
  }

  logger.warn(
    "progression store: in-memory — accounts, points, unlocks, and secure-slot rewards " +
      "will be lost when this process exits. Set SUPABASE_URL and SUPABASE_SECRET_KEY for " +
      "real persistence (see supabase/README.md).",
    { nodeEnv: env.nodeEnv },
  );
  return { store: new MemoryStore() };
}
