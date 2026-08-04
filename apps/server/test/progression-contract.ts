/**
 * The `ProgressionStore` contract, as assertions (M5.9, `docs/M5_ISSUES.md`
 * §10).
 *
 * **Written once, run twice.** These same test bodies execute against
 * `MemoryStore` in CI (`progression-memory.test.ts`) and against a real Supabase
 * project under `pnpm test:supabase` (`supabase-tests/`). That is the whole
 * point of the split `docs/DATA_MODEL.md` §9 describes: the memory run proves
 * the server calls the contract correctly, and only the PostgreSQL run proves
 * the SQL implementing it is correct. Neither claim substitutes for the other,
 * and the final report states both separately.
 *
 * Nothing here is a fixture of the store's own constants — every assertion is
 * about behavior under an attack: settle twice, settle concurrently, settle
 * after a failure whose outcome the caller cannot know.
 */
import { describe, expect, it } from "vitest";

import { honingStone, warlordsSeal } from "@carry-or-fall/game-content";
import { settlementKey, reservationKey } from "@carry-or-fall/simulation-core";

import type { ProgressionStore, SettlementRequest, UnlockGrant } from "../src/progression/store";

/** A fresh store plus a user id that exists in it, per test. */
export interface StoreHarness {
  readonly store: ProgressionStore;
  /** A user that exists in whatever identity system this backend uses. */
  readonly userId: string;
  /** A second, unrelated user — isolation must hold between them. */
  readonly otherUserId: string;
  /** A fresh match id per call. */
  newMatchId(): string;
  cleanup(): Promise<void>;
}

const SKILL_UNLOCK: UnlockGrant = { unlockId: "stunning_blows", unlockType: "skill" };

function request(
  matchId: string,
  userId: string,
  overrides: Partial<SettlementRequest> = {},
): SettlementRequest {
  const points = warlordsSeal.points;
  return {
    settlementKey: settlementKey(matchId, userId),
    matchId,
    userId,
    outcome: "extracted",
    payload: {
      outcome: "extracted",
      points,
      itemsConverted: 1,
      itemsLost: 0,
      contentVersion: 2,
      bossCoreIds: [],
    },
    points,
    unlocks: [],
    startedAt: new Date("2026-08-01T00:00:00.000Z"),
    endedAt: new Date("2026-08-01T00:05:00.000Z"),
    ...overrides,
  };
}

/**
 * Register the shared suite against one backend. `createHarness` is called
 * afresh per test so no test can pass because a previous one left state behind.
 */
