/**
 * The browser's Supabase client (M5.5, `docs/M5_ISSUES.md` §6).
 *
 * Built from `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY`. **The
 * publishable key is designed to be bundled** (technical plan §20.2): it grants
 * nothing on its own, because every table is protected by row-level security and
 * a browser only ever sees rows matching its own `auth.uid()`
 * (`docs/DATA_MODEL.md` §5).
 *
 * The secret key is not here, is not reachable from here, and is asserted absent
 * from the production bundle by `apps/client/test/build.test.ts`. Nothing in
 * `apps/client/src` may read a non-`VITE_`-prefixed variable, which
 * `architecture.test.ts` also asserts — a leak is caught at the source, before
 * it is even built.
 *
 * Returns `null` when the two variables are absent. That is not a degraded
 * security mode, it is "this build has no accounts": a fresh clone and CI have
 * no `.env` at all (`docs/DECISIONS.md` D42/D46), and the game must still run so
 * the thirty browser tests can test the game rather than the credentials.
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

let cached: SupabaseClient | null | undefined;

/**
 * The configured browser client, or `null` when this build has no Supabase
 * project. Memoized: `supabase-js` keeps the auth session in memory alongside
 * browser storage, so a second instance would race the first over token refresh.
 */
export function getSupabaseClient(): SupabaseClient | null {
  if (cached !== undefined) {
    return cached;
  }

  const url = import.meta.env.VITE_SUPABASE_URL;
  const publishableKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

  // Typed as `string`, but Vite substitutes `undefined` for an absent variable,
  // so the runtime guard is real despite what the types imply — the same note
  // `config/env.ts` makes about `VITE_GAME_SERVER_URL`.
  if (typeof url !== "string" || url.length === 0) {
    cached = null;
    return cached;
  }
  if (typeof publishableKey !== "string" || publishableKey.length === 0) {
    cached = null;
    return cached;
  }

  cached = createClient(url, publishableKey, {
    auth: {
      // Technical plan §17.1 step 2: "store the session in browser storage", so
      // a returning player is the same account rather than a new anonymous one.
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: false,
    },
  });
  return cached;
}

/** Whether this build can reach a Supabase project at all. */
export function hasSupabaseConfig(): boolean {
  return getSupabaseClient() !== null;
}
