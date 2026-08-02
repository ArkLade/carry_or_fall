/**
 * The persistence contract (M5.4, `docs/M5_ISSUES.md` §5). Everything the
 * server does to permanent account data goes through this interface, and
 * nothing else in the server imports a database client.
 *
 * Two implementations: `SupabaseStore` (real PostgreSQL, `supabase-store.ts`)
 * and `MemoryStore` (in process, `memory-store.ts`). They exist as a pair on
 * purpose — CI has no credentials and cannot reach a Supabase project
 * (`docs/DECISIONS.md` D46), so the contract suite runs against the memory store
 * there and against the real one under `pnpm test:supabase`. The memory store
 * proves the server calls this contract correctly; only PostgreSQL proves the
 * SQL behind it is correct, and `docs/DATA_MODEL.md` §9 keeps those two claims
 * separate rather than letting the first stand in for the second.
 *
 * **The two guarantees every implementation owes**, because the milestone's exit
 * criteria rest on them:
 *
 * 1. {@link ProgressionStore.settleRun} is idempotent on the settlement key. A
 *    second call with a key already used awards nothing and returns the stored
 *    result with `alreadySettled: true`. This holds under concurrency, under
 *    retry, and across a process restart.
 * 2. {@link ProgressionStore.reserveSecureItem} resolves **only after the write
 *    has landed**. A failure rejects; it never resolves with a false success.
 *    Technical plan §14.3 and `docs/DEVELOPMENT_RULES.md` both require the
 *    secure action to be persisted before it is reported successful, and this is
 *    the boundary where that becomes true.
 *
 * What is deliberately *not* here: any notion of live match state. No position,
 * health, tick, projectile, or inventory crosses this interface, because
 * `docs/DECISIONS.md` D9 forbids Supabase from holding it and
 * `docs/DATA_MODEL.md` §1 states the boundary as the only two writes a match
 * performs.
 */
import type { PointTotals, RewardPayload } from "@carry-or-fall/simulation-core";

/** An account's five accumulated point balances (`point_balances`). */
export type Balances = PointTotals;

export const ZERO_BALANCES: Balances = {
  force: 0,
  precision: 0,
  motion: 0,
  guard: 0,
  signal: 0,
};

/** One unlock row to insert: the content id, and which content table it names. */
export interface UnlockGrant {
  readonly unlockId: string;
  readonly unlockType: "skill" | "weapon" | "armor";
}

/** Everything the join gate needs about an account (technical plan §19). */
export interface AccountSnapshot {
  readonly userId: string;
  readonly balances: Balances;
  /** Every unlock id this account holds — defaults plus everything earned. */
  readonly unlockIds: readonly string[];
}

/** What {@link ProgressionStore.settleRun} needs to write one finished run. */
export interface SettlementRequest {
  readonly settlementKey: string;
  readonly matchId: string;
  readonly userId: string;
  readonly outcome: "extracted" | "died" | "abandoned";
  readonly payload: RewardPayload;
  readonly points: PointTotals;
  /** Every threshold the *new* balance satisfies; inserted without duplication. */
  readonly unlocks: readonly UnlockGrant[];
  readonly startedAt: Date;
  readonly endedAt: Date;
}

export interface SettlementResult {
  /** True when this key had already been settled and nothing was awarded now. */
  readonly alreadySettled: boolean;
  readonly balances: Balances;
  readonly unlockIds: readonly string[];
}

export interface ReservationResult {
  readonly reservationKey: string;
  readonly itemId: string;
  readonly status: "pending" | "settled" | "cancelled";
  /** True when this key was already reserved — a retry, not a second reservation. */
  readonly alreadyReserved: boolean;
}

/** A reservation that outlived the room that made it (technical plan §14.3). */
export interface PendingReservation {
  readonly reservationKey: string;
  readonly matchId: string;
  readonly userId: string;
  readonly itemId: string;
}

export interface ProgressionStore {
  /**
   * Idempotent provisioning: the profile, the zeroed balances, and the account's
   * default unlocks (`docs/DATA_MODEL.md` §4.1). Returns the account as it now
   * stands, so a join needs one round trip rather than two.
   */
  ensureAccount(
    userId: string,
    displayName: string,
    defaultUnlocks: readonly UnlockGrant[],
  ): Promise<AccountSnapshot>;

  /** Read an account without provisioning it. */
  loadAccount(userId: string): Promise<AccountSnapshot | null>;

  /**
   * Reserve the secure slot's item. **Resolves only when the write has landed.**
   * Idempotent on the reservation key: a retry returns the existing row with
   * `alreadyReserved: true` rather than creating a second.
   */
  reserveSecureItem(
    reservationKey: string,
    matchId: string,
    userId: string,
    itemId: string,
  ): Promise<ReservationResult>;

  /**
   * Withdraw a reservation whose insertion never took effect (the source slot
   * changed during the write). Returns whether a `pending` row was moved to
   * `cancelled`; a reservation already settled is left alone.
   */
  cancelSecureReservation(reservationKey: string): Promise<boolean>;

  /**
   * Settle one finished run. Idempotent on `request.settlementKey` — see the
   * module comment's guarantee 1.
   */
  settleRun(request: SettlementRequest): Promise<SettlementResult>;

  /**
   * Every `pending` reservation this user holds, excluding the match they are
   * joining right now so a live reservation is never finalized underneath a
   * running room. The caller computes each reward from content and settles it
   * through {@link ProgressionStore.settleRun}.
   */
  listPendingReservations(
    userId: string,
    excludeMatchId: string | null,
  ): Promise<readonly PendingReservation[]>;

  /** Release any connection. Called on server shutdown. */
  close(): Promise<void>;
}
