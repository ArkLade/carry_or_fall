/**
 * The in-process {@link ProgressionStore} (M5.4, `docs/M5_ISSUES.md` §5).
 *
 * It exists for two reasons, and it is worth being precise about which claims it
 * can and cannot support.
 *
 * **Reason 1 — a fresh clone and CI must work.** `docs/DECISIONS.md` D42's rule
 * is that an automated suite may not depend on a file policy forbids committing.
 * The root `.env` holds the Supabase credentials and is gitignored, so CI has
 * none. Without this store the server could not boot in CI, and thirty browser
 * tests plus every room integration test would fail for a reason that has
 * nothing to do with what they test.
 *
 * **Reason 2 — fault injection.** Making a real PostgreSQL call hang, or fail
 * *after* it committed, is awkward and slow. Here it is a field. That is what
 * lets `settlement-adversarial.test.ts` stage the crash cases the milestone's
 * exit criteria are judged on.
 *
 * **What it does not prove.** It is not evidence that the SQL in
 * `supabase/migrations/` is correct — not the transaction boundaries, not the
 * `on conflict` behavior under real concurrency, and not one row-level-security
 * policy. It reimplements the same *contract* in JavaScript, so a contract test
 * passing here means the server calls the store correctly. `pnpm test:supabase`
 * runs the identical assertions against real PostgreSQL, and
 * `docs/DATA_MODEL.md` §9 keeps the two claims apart.
 *
 * Never selected in production: `select-store.ts` throws when `NODE_ENV` is
 * `production` and Supabase is not configured.
 */
import type {
  AccountSnapshot,
  Balances,
  PendingReservation,
  ProgressionStore,
  ReservationResult,
  SettlementRequest,
  SettlementResult,
  UnlockGrant,
} from "./store";
import { ZERO_BALANCES } from "./store";

interface Account {
  balances: Balances;
  readonly unlockIds: Set<string>;
  displayName: string;
}

interface Reservation {
  readonly reservationKey: string;
  readonly matchId: string;
  readonly userId: string;
  readonly itemId: string;
  status: "pending" | "settled" | "cancelled";
}

interface LedgerEntry {
  readonly settlementKey: string;
  readonly result: SettlementResult;
}

/**
 * Faults a test can stage. Deliberately on the concrete class and not on
 * {@link ProgressionStore}: a fault hook reachable through the interface would
 * be a production code path that exists only for tests.
 */
export interface MemoryStoreFaults {
  /** Reject the next `reserveSecureItem` before writing anything. */
  failNextReserve?: boolean;
  /** Never resolve the next `reserveSecureItem` — a hung database call. */
  hangNextReserve?: boolean;
  /**
   * Apply the next `settleRun` fully, then reject. This is the dangerous
   * failure: the caller cannot tell whether its write landed, so it must retry,
   * and the retry must not award a second time.
   */
  failNextSettleAfterCommit?: boolean;
  /** Reject the next `settleRun` before writing anything. */
  failNextSettleBeforeCommit?: boolean;
}

export class MemoryStore implements ProgressionStore {
  private readonly accounts = new Map<string, Account>();
  private readonly reservations = new Map<string, Reservation>();
  /** Keyed on the settlement key — the same uniqueness `reward_ledger` enforces. */
  private readonly ledger = new Map<string, LedgerEntry>();
  /** Keyed on `matchId:userId` — the same uniqueness `reward_ledger`'s primary key enforces. */
  private readonly ledgerByMatchUser = new Map<string, string>();

  readonly faults: MemoryStoreFaults = {};

  /** How many settlements actually applied an award. Tests assert this is 1. */
  private appliedSettlements = 0;

  get appliedSettlementCount(): number {
    return this.appliedSettlements;
  }

  ensureAccount(
    userId: string,
    displayName: string,
    defaultUnlocks: readonly UnlockGrant[],
  ): Promise<AccountSnapshot> {
    let account = this.accounts.get(userId);
    if (account === undefined) {
      account = { balances: { ...ZERO_BALANCES }, unlockIds: new Set(), displayName };
      this.accounts.set(userId, account);
    }
    for (const grant of defaultUnlocks) {
      account.unlockIds.add(grant.unlockId);
    }
    return Promise.resolve(snapshot(userId, account));
  }

  loadAccount(userId: string): Promise<AccountSnapshot | null> {
    const account = this.accounts.get(userId);
    return Promise.resolve(account === undefined ? null : snapshot(userId, account));
  }

