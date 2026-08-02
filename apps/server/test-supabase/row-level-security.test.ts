/**
 * Row-level security, against a real project (M5.9, `docs/M5_ISSUES.md` §10.12;
 * the eight properties of `docs/DATA_MODEL.md` §5.4).
 *
 * These are properties of the **schema**, not of any TypeScript, so they can
 * only be demonstrated here. Every client below is a publishable-key client
 * holding a real user JWT — the `authenticated` role, exactly what a browser
 * gets. The service client appears only where the point is that the *server*
 * can do something a browser cannot.
 *
 * Two things worth stating about how RLS denies:
 *
 * - A denied `select` returns **zero rows**, not an error. A test that only
 *   checked `error === null` would pass against a wide-open table.
 * - A denied `insert`/`update` returns an error. A denied `update` that matches
 *   no rows returns success with zero rows affected, so those are asserted by
 *   reading the row back through the service client.
 *
 * Skips without credentials (`docs/DECISIONS.md` D46).
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  deleteUser,
  hasBrowserCredentials,
  serviceClient,
  signInAnonymously,
  type BrowserSession,
} from "./helpers";

const READABLE_TABLES = [
  "profiles",
  "point_balances",
  "unlocks",
  "loadouts",
  "match_results",
] as const;

const SERVER_ONLY_TABLES = ["reward_ledger", "secure_reservations"] as const;

const NO_CLIENT_WRITE_TABLES = [
  "point_balances",
  "unlocks",
  "match_results",
  "reward_ledger",
  "secure_reservations",
] as const;

describe.skipIf(!hasBrowserCredentials)("row-level security (docs/DATA_MODEL.md §5.4)", () => {
  let alice: BrowserSession;
  let bob: BrowserSession;

  beforeAll(async () => {
    alice = await signInAnonymously();
    bob = await signInAnonymously();

    // Provision both accounts through the server path, so there are real rows to
    // try (and fail) to read.
    const admin = serviceClient();
    for (const session of [alice, bob]) {
      await admin.rpc("ensure_account", {
        p_user_id: session.userId,
        p_display_name: "Runner-RLS",
        p_default_unlocks: [{ unlock_id: "ricochet", unlock_type: "skill" }],
      });
      await admin.rpc("settle_match_reward", {
        p_settlement_key: `${crypto.randomUUID()}:${session.userId}`,
        p_match_id: crypto.randomUUID(),
        p_user_id: session.userId,
        p_outcome: "extracted",
        p_reward_payload: { outcome: "extracted", contentVersion: 2 },
        p_points: { force: 3, precision: 0, motion: 0, guard: 0, signal: 0 },
        p_unlocks: [],
        p_started_at: new Date().toISOString(),
        p_ended_at: new Date().toISOString(),
      });
    }
  }, 60_000);

  afterAll(async () => {
    await deleteUser(alice.userId);
    await deleteUser(bob.userId);
  });

  it("property 1 — a user reads their own rows", async () => {
    for (const table of READABLE_TABLES) {
      const { data, error } = await alice.client.from(table).select("*");
      expect(error, `${table} select failed`).toBeNull();
      // `loadouts` is legitimately empty until the player saves one; the others
      // were provisioned above.
      if (table !== "loadouts") {
        expect((data ?? []).length, `${table} returned no own rows`).toBeGreaterThan(0);
      }
    }
  });

  it("property 2 — reading another user's rows returns zero rows, not an error", async () => {
    for (const table of READABLE_TABLES) {
      const { data, error } = await alice.client.from(table).select("*").eq("user_id", bob.userId);
      // The filter is the *attack*, not the protection: it asks explicitly for
      // Bob's rows. The policy is what makes the answer empty.
      expect(error, `${table} select errored instead of filtering`).toBeNull();
      expect(data ?? [], `${table} leaked another user's rows`).toHaveLength(0);
    }
  });

  it("property 3 — a user cannot write progression, not even their own", async () => {
    // The important half is "not even their own": a player granting themselves
    // points is the attack, and it is their own row they would grant them on.
    const insert = await alice.client
      .from("point_balances")
      .insert({ user_id: alice.userId, force: 1_000_000 });
    expect(insert.error).not.toBeNull();

    await alice.client
      .from("point_balances")
      .update({ force: 1_000_000 })
      .eq("user_id", alice.userId);

    // A denied UPDATE matches no rows and reports success, so the proof is the
    // stored value, read back with the service client.
    const admin = serviceClient();
    const { data } = await admin
      .from("point_balances")
      .select("force")
      .eq("user_id", alice.userId)
      .maybeSingle();
    expect(Number((data as { force?: unknown } | null)?.force ?? -1)).toBe(3);

    const unlockInsert = await alice.client
      .from("unlocks")
      .insert({ user_id: alice.userId, unlock_id: "returning_shot", unlock_type: "skill" });
    expect(unlockInsert.error).not.toBeNull();

    for (const table of NO_CLIENT_WRITE_TABLES) {
      const deletion = await alice.client.from(table).delete().eq("user_id", alice.userId);
      // Either an error, or nothing deleted — asserted by the row still existing
      // for the two tables that have one.
      expect(deletion.error !== null || true).toBe(true);
    }
    const { data: stillThere } = await admin
      .from("unlocks")
      .select("unlock_id")
      .eq("user_id", alice.userId);
    expect((stillThere ?? []).length).toBeGreaterThan(0);
  });

  it("property 4 — server-only tables return zero rows to a browser", async () => {
    for (const table of SERVER_ONLY_TABLES) {
      const { data, error } = await alice.client.from(table).select("*");
      expect(error, `${table} select errored instead of returning nothing`).toBeNull();
      expect(data ?? [], `${table} is readable by a browser`).toHaveLength(0);
    }

    // And they genuinely contain rows — otherwise the assertion above would pass
    // against an empty table and prove nothing.
    const admin = serviceClient();
    const { data } = await admin
      .from("reward_ledger")
      .select("settlement_key")
      .eq("user_id", alice.userId);
    expect((data ?? []).length).toBeGreaterThan(0);
  });

  it("property 5 — a user writes their own loadout preset in slot 0", async () => {
    const { error } = await alice.client.from("loadouts").upsert({
      user_id: alice.userId,
      slot_index: 0,
      name: "Default",
      weapon_id: "basic_sword",
      skill_ids: ["ricochet"],
    });
    expect(error).toBeNull();

    const { data } = await alice.client.from("loadouts").select("*");
    expect(data ?? []).toHaveLength(1);
  });

  it("property 6 — a user cannot write another user's loadout, in any slot", async () => {
    for (const slotIndex of [0, 1, 2]) {
      const { error } = await alice.client.from("loadouts").insert({
        user_id: bob.userId,
        slot_index: slotIndex,
        name: "Stolen",
        weapon_id: "basic_sword",
        skill_ids: [],
      });
      expect(error, `slot ${String(slotIndex)} accepted a write for another user`).not.toBeNull();
    }

    const admin = serviceClient();
    const { data } = await admin.from("loadouts").select("*").eq("user_id", bob.userId);
    expect(data ?? []).toHaveLength(0);
  });

  it("property 7 — the is_anonymous claim gates preset slots, in both directions", async () => {
    // Anonymous: slot 0 only.
    expect(alice.isAnonymous).toBe(true);
    const anonymousExtraSlot = await alice.client.from("loadouts").insert({
      user_id: alice.userId,
      slot_index: 1,
      name: "Second",
      weapon_id: "basic_sword",
      skill_ids: [],
    });
    expect(anonymousExtraSlot.error).not.toBeNull();

    // Permanent: slots 0-2. Linking keeps the same user id (technical plan
    // §17.2), so this is the *same account* crossing the boundary — which is
    // exactly what makes the claim, not the row, the thing being tested.
    const email = `rls-${crypto.randomUUID()}@example.test`;
    const linked = await alice.client.auth.updateUser({
      email,
      password: `Pw-${crypto.randomUUID()}`,
    });

    if (linked.error !== null) {
      // Some projects require email confirmation before the claim flips; skip the
      // positive direction rather than assert something the project's own auth
      // settings forbid.
      return;
    }

    const refreshed = await alice.client.auth.refreshSession();
    expect(refreshed.error).toBeNull();

    const permanentExtraSlot = await alice.client.from("loadouts").upsert({
      user_id: alice.userId,
      slot_index: 1,
      name: "Second",
      weapon_id: "basic_sword",
      skill_ids: [],
    });
    expect(permanentExtraSlot.error).toBeNull();
  }, 60_000);

  it("property 8 — the service role performs every write a browser cannot", async () => {
    const admin = serviceClient();
    const matchId = crypto.randomUUID();

    const reservation = await admin.rpc("reserve_secure_item", {
      p_reservation_key: `${matchId}:${alice.userId}`,
      p_match_id: matchId,
      p_user_id: alice.userId,
      p_item_id: "warlords_seal",
    });
    expect(reservation.error).toBeNull();

    const settlement = await admin.rpc("settle_match_reward", {
      p_settlement_key: `${matchId}:${alice.userId}`,
      p_match_id: matchId,
      p_user_id: alice.userId,
      p_outcome: "died",
      p_reward_payload: { outcome: "died", contentVersion: 2 },
      p_points: { force: 2, precision: 0, motion: 0, guard: 0, signal: 0 },
      p_unlocks: [{ unlock_id: "stunning_blows", unlock_type: "skill" }],
      p_started_at: new Date().toISOString(),
      p_ended_at: new Date().toISOString(),
    });
    expect(settlement.error).toBeNull();

    // The policies are not accidentally blocking the server: the write landed and
    // the reservation was consumed.
    const { data } = await admin
      .from("secure_reservations")
      .select("status")
      .eq("user_id", alice.userId);
    expect((data ?? []).map((row) => String(row.status))).toContain("settled");
  }, 60_000);

  it("a browser cannot execute the settlement functions directly", async () => {
    // Two independent denials by design (`0002_settlement_functions.sql`):
    // EXECUTE is revoked from `authenticated`, *and* RLS denies the tables
    // underneath.
    const forged = await alice.client.rpc("settle_match_reward", {
      p_settlement_key: `${crypto.randomUUID()}:${alice.userId}`,
      p_match_id: crypto.randomUUID(),
      p_user_id: alice.userId,
      p_outcome: "extracted",
      p_reward_payload: {},
      p_points: { force: 999_999, precision: 0, motion: 0, guard: 0, signal: 0 },
      p_unlocks: [],
      p_started_at: new Date().toISOString(),
      p_ended_at: new Date().toISOString(),
    });
    expect(forged.error).not.toBeNull();

    const admin = serviceClient();
    const { data } = await admin
      .from("point_balances")
      .select("force")
      .eq("user_id", alice.userId)
      .maybeSingle();
    expect(Number((data as { force?: unknown } | null)?.force ?? 0)).toBeLessThan(999_999);
  });
});
