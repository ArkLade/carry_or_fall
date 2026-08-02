/**
 * The contract suite against real PostgreSQL (M5.9, `docs/M5_ISSUES.md` §10).
 *
 * The **same assertions** `progression-memory.test.ts` runs in CI, executed
 * against `SupabaseStore` and the SQL functions in `supabase/migrations/`. This
 * is the run that proves `settle_match_reward` is genuinely atomic and
 * idempotent — including its concurrency behavior, which no in-process fake can
 * demonstrate, because the guarantee there comes from a unique index and a
 * transaction rather than from JavaScript's single thread.
 *
 * Skips without credentials (`docs/DECISIONS.md` D46).
 */
import { describe, it } from "vitest";

import { SupabaseStore } from "../src/progression/supabase-store";
import { describeProgressionContract, type StoreHarness } from "../test/progression-contract";
import { deleteUser, hasCredentials, serviceClient, signInAnonymously } from "./helpers";

if (!hasCredentials) {
  describe.skip("SupabaseStore (no credentials configured)", () => {
    it("is skipped", () => {
      /* Documented in docs/DATA_MODEL.md §9: CI cannot reach a project. */
    });
  });
} else {
  describeProgressionContract("SupabaseStore", async (): Promise<StoreHarness> => {
    // Real users, because every table's foreign key references auth.users and a
    // fabricated UUID would be rejected — which is itself worth exercising.
    const first = await signInAnonymously();
    const second = await signInAnonymously();
    const store = new SupabaseStore(
      process.env["SUPABASE_URL"] as string,
      process.env["SUPABASE_SECRET_KEY"] as string,
    );

    return {
      store,
      userId: first.userId,
      otherUserId: second.userId,
      newMatchId: () => crypto.randomUUID(),
      cleanup: async () => {
        await store.close();
        // Cascade removes every progression row these tests wrote.
        await deleteUser(first.userId);
        await deleteUser(second.userId);
      },
    };
  });

  describe("settle_match_reward under real concurrency", () => {
    it("applies exactly one award when many transactions race on one key", async () => {
      // The claim the memory store cannot support: the guarantee here is a
      // unique index plus `read committed`, not an event loop that happens to
      // serialize callers.
      const session = await signInAnonymously();
      const admin = serviceClient();
      const store = new SupabaseStore(
        process.env["SUPABASE_URL"] as string,
        process.env["SUPABASE_SECRET_KEY"] as string,
      );
      const matchId = crypto.randomUUID();
      const points = { force: 5, precision: 0, motion: 0, guard: 0, signal: 0 };

      try {
        await store.ensureAccount(session.userId, "Runner-CONCURRENT", []);

        const attempts = Array.from({ length: 12 }, () =>
          store.settleRun({
            settlementKey: `${matchId}:${session.userId}`,
            matchId,
            userId: session.userId,
            outcome: "extracted",
            payload: {
              outcome: "extracted",
              points,
              itemsConverted: 1,
              itemsLost: 0,
              contentVersion: 2,
            },
            points,
            unlocks: [],
            startedAt: new Date(),
            endedAt: new Date(),
          }),
        );
        const results = await Promise.all(attempts);

        const applied = results.filter((result) => !result.alreadySettled);
        if (applied.length !== 1) {
          throw new Error(`expected exactly one applied settlement, got ${String(applied.length)}`);
        }

        const account = await store.loadAccount(session.userId);
        if (account?.balances.force !== points.force) {
          throw new Error(
            `expected force ${String(points.force)}, got ${String(account?.balances.force)}`,
          );
        }

        // Exactly one ledger row, which is the database-level statement of the
        // same fact.
        const ledger = await admin
          .from("reward_ledger")
          .select("settlement_key")
          .eq("user_id", session.userId);
        if ((ledger.data ?? []).length !== 1) {
          throw new Error(`expected one ledger row, got ${String((ledger.data ?? []).length)}`);
        }
      } finally {
        await deleteUser(session.userId);
      }
    }, 60_000);
  });
}
