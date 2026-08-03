/**
 * Settlement and crash recovery (M5.7, `docs/M5_ISSUES.md` §8; technical plan
 * §15.3, §14.3).
 *
 * The room observes a player's `runResult` becoming non-null and calls
 * {@link SettlementService.settle}. Nothing a client sends triggers this, and
 * nothing a client sends can influence what it awards: the payload comes from
 * the simulation's own record of what that player was carrying
 * (`simulation-core/settlement.ts`).
 *
 * **The retry rule**, which is technical plan §15.3's "if the database call
 * temporarily fails: retry with the same idempotency key, never calculate a
 * second independent reward": the payload is computed exactly once, held here,
 * and every retry sends that same object under that same key. A retry is
 * therefore indistinguishable from the original call, which is what makes it
 * safe to retry without knowing whether the previous attempt landed — the
 * dangerous case, because a network timeout looks identical whether the write
 * committed or not.
 *
 * Retries are bounded. When they run out, the settlement is abandoned *here* and
 * the `secure_reservations` row stays `pending`, which is not a loss: the next
 * join runs {@link SettlementService.recoverPending} and finishes it under the
 * same key. Retrying forever inside a room would hold a finished match open on a
 * database that is down.
 */
import {
  ALL_UNLOCKS,
  CONTENT_VERSION,
  DEFAULT_UNLOCKS,
  findLoot,
  isBossCore,
  unlockForBossCore,
  unlocksEarnedAt,
  type PointBalances,
  type UnlockDefinition,
} from "@carry-or-fall/game-content";
import {
  buildRewardPayload,
  pointsFromLoot,
  settlementKey,
  ZERO_POINTS,
  type PointTotals,
  type RewardPayload,
  type RunResult,
} from "@carry-or-fall/simulation-core";

import type { Logger } from "../logger";
import type {
  AccountSnapshot,
  Balances,
  ProgressionStore,
  SettlementResult,
  UnlockGrant,
} from "./store";

/** The default unlock grants a new account is provisioned with (`docs/DATA_MODEL.md` §4.1). */
export const DEFAULT_UNLOCK_GRANTS: readonly UnlockGrant[] = DEFAULT_UNLOCKS.map((unlock) => ({
  unlockId: unlock.id,
  unlockType: unlock.unlockType,
}));

/**
 * Every unlock the game defines. Used only when `DEV_UNLOCK_ALL` is set — a
 * development-server switch (`config/env.ts`), refused in production, that
 * provisions accounts with everything so the browser suite can exercise skills
 * a fresh account has not earned. The join gate still checks the account's set;
 * this changes what that set starts as, not whether it is consulted.
 */
export const ALL_UNLOCK_GRANTS: readonly UnlockGrant[] = ALL_UNLOCKS.map((unlock) => ({
  unlockId: unlock.id,
  unlockType: unlock.unlockType,
}));

function toGrants(unlocks: readonly UnlockDefinition[]): readonly UnlockGrant[] {
  return unlocks.map((unlock) => ({ unlockId: unlock.id, unlockType: unlock.unlockType }));
}

/**
 * Split this run's boss cores into the unlock they grant and the points a
 * duplicate converts into (M7, concept §11; `docs/DECISIONS.md` D67, D68).
 *
 * **The classification happens once, here, before the first write.** Which
 * branch a core takes depends on whether the account already holds its unlock,
 * and that changes the instant the first settlement lands — so re-deriving it
 * on a retry would classify the same core differently the second time. It never
 * gets the chance: `SettlementService.settle` computes the payload and the
 * grants once and reuses both across every attempt (technical plan §15.3), and
 * the store's idempotency on the settlement key means a recomputed
 * classification could not be applied even if one happened. `§12.4` of
 * `docs/M7_ISSUES.md` tests exactly that.
 *
 * An id this build cannot resolve is skipped rather than guessed at, the same
 * way {@link SettlementService.recoverPending} skips an unknown item: a
 * settlement written by a newer content version is not something to award from.
 */
export function classifyBossCores(
  bossCoreIds: readonly string[],
  heldUnlockIds: readonly string[],
): {
  readonly unlocks: readonly UnlockGrant[];
  readonly points: PointTotals;
  readonly duplicateCoreIds: readonly string[];
} {
  const held = new Set(heldUnlockIds);
  const unlocks: UnlockGrant[] = [];
  const duplicateCoreIds: string[] = [];
  let points: PointTotals = { ...ZERO_POINTS };

  for (const coreId of bossCoreIds) {
    const core = findLoot(coreId);
    if (core === null || !isBossCore(core)) {
      continue;
    }
    const unlock = unlockForBossCore(core.bossCore.permanentUnlockId);
    if (unlock === null) {
      continue;
    }
    if (held.has(unlock.id)) {
      // A duplicate. Concept §11: it does not become a second inventory object
      // — it never was one by this point — and converts to points instead.
      points = addPoints(points, core.bossCore.duplicateConversion);
      duplicateCoreIds.push(core.id);
      continue;
    }
    // First one. Granted once; two copies of the same core in one run collapse
    // here rather than producing two identical grants, because the second sees
    // the first in `held`.
    held.add(unlock.id);
    unlocks.push({ unlockId: unlock.id, unlockType: unlock.unlockType });
  }

  return { unlocks, points, duplicateCoreIds };
}

