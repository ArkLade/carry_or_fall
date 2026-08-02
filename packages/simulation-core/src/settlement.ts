/**
 * Turning a finished run into the thing that gets written (M5.3,
 * `docs/M5_ISSUES.md` §4). Two pure functions, no I/O, no client input.
 *
 * This is technical plan §15.3 step 6 — "build immutable reward payload" — and
 * nothing more. Steps 7-8 (writing it atomically and marking it settled) belong
 * to the server's progression store, and steps 1-5 already happened inside the
 * simulation: `run-result.ts` decided, from state no client can see or set, what
 * the player was carrying and how their run ended. This module only re-shapes
 * that decision for storage.
 *
 * The consequence worth stating plainly: **a reward is a function of the
 * server's own `RunResult`.** There is no argument here a client could
 * influence, because there is no client→server message capable of expressing a
 * point value, an item's worth, an unlock, or an outcome
 * (`docs/DATA_MODEL.md` §6).
 */
import type { PointTotals } from "./points";
import type { RunResult } from "./world";

/**
 * The immutable record of what one finished run earned. Written verbatim into
 * `reward_ledger.reward_payload` and `match_results.reward_payload`, so its
 * shape is a storage contract: changing a field name is a data-model change, not
 * a refactor.
 *
 * `contentVersion` is stored with the payload because the point values that
 * produced it are content (`docs/DECISIONS.md` D34). A payload written under one
 * content version and read under another must be interpretable, and the only way
 * to interpret it is to know which table it came from.
 */
export interface RewardPayload {
  readonly outcome: "extracted" | "died";
  readonly points: PointTotals;
  readonly itemsConverted: number;
  readonly itemsLost: number;
  readonly contentVersion: number;
}

/**
 * Build the payload for a finished run.
 *
 * It deliberately re-uses `RunResult.pointsGained` rather than recomputing from
 * the inventory: `run-result.ts` already applied concept §4.3/§4.4's difference
 * between death (only the secure slot converts) and extraction (everything
 * converts), and computing it a second time here would be a second
 * implementation of a rule that must have exactly one.
 */
export function buildRewardPayload(runResult: RunResult, contentVersion: number): RewardPayload {
  return {
    outcome: runResult.outcome,
    points: runResult.pointsGained,
    itemsConverted: runResult.itemsConverted,
    itemsLost: runResult.itemsLost,
    contentVersion,
  };
}

/**
 * The idempotency key for one player's settlement of one match
 * (`docs/DATA_MODEL.md` §3.6).
 *
 * **Deterministic on purpose, and this is the milestone's load-bearing
 * detail.** A random nonce would make every retry a new key, so a server that
 * died after computing a reward and before learning whether the write landed
 * would have no safe way to try again — its second attempt would look like a
 * second settlement. Deriving the key from values the server already owns means
 * the retry collides with the row that may already exist, and the database
 * decides which of them is the one true award.
 *
 * It is also why crash recovery works at all: a reservation row carries the
 * match id and user id, so recovery reconstructs the *same* key the crashed
 * match's own settlement would have used (`docs/DATA_MODEL.md` §4.4).
 */
export function settlementKey(matchId: string, userId: string): string {
  return `${matchId}:${userId}`;
}

/**
 * The idempotency key for one player's secure-slot reservation in one match.
 *
 * The same shape as {@link settlementKey}, and unique for the same reason a
 * player can only ever have one: they have one secure slot, and concept §7.2
 * forbids emptying it during a run (`docs/M5_ISSUES.md` §1.8).
 */
export function reservationKey(matchId: string, userId: string): string {
  return `${matchId}:${userId}`;
}
