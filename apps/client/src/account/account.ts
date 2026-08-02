/**
 * The player's account, from the browser's side (M5.5/M5.8,
 * `docs/M5_ISSUES.md` §6, §9).
 *
 * Technical plan §17.1's instant-guest-play flow, in order: create an anonymous
 * Supabase user, keep the session in browser storage, play immediately. No
 * registration, no email, no interstitial — §17.2 is explicit that registration
 * must not be required before the first match.
 *
 * Everything here **reads**. The client displays balances and unlocks; it never
 * computes them, never writes them, and could not if it tried — no browser
 * policy permits writing `point_balances` or `unlocks` (`docs/DATA_MODEL.md`
 * §5.2). Reading them directly with the publishable key is not a shortcut around
 * the server; it is the row-level-security read path working as designed, and
 * exercising it from the browser is how we know the policies are right.
 */
import {
  DEFAULT_UNLOCK_IDS,
  type PointBalances,
  type UnlockDefinition,
  ALL_UNLOCKS,
} from "@carry-or-fall/game-content";

import { getSupabaseClient } from "./supabase-client";

const ZERO_BALANCES: PointBalances = {
  force: 0,
  precision: 0,
  motion: 0,
  guard: 0,
  signal: 0,
};

/** What the client knows about the signed-in account. */
export interface AccountState {
  /** `false` when this build has no Supabase project — the game still plays. */
  readonly signedIn: boolean;
  readonly userId: string | null;
  /** Technical plan §17.3: an anonymous account cannot be recovered. */
  readonly isAnonymous: boolean;
  readonly accessToken: string | null;
  readonly balances: PointBalances;
  readonly unlockIds: readonly string[];
}

export const UNCONFIGURED_ACCOUNT: AccountState = {
  signedIn: false,
  userId: null,
  isAnonymous: false,
  accessToken: null,
  balances: ZERO_BALANCES,
  // Everything, mirroring what a server with no persistence provisions
  // (`apps/server/src/server.ts`): with nothing accumulating across runs there is
  // no progression to gate, so showing five of ten skills as permanently locked
  // in a build that gates nothing would be a lie the player could never act on.
  unlockIds: ALL_UNLOCKS.map((unlock) => unlock.id),
};

function toNumber(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

function toBalances(row: Record<string, unknown> | null): PointBalances {
  if (row === null) {
    return ZERO_BALANCES;
  }
  return {
    force: toNumber(row["force"]),
    precision: toNumber(row["precision"]),
    motion: toNumber(row["motion"]),
    guard: toNumber(row["guard"]),
    signal: toNumber(row["signal"]),
  };
}

/**
 * Sign in (anonymously, on a first visit) and read this account's progression.
 *
 * Never throws: a failure to reach Supabase must not stop the player from
 * playing. It resolves to {@link UNCONFIGURED_ACCOUNT}, the server admits the
 * tokenless join if it is also unconfigured, and if the server *is* configured
 * it refuses the join with a message the player can act on — which is the right
 * place for that refusal, not here.
 */
export async function signInAndLoadAccount(): Promise<AccountState> {
  const supabase = getSupabaseClient();
  if (supabase === null) {
    return UNCONFIGURED_ACCOUNT;
  }

  try {
    const existing = await supabase.auth.getSession();
    let session = existing.data.session;

    if (session === null) {
      // Technical plan §17.1 step 1. The account is real from this moment: it
      // has a row in auth.users and accumulates progression exactly like a
      // linked one — the only difference is that it cannot be recovered (§17.3).
      const created = await supabase.auth.signInAnonymously();
      if (created.error !== null) {
        return UNCONFIGURED_ACCOUNT;
      }
      session = created.data.session;
    }

    if (session === null) {
      return UNCONFIGURED_ACCOUNT;
    }

    const [balances, unlocks] = await Promise.all([
      supabase.from("point_balances").select("*").maybeSingle(),
      supabase.from("unlocks").select("unlock_id"),
    ]);

    return {
      signedIn: true,
      userId: session.user.id,
      isAnonymous: session.user.is_anonymous === true,
      accessToken: session.access_token,
      // No `.eq("user_id", …)` filter is needed and none is written: the policy
      // already restricts the result to this user's rows. A filter here would
      // read as though it were the thing keeping other players' rows out, which
      // it is not.
      balances: toBalances((balances.data as Record<string, unknown> | null) ?? null),
      unlockIds:
        unlocks.data === null
          ? DEFAULT_UNLOCK_IDS
          : unlocks.data.map((row) => String(row.unlock_id)),
    };
  } catch {
    return UNCONFIGURED_ACCOUNT;
  }
}

/** Every unlock definition, marked by whether this account holds it. */
export interface UnlockStatus {
  readonly definition: UnlockDefinition;
  readonly unlocked: boolean;
}

export function describeUnlocks(account: AccountState): readonly UnlockStatus[] {
  const owned = new Set(account.unlockIds);
  return ALL_UNLOCKS.map((definition) => ({ definition, unlocked: owned.has(definition.id) }));
}