function addPoints(left: PointTotals, right: PointBalances): PointTotals {
  return {
    force: left.force + right.force,
    precision: left.precision + right.precision,
    motion: left.motion + right.motion,
    guard: left.guard + right.guard,
    signal: left.signal + right.signal,
  };
}

function addBalances(balances: Balances, points: PointTotals): Balances {
  return {
    force: balances.force + points.force,
    precision: balances.precision + points.precision,
    motion: balances.motion + points.motion,
    guard: balances.guard + points.guard,
    signal: balances.signal + points.signal,
  };
}

/** What the room needs back to tell the owning client what just happened. */
export interface SettlementOutcome {
  readonly alreadySettled: boolean;
  readonly balances: Balances;
  readonly unlockIds: readonly string[];
  /** Unlocks this settlement granted that the account did not already hold. */
  readonly newUnlockIds: readonly string[];
  /**
   * Boss cores this settlement converted to points instead of granting an
   * unlock, because the account already held it (M7, concept §11). Empty on an
   * already-settled repeat, exactly like {@link SettlementOutcome.newUnlockIds}.
   */
  readonly duplicateCoreIds: readonly string[];
}

export interface SettlementServiceOptions {
  readonly maxAttempts?: number;
  /** Overridable so a test does not spend real seconds backing off. */
  readonly retryDelayMs?: number;
}

const DEFAULT_MAX_ATTEMPTS = 3;
const DEFAULT_RETRY_DELAY_MS = 250;

export class SettlementService {
  private readonly maxAttempts: number;
  private readonly retryDelayMs: number;

  constructor(
    private readonly store: ProgressionStore,
    private readonly logger: Logger,
    options: SettlementServiceOptions = {},
  ) {
    this.maxAttempts = options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
    this.retryDelayMs = options.retryDelayMs ?? DEFAULT_RETRY_DELAY_MS;
  }

  /**
   * Settle one finished run. The unlock set passed to the store is *everything*
   * the new balance satisfies, not a computed difference: the store inserts them
   * without duplication, so a re-sent list is inert, while a difference computed
   * against a stale balance could skip an unlock forever.
   */
  async settle(args: {
    readonly matchId: string;
    readonly userId: string;
    readonly runResult: RunResult;
    readonly account: AccountSnapshot;
    readonly startedAt: Date;
    readonly endedAt: Date;
  }): Promise<SettlementOutcome | null> {
    const base = buildRewardPayload(args.runResult, CONTENT_VERSION);
    // Boss cores are resolved before anything is written, so the retry loop
    // below re-sends one fixed decision rather than making a new one.
    const cores = classifyBossCores(base.bossCoreIds, args.account.unlockIds);
    const points = addPoints(base.points, cores.points);
    const payload: RewardPayload = { ...base, points };

    const projected = addBalances(args.account.balances, points);
    const unlocks = [...toGrants(unlocksEarnedAt(projected)), ...cores.unlocks];

    return this.write({
      settlementKey: settlementKey(args.matchId, args.userId),
      matchId: args.matchId,
      userId: args.userId,
      outcome: args.runResult.outcome,
      payload,
      points: payload.points,
      unlocks,
      startedAt: args.startedAt,
      endedAt: args.endedAt,
      previouslyHeld: args.account.unlockIds,
      duplicateCoreIds: cores.duplicateCoreIds,
    });
  }