export function describeProgressionContract(
  label: string,
  createHarness: () => Promise<StoreHarness>,
): void {
  describe(`${label}: account provisioning`, () => {
    it("provisions a new account with zeroed balances and its default unlocks", async () => {
      const harness = await createHarness();
      try {
        const account = await harness.store.ensureAccount(harness.userId, "Runner-TEST", [
          { unlockId: "ricochet", unlockType: "skill" },
          { unlockId: "basic_sword", unlockType: "weapon" },
        ]);

        expect(account.balances).toEqual({
          force: 0,
          precision: 0,
          motion: 0,
          guard: 0,
          signal: 0,
        });
        expect([...account.unlockIds].sort()).toEqual(["basic_sword", "ricochet"]);
      } finally {
        await harness.cleanup();
      }
    });

    it("is idempotent: provisioning twice does not duplicate unlocks or reset balances", async () => {
      const harness = await createHarness();
      try {
        const defaults: UnlockGrant[] = [{ unlockId: "ricochet", unlockType: "skill" }];
        await harness.store.ensureAccount(harness.userId, "Runner-TEST", defaults);
        await harness.store.settleRun(request(harness.newMatchId(), harness.userId));

        const again = await harness.store.ensureAccount(harness.userId, "Runner-TEST", defaults);

        expect(again.unlockIds.filter((id) => id === "ricochet")).toHaveLength(1);
        // The balance earned above survives a second provisioning call — which is
        // what happens on every subsequent join.
        expect(again.balances.force).toBe(warlordsSeal.points.force);
      } finally {
        await harness.cleanup();
      }
    });
  });

  describe(`${label}: extracted points persist (§38 M5 exit criterion 1)`, () => {
    it("adds a settled run's points to the account's balance", async () => {
      const harness = await createHarness();
      try {
        await harness.store.ensureAccount(harness.userId, "Runner-TEST", []);
        const result = await harness.store.settleRun(request(harness.newMatchId(), harness.userId));

        expect(result.alreadySettled).toBe(false);
        expect(result.balances).toEqual(warlordsSeal.points);

        // Read back through a separate call: a balance that only exists in the
        // settlement's return value has not persisted anything.
        const reloaded = await harness.store.loadAccount(harness.userId);
        expect(reloaded?.balances).toEqual(warlordsSeal.points);
      } finally {
        await harness.cleanup();
      }
    });

    it("accumulates across separate matches", async () => {
      const harness = await createHarness();
      try {
        await harness.store.ensureAccount(harness.userId, "Runner-TEST", []);
        await harness.store.settleRun(request(harness.newMatchId(), harness.userId));
        await harness.store.settleRun(request(harness.newMatchId(), harness.userId));

        const reloaded = await harness.store.loadAccount(harness.userId);
        expect(reloaded?.balances.force).toBe(warlordsSeal.points.force * 2);
      } finally {
        await harness.cleanup();
      }
    });

    it("grants a crossed threshold's unlock exactly once across two settlements", async () => {
      const harness = await createHarness();
      try {
        await harness.store.ensureAccount(harness.userId, "Runner-TEST", []);
        const first = await harness.store.settleRun(
          request(harness.newMatchId(), harness.userId, { unlocks: [SKILL_UNLOCK] }),
        );
        expect(first.unlockIds).toContain(SKILL_UNLOCK.unlockId);

        // A second run whose balance still satisfies the same threshold re-sends
        // the same unlock — which must be inert, not a duplicate row.
        const second = await harness.store.settleRun(
          request(harness.newMatchId(), harness.userId, { unlocks: [SKILL_UNLOCK] }),
        );
        expect(second.unlockIds.filter((id) => id === SKILL_UNLOCK.unlockId)).toHaveLength(1);
      } finally {
        await harness.cleanup();
      }
    });

    it("keeps two accounts' progression separate", async () => {
      const harness = await createHarness();
      try {
        await harness.store.ensureAccount(harness.userId, "Runner-A", []);
        await harness.store.ensureAccount(harness.otherUserId, "Runner-B", []);
        await harness.store.settleRun(request(harness.newMatchId(), harness.userId));

        const other = await harness.store.loadAccount(harness.otherUserId);
        expect(other?.balances).toEqual({
          force: 0,
          precision: 0,
          motion: 0,
          guard: 0,
          signal: 0,
        });
      } finally {
        await harness.cleanup();
      }
    });
  });

  describe(`${label}: duplicate settlement (§38 M5 exit criterion 3)`, () => {
    it("attack 1 — the same run settled twice awards once", async () => {
      const harness = await createHarness();
      try {
        await harness.store.ensureAccount(harness.userId, "Runner-TEST", []);
        const matchId = harness.newMatchId();

        const first = await harness.store.settleRun(request(matchId, harness.userId));
        const second = await harness.store.settleRun(request(matchId, harness.userId));

        expect(first.alreadySettled).toBe(false);
        expect(second.alreadySettled).toBe(true);
        // The second call returns the *existing* result, not a doubled one.
        expect(second.balances).toEqual(first.balances);

        const reloaded = await harness.store.loadAccount(harness.userId);
        expect(reloaded?.balances).toEqual(warlordsSeal.points);
      } finally {
        await harness.cleanup();
      }
    });

    it("attack 2 — concurrent settlement of one run awards once", async () => {
      const harness = await createHarness();
      try {
        await harness.store.ensureAccount(harness.userId, "Runner-TEST", []);
        const matchId = harness.newMatchId();

        // Eight simultaneous calls with one key: the same shape as a room and a
        // recovery pass racing, or a retry overlapping its own original.
        const results = await Promise.all(
          Array.from({ length: 8 }, () =>
            harness.store.settleRun(request(matchId, harness.userId)),
          ),
        );

        const applied = results.filter((result) => !result.alreadySettled);
        expect(applied).toHaveLength(1);

        const reloaded = await harness.store.loadAccount(harness.userId);
        expect(reloaded?.balances).toEqual(warlordsSeal.points);
      } finally {
        await harness.cleanup();
      }
    });

    it("attack 3 — a settlement retried under the same key after a failure awards once", async () => {
      const harness = await createHarness();
      try {
        await harness.store.ensureAccount(harness.userId, "Runner-TEST", []);
        const matchId = harness.newMatchId();

        // The first attempt lands. The caller does not learn that — this models a
        // response lost on the way back — and retries with the same key, which is
        // exactly what technical plan §15.3 instructs.
        await harness.store.settleRun(request(matchId, harness.userId));
        const retry = await harness.store.settleRun(request(matchId, harness.userId));

        expect(retry.alreadySettled).toBe(true);
        const reloaded = await harness.store.loadAccount(harness.userId);
        expect(reloaded?.balances).toEqual(warlordsSeal.points);
      } finally {
        await harness.cleanup();
      }
    });

    it("attack 5 — a crash before the write, recovered later, awards once", async () => {
      const harness = await createHarness();
      try {
        await harness.store.ensureAccount(harness.userId, "Runner-TEST", []);
        const matchId = harness.newMatchId();

        // The room secured an item and then died without settling. Recovery
        // reconstructs the settlement key from the reservation alone.
        await harness.store.reserveSecureItem(
          reservationKey(matchId, harness.userId),
          matchId,
          harness.userId,
          honingStone.id,
        );

        const pending = await harness.store.listPendingReservations(harness.userId, null);
        expect(pending).toHaveLength(1);
        expect(pending[0]?.itemId).toBe(honingStone.id);

        const recovered = await harness.store.settleRun(
          request(matchId, harness.userId, {
            outcome: "abandoned",
            points: honingStone.points,
          }),
        );
        expect(recovered.alreadySettled).toBe(false);

        // Recovery running a second time — two servers restarting, or a join
        // retried — must find nothing left to do.
        const stillPending = await harness.store.listPendingReservations(harness.userId, null);
        expect(stillPending).toHaveLength(0);

        const again = await harness.store.settleRun(
          request(matchId, harness.userId, { outcome: "abandoned", points: honingStone.points }),
        );
        expect(again.alreadySettled).toBe(true);

        const reloaded = await harness.store.loadAccount(harness.userId);
        expect(reloaded?.balances.force).toBe(honingStone.points.force);
      } finally {
        await harness.cleanup();
      }
    });

    it("attack 5b — a crash *after* the write, recovered later, awards once", async () => {
      const harness = await createHarness();
      try {
        await harness.store.ensureAccount(harness.userId, "Runner-TEST", []);
        const matchId = harness.newMatchId();
        await harness.store.reserveSecureItem(
          reservationKey(matchId, harness.userId),
          matchId,
          harness.userId,
          honingStone.id,
        );

        // The match settled normally, then the process died before it could tell
        // anyone. Recovery under the same key must be a no-op — this is the case
        // a random idempotency key would get wrong.
        await harness.store.settleRun(request(matchId, harness.userId));
        const recovery = await harness.store.settleRun(
          request(matchId, harness.userId, { outcome: "abandoned", points: honingStone.points }),
        );

        expect(recovery.alreadySettled).toBe(true);
        const reloaded = await harness.store.loadAccount(harness.userId);
        expect(reloaded?.balances).toEqual(warlordsSeal.points);
      } finally {
        await harness.cleanup();
      }
    });

    it("does not confuse two players settling the same match", async () => {
      const harness = await createHarness();
      try {
        await harness.store.ensureAccount(harness.userId, "Runner-A", []);
        await harness.store.ensureAccount(harness.otherUserId, "Runner-B", []);
        const matchId = harness.newMatchId();

        const a = await harness.store.settleRun(request(matchId, harness.userId));
        const b = await harness.store.settleRun(request(matchId, harness.otherUserId));

        // One match, two settlements, both first-time: the key is per player.
        expect(a.alreadySettled).toBe(false);
        expect(b.alreadySettled).toBe(false);
      } finally {
        await harness.cleanup();
      }
    });
  });

  describe(`${label}: secure-slot progress persists after death (§38 M5 exit criterion 2)`, () => {
    it("records a reservation and marks it settled when the run is settled", async () => {
      const harness = await createHarness();
      try {
        await harness.store.ensureAccount(harness.userId, "Runner-TEST", []);
        const matchId = harness.newMatchId();
        const key = reservationKey(matchId, harness.userId);

        const reservation = await harness.store.reserveSecureItem(
          key,
          matchId,
          harness.userId,
          warlordsSeal.id,
        );
        expect(reservation.status).toBe("pending");
        expect(reservation.alreadyReserved).toBe(false);

        // Death converts the secure slot (concept §4.4), so the settlement
        // carries that item's points.
        await harness.store.settleRun(
          request(matchId, harness.userId, { outcome: "died", points: warlordsSeal.points }),
        );

        expect(await harness.store.listPendingReservations(harness.userId, null)).toHaveLength(0);
        const reloaded = await harness.store.loadAccount(harness.userId);
        expect(reloaded?.balances).toEqual(warlordsSeal.points);
      } finally {
        await harness.cleanup();
      }
    });

    it("is idempotent on the reservation key: a retried reserve creates no second row", async () => {
      const harness = await createHarness();
      try {
        await harness.store.ensureAccount(harness.userId, "Runner-TEST", []);
        const matchId = harness.newMatchId();
        const key = reservationKey(matchId, harness.userId);

        await harness.store.reserveSecureItem(key, matchId, harness.userId, warlordsSeal.id);
        const retry = await harness.store.reserveSecureItem(
          key,
          matchId,
          harness.userId,
          warlordsSeal.id,
        );

        expect(retry.alreadyReserved).toBe(true);
        expect(retry.itemId).toBe(warlordsSeal.id);
        expect(await harness.store.listPendingReservations(harness.userId, null)).toHaveLength(1);
      } finally {
        await harness.cleanup();
      }
    });

    it("cancels a reservation whose insertion never took effect, awarding nothing", async () => {
      const harness = await createHarness();
      try {
        await harness.store.ensureAccount(harness.userId, "Runner-TEST", []);
        const matchId = harness.newMatchId();
        const key = reservationKey(matchId, harness.userId);

        await harness.store.reserveSecureItem(key, matchId, harness.userId, warlordsSeal.id);
        expect(await harness.store.cancelSecureReservation(key)).toBe(true);

        // Cancelled is not pending: recovery must not later honor it.
        expect(await harness.store.listPendingReservations(harness.userId, null)).toHaveLength(0);
        // Cancelling twice is not an error, and still awards nothing.
        expect(await harness.store.cancelSecureReservation(key)).toBe(false);

        const reloaded = await harness.store.loadAccount(harness.userId);
        expect(reloaded?.balances.force).toBe(0);
      } finally {
        await harness.cleanup();
      }
    });

    it("excludes the match a player is currently joining from recovery", async () => {
      const harness = await createHarness();
      try {
        await harness.store.ensureAccount(harness.userId, "Runner-TEST", []);
        const liveMatch = harness.newMatchId();
        await harness.store.reserveSecureItem(
          reservationKey(liveMatch, harness.userId),
          liveMatch,
          harness.userId,
          warlordsSeal.id,
        );

        // A live reservation must never be finalized underneath the room that
        // made it — that would settle a run still in progress.
        expect(await harness.store.listPendingReservations(harness.userId, liveMatch)).toHaveLength(
          0,
        );
        expect(await harness.store.listPendingReservations(harness.userId, null)).toHaveLength(1);
      } finally {
        await harness.cleanup();
      }
    });

    it("does not surface one player's pending reservation to another", async () => {
      const harness = await createHarness();
      try {
        await harness.store.ensureAccount(harness.userId, "Runner-A", []);
        await harness.store.ensureAccount(harness.otherUserId, "Runner-B", []);
        const matchId = harness.newMatchId();
        await harness.store.reserveSecureItem(
          reservationKey(matchId, harness.userId),
          matchId,
          harness.userId,
          warlordsSeal.id,
        );

        expect(await harness.store.listPendingReservations(harness.otherUserId, null)).toHaveLength(
          0,
        );
      } finally {
        await harness.cleanup();
      }
    });
  });
}