  async reserveSecureItem(
    reservationKey: string,
    matchId: string,
    userId: string,
    itemId: string,
  ): Promise<ReservationResult> {
    if (this.faults.hangNextReserve === true) {
      this.faults.hangNextReserve = false;
      // Never settles. The caller must be structured so that a reservation that
      // never lands leaves the item in normal inventory.
      await new Promise<never>(() => {
        /* intentionally never resolves */
      });
    }
    if (this.faults.failNextReserve === true) {
      this.faults.failNextReserve = false;
      throw new Error("reserve_secure_item failed (injected)");
    }

    const existing = this.reservations.get(reservationKey);
    if (existing !== undefined) {
      return {
        reservationKey,
        itemId: existing.itemId,
        status: existing.status,
        alreadyReserved: true,
      };
    }

    this.reservations.set(reservationKey, {
      reservationKey,
      matchId,
      userId,
      itemId,
      status: "pending",
    });
    return { reservationKey, itemId, status: "pending", alreadyReserved: false };
  }

  cancelSecureReservation(reservationKey: string): Promise<boolean> {
    const reservation = this.reservations.get(reservationKey);
    if (reservation === undefined || reservation.status !== "pending") {
      return Promise.resolve(false);
    }
    reservation.status = "cancelled";
    return Promise.resolve(true);
  }

  async settleRun(request: SettlementRequest): Promise<SettlementResult> {
    if (this.faults.failNextSettleBeforeCommit === true) {
      this.faults.failNextSettleBeforeCommit = false;
      throw new Error("settle_match_reward failed before commit (injected)");
    }

    // Yield once before the uniqueness check so concurrent callers genuinely
    // interleave here. Without it, JavaScript's single-threaded run-to-completion
    // would serialize them for free and the concurrency test would prove nothing
    // about the guard — it would prove only that the event loop exists.
    await Promise.resolve();

    const result = this.applySettlement(request);

    if (this.faults.failNextSettleAfterCommit === true) {
      this.faults.failNextSettleAfterCommit = false;
      // The write landed and the caller will never learn it. This is exactly the
      // state a network timeout leaves a caller in.
      throw new Error("settle_match_reward failed after commit (injected)");
    }

    return result;
  }

  listPendingReservations(
    userId: string,
    excludeMatchId: string | null,
  ): Promise<readonly PendingReservation[]> {
    const pending = [...this.reservations.values()]
      .filter(
        (reservation) =>
          reservation.userId === userId &&
          reservation.status === "pending" &&
          (excludeMatchId === null || reservation.matchId !== excludeMatchId),
      )
      .map(({ reservationKey, matchId, userId: owner, itemId }) => ({
        reservationKey,
        matchId,
        userId: owner,
        itemId,
      }));
    return Promise.resolve(pending);
  }

  close(): Promise<void> {
    return Promise.resolve();
  }

  /** Test helper: the reservation's current status, or `null` if there is none. */
  reservationStatus(reservationKey: string): "pending" | "settled" | "cancelled" | null {
    return this.reservations.get(reservationKey)?.status ?? null;
  }

  /**
   * The transactional body, mirroring `settle_match_reward`. Synchronous by
   * design: between the uniqueness check and the balance update there is no
   * `await`, which is this store's equivalent of the SQL function's single
   * transaction. An `await` in the middle would let two concurrent callers both
   * pass the check.
   */
  private applySettlement(request: SettlementRequest): SettlementResult {
    const matchUserKey = `${request.matchId} ${request.userId}`;
    const priorKey = this.ledger.has(request.settlementKey)
      ? request.settlementKey
      : this.ledgerByMatchUser.get(matchUserKey);

    if (priorKey !== undefined) {
      const prior = this.ledger.get(priorKey);
      if (prior !== undefined) {
        return { ...prior.result, alreadySettled: true };
      }
    }

    const account =
      this.accounts.get(request.userId) ??
      (() => {
        const fresh: Account = {
          balances: { ...ZERO_BALANCES },
          unlockIds: new Set<string>(),
          displayName: request.userId,
        };
        this.accounts.set(request.userId, fresh);
        return fresh;
      })();

    account.balances = {
      force: account.balances.force + request.points.force,
      precision: account.balances.precision + request.points.precision,
      motion: account.balances.motion + request.points.motion,
      guard: account.balances.guard + request.points.guard,
      signal: account.balances.signal + request.points.signal,
    };
    for (const grant of request.unlocks) {
      account.unlockIds.add(grant.unlockId);
    }

    const reservation = [...this.reservations.values()].find(
      (candidate) =>
        candidate.matchId === request.matchId &&
        candidate.userId === request.userId &&
        candidate.status === "pending",
    );
    if (reservation !== undefined) {
      reservation.status = "settled";
    }

    const result: SettlementResult = {
      alreadySettled: false,
      balances: { ...account.balances },
      unlockIds: [...account.unlockIds].sort(),
    };

    this.ledger.set(request.settlementKey, { settlementKey: request.settlementKey, result });
    this.ledgerByMatchUser.set(matchUserKey, request.settlementKey);
    this.appliedSettlements += 1;
    return result;
  }
}

function snapshot(userId: string, account: Account): AccountSnapshot {
  return {
    userId,
    balances: { ...account.balances },
    unlockIds: [...account.unlockIds].sort(),
  };
}
