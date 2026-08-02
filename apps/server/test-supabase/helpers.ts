/**
 * Shared setup for the real-Supabase suite (M5.9, `docs/M5_ISSUES.md` §10).
 *
 * These tests are the only evidence that the SQL in `supabase/migrations/` is
 * correct — the transactional and concurrency behavior of
 * `settle_match_reward`, and every row-level-security policy. CI cannot run
 * them: it has no credentials and cannot reach a project
 * (`docs/DECISIONS.md` D46). They therefore **skip** when the variables are
 * absent rather than failing, which is what lets a fresh clone pass every gate.
 *
 * Nothing here reads or prints a key. Values come from the process environment
 * and are handed straight to the client.
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const url = process.env["SUPABASE_URL"];
const secretKey = process.env["SUPABASE_SECRET_KEY"];
const publishableKey = process.env["VITE_SUPABASE_PUBLISHABLE_KEY"];

/**
 * Whether `SUPABASE_URL` is an absolute http(s) URL — the same check
 * `apps/server/src/config/env.ts` applies, for the same reason: a stray
 * character (`hhttps://…`) parses as a URL, so it survives every naive
 * validation and then fails several layers down inside `supabase-js` with a
 * message naming neither the variable nor the file it came from.
 *
 * A malformed value is deliberately **not** treated as "no credentials". Someone
 * who set the variable meant to run against a project, and silently skipping the
 * only suite that tests the SQL would hide the misconfiguration behind a green
 * run — which is exactly the failure mode this suite exists to prevent.
 */
function describeUrlProblem(value: string | undefined): string | null {
  if (value === undefined || value.length === 0) {
    return null;
  }
  if (!URL.canParse(value)) {
    return "SUPABASE_URL is not a URL";
  }
  const { protocol } = new URL(value);
  if (protocol !== "http:" && protocol !== "https:") {
    // The scheme is echoed because it is the whole diagnosis and is not secret;
    // the rest of the value never is.
    return `SUPABASE_URL has scheme "${protocol.replace(":", "")}", expected http or https`;
  }
  return null;
}

const urlProblem = describeUrlProblem(url);
if (urlProblem !== null) {
  throw new Error(
    `${urlProblem}. Fix it in the repository-root .env (see .env.example), or unset ` +
      "SUPABASE_URL and SUPABASE_SECRET_KEY to skip this suite.",
  );
}

/** Whether a real project is reachable. Drives `describe.skipIf` in every file. */
export const hasCredentials =
  typeof url === "string" &&
  url.length > 0 &&
  typeof secretKey === "string" &&
  secretKey.length > 0;

/**
 * Whether the browser-side policy tests can run. They additionally need the
 * publishable key, because the whole point is to exercise the `authenticated`
 * role rather than the secret key's `service_role` bypass.
 */
export const hasBrowserCredentials =
  hasCredentials && typeof publishableKey === "string" && publishableKey.length > 0;

/** A `service_role` client: bypasses row-level security, like the game server. */
export function serviceClient(): SupabaseClient {
  if (!hasCredentials) {
    throw new Error("serviceClient() called without credentials; guard with hasCredentials");
  }
  return createClient(url as string, secretKey as string, {
    auth: { persistSession: false, autoRefreshToken: false },
  }) as SupabaseClient;
}

/** A publishable-key client: the `authenticated` role, exactly what a browser gets. */
export function browserClient(): SupabaseClient {
  if (!hasBrowserCredentials) {
    throw new Error("browserClient() called without credentials; guard with hasBrowserCredentials");
  }
  return createClient(url as string, publishableKey as string, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  }) as SupabaseClient;
}

/** A signed-in anonymous browser session, plus its user id. */
export interface BrowserSession {
  readonly client: SupabaseClient;
  readonly userId: string;
  readonly isAnonymous: boolean;
}

export async function signInAnonymously(): Promise<BrowserSession> {
  const client = browserClient();
  const { data, error } = await client.auth.signInAnonymously();
  if (error !== null || data.user === null) {
    throw new Error(`anonymous sign-in failed: ${error?.message ?? "no user returned"}`);
  }
  return { client, userId: data.user.id, isAnonymous: data.user.is_anonymous === true };
}

/**
 * Delete every row this suite created for a user, through the service client.
 * Deleting the auth user cascades, which is the point of the `on delete cascade`
 * on every table.
 */
export async function deleteUser(userId: string): Promise<void> {
  const admin = serviceClient();
  await admin.auth.admin.deleteUser(userId).catch(() => undefined);
}
