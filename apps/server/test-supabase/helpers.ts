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

/**
 * Every anonymous sign-in this file has performed.
 *
 * Counted, and printed by {@link reportSignIns}, because the number is the
 * point: `docs/DECISIONS.md` D52 raised a **production** rate limit from 30 per
 * hour to 100 for this suite's convenience, and the way that gets reverted is
 * by measuring how many sign-ins the suite actually needs rather than
 * estimating.
 */
let signInCount = 0;

export function signInsPerformed(): number {
  return signInCount;
}

export async function signInAnonymously(): Promise<BrowserSession> {
  const client = browserClient();
  signInCount += 1;
  const { data, error } = await client.auth.signInAnonymously();
  if (error !== null || data.user === null) {
    throw new Error(`anonymous sign-in failed: ${error?.message ?? "no user returned"}`);
  }
  return { client, userId: data.user.id, isAnonymous: data.user.is_anonymous === true };
}

/**
 * Every table a test can leave a row in, in the order they are wiped
 * (`docs/DATA_MODEL.md` §3). Order does not matter — every foreign key points at
 * `auth.users`, not at another of these — but the list is exhaustive on purpose:
 * a table missing from it would let one test see the previous test's rows, which
 * is the isolation this pooling has to preserve.
 */
const PROGRESSION_TABLES = [
  "reward_ledger",
  "secure_reservations",
  "match_results",
  "loadouts",
  "unlocks",
  "point_balances",
  "profiles",
] as const;

/**
 * A pool of anonymous accounts, reused across the tests in one file (M6.11,
 * `docs/M6_ISSUES.md` §12; `docs/DECISIONS.md` D63).
 *
 * **Why reuse rather than create.** Anonymous sign-in is IP rate-limited (30
 * per hour by default), and Supabase never cleans up anonymous users — so a
 * suite that created two accounts per test both spent a production rate limit
 * and left permanent rows behind, on every run, forever. D52 raised the limit
 * to 100 to paper over it and said in the same breath that the real fix was
 * here.
 *
 * **Why isolation survives.** The property the contract suite needs is *a user
 * with no rows*, not *a user that did not exist a moment ago*. So an account is
 * handed back with every progression row deleted, which is the same starting
 * state a fresh sign-in gives — and the auth user itself carries no state a test
 * reads. The one thing reuse cannot survive is a test that changes the *account*
 * rather than its rows (linking an anonymous user to a permanent one flips the
 * `is_anonymous` claim permanently), and that test asks for a fresh sign-in
 * explicitly.
 */
const pool: BrowserSession[] = [];
let borrowed = 0;

/**
 * Take `count` accounts, growing the pool only when it is too small. Every
 * account comes back wiped clean.
 */
export async function acquireAccounts(count: number): Promise<BrowserSession[]> {
  while (pool.length < count) {
    pool.push(await signInAnonymously());
  }
  borrowed = Math.max(borrowed, count);
  const taken = pool.slice(0, count);
  await Promise.all(taken.map((session) => resetAccount(session.userId)));
  return taken;
}

/** Delete every progression row this user owns, leaving the auth user intact. */
export async function resetAccount(userId: string): Promise<void> {
  const admin = serviceClient();
  for (const table of PROGRESSION_TABLES) {
    await admin.from(table).delete().eq("user_id", userId);
  }
}

/**
 * Delete every pooled auth user. Called from a file's teardown, so the suite
 * leaves a project no dirtier than it found it — the accumulation half of D50.
 */
export async function releaseAccounts(): Promise<void> {
  const users = pool.splice(0);
  borrowed = 0;
  await Promise.all(users.map((session) => deleteUser(session.userId)));
}

/**
 * Print the sign-in count for this file. Read from the run's output and put in
 * the milestone report, so the number that decides whether the dashboard limit
 * can go back to 30 is measured rather than guessed.
 */
export function reportSignIns(label: string): void {
  console.info(
    `[supabase suite] ${label}: ${String(signInCount)} anonymous sign-in(s), ` +
      `${String(pool.length)} pooled account(s)`,
  );
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