  /**
   * Finish reservations left `pending` by a server that died mid-match
   * (technical plan §14.3: "the next login or recovery job finalizes the
   * protected reward"). Called at join, before the player enters a new match.
   *
   * Each is settled under the key derived from **that reservation's own** match
   * and user — the identical key the crashed match's settlement would have used.
   * That is what makes recovery exactly-once rather than a second award: if the
   * match did settle before dying, the ledger row already exists and this awards
   * nothing.
   *
   * Only the secured item is recovered. The normal inventory is not: an
   * abandoned run's carried loot is lost (`docs/DECISIONS.md` D39), and the
   * secure slot is precisely the thing promised to survive.
   */
  async recoverPending(userId: string, currentMatchId: string | null): Promise<void> {
    let pending;
    try {
      pending = await this.store.listPendingReservations(userId, currentMatchId);
    } catch (error) {
      // A failed recovery must not block a join: the rows stay `pending` and the
      // next join tries again.
      this.logger.warn("could not list pending reservations", {
        userId,
        error: describeError(error),
      });
      return;
    }

    for (const reservation of pending) {
      const item = findLoot(reservation.itemId);
      if (item === null) {
        // The id names content this build does not have — a reservation written
        // by a newer or older server. Leave it `pending` rather than awarding a
        // guess; a build that knows the id will finish it.
        this.logger.warn("skipping reservation for unknown item", {
          userId,
          itemId: reservation.itemId,
        });
        continue;
      }

      const account = (await this.store.loadAccount(userId)) ?? {
        userId,
        balances: { ...ZERO_POINTS },
        unlockIds: [],
      };
      // A secured boss core is the case this recovery path exists for at its
      // sharpest: the player paid for the unlock with their secure slot and the
      // server died before writing it. Classified the same way a live
      // settlement classifies it, under the same key, so recovering twice grants
      // once (M7, `docs/M7_ISSUES.md` §12.8).
      const bossCoreIds = isBossCore(item) ? [item.id] : [];
      const cores = classifyBossCores(bossCoreIds, account.unlockIds);
      const points = addPoints(pointsFromLoot(item), cores.points);
      const payload: RewardPayload = {
        outcome: "died",
        points,
        itemsConverted: 1,
        itemsLost: 0,
        contentVersion: CONTENT_VERSION,
        bossCoreIds,
      };
      const now = new Date();

      const outcome = await this.write({
        settlementKey: settlementKey(reservation.matchId, userId),
        matchId: reservation.matchId,
        userId,
        outcome: "abandoned",
        payload,
        points,
        unlocks: [
          ...toGrants(unlocksEarnedAt(addBalances(account.balances, points))),
          ...cores.unlocks,
        ],
        startedAt: now,
        endedAt: now,
        previouslyHeld: account.unlockIds,
        duplicateCoreIds: cores.duplicateCoreIds,
      });

      this.logger.info("recovered a pending secure reservation", {
        userId,
        matchId: reservation.matchId,
        itemId: reservation.itemId,
        alreadySettled: outcome?.alreadySettled ?? null,
      });
    }
  }

  /**
   * The retry loop. One computed payload, one key, N attempts.
   *
   * A failure after the write committed (a timeout, a dropped connection) is
   * indistinguishable from one before it, so the retry simply repeats the same
   * call: if the first attempt did land, the store reports `alreadySettled` and
   * awards nothing. That is the entire safety argument, and it only works
   * because the key is deterministic and the payload is not recomputed.
   */
  private async write(
    request: Parameters<ProgressionStore["settleRun"]>[0] & {
      readonly previouslyHeld: readonly string[];
      readonly duplicateCoreIds: readonly string[];
    },
  ): Promise<SettlementOutcome | null> {
    const { previouslyHeld, duplicateCoreIds, ...settlement } = request;
    let lastError: unknown = null;

    for (let attempt = 1; attempt <= this.maxAttempts; attempt += 1) {
      try {
        const result = await this.store.settleRun(settlement);
        return toOutcome(result, previouslyHeld, duplicateCoreIds);
      } catch (error) {
        lastError = error;
        this.logger.warn("settlement attempt failed; will retry with the same key", {
          settlementKey: settlement.settlementKey,
          attempt,
          maxAttempts: this.maxAttempts,
          error: describeError(error),
        });
        if (attempt < this.maxAttempts) {
          await delay(this.retryDelayMs);
        }
      }
    }

    // Give up here, not forever. The reservation row (if any) stays `pending`
    // and join-time recovery finishes it under the same key.
    this.logger.error("settlement abandoned after retries; left for recovery", {
      settlementKey: settlement.settlementKey,
      userId: settlement.userId,
      error: describeError(lastError),
    });
    return null;
  }
}

function toOutcome(
  result: SettlementResult,
  previouslyHeld: readonly string[],
  duplicateCoreIds: readonly string[],
): SettlementOutcome {
  const held = new Set(previouslyHeld);
  return {
    alreadySettled: result.alreadySettled,
    balances: result.balances,
    unlockIds: result.unlockIds,
    // Reported only on the settlement that actually applied: an already-settled
    // retry has no news, and telling the player "you unlocked X" twice would be
    // the visible half of a double award even though nothing was awarded twice.
    newUnlockIds: result.alreadySettled ? [] : result.unlockIds.filter((id) => !held.has(id)),
    duplicateCoreIds: result.alreadySettled ? [] : duplicateCoreIds,
  };
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
