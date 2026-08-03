/**
 * Adversarial evidence for §38 M7's **first** exit criterion — "the three
 * boss-core decisions produce three different outcomes and cannot be combined"
 * (M7.6, `docs/M7_ISSUES.md` §12).
 *
 * `packages/simulation-core/src/boss-core.test.ts` already proves the *rules*.
 * This file attacks the **room**: a real listening server, real `@colyseus/sdk`
 * clients, and a client sending whatever it likes in whatever order it likes.
 * The distinction matters because the rules could be right and the wiring still
 * wrong — M5 found exactly that shape of defect between `discard_item` and
 * `secure_item`, where a same-tick pair left a reservation pending for an item
 * the player had thrown away.
 *
 * So the sharpest test here is the same shape: **activation racing a secure
 * request inside one tick**, sent both ways round, from a client that is
 * deliberately trying to get an unlock *and* keep the skill. It cannot, because
 * activation removes the core from the inventory and `secureItem` moves an item
 * out of a slot — there is nothing left in the slot to move. Not a check that
 * could be forgotten: an absence.
 *
 * ## Why the boss here is not `warden`
 *
 * These tests need a core in a player's hands, which means a dead boss. Killing
 * a full-health warden over a real socket takes about twenty seconds of arrows,
 * and doing that in every test would add minutes to a suite that already runs
 * serially. `MatchRoomDeps.bossDefinition` overrides which boss inhabits the
 * lair — the same seam `arena` already provides — so these matches host a small
 * one. `stepBoss` implements no per-boss behaviour, so this is the shipped boss
 * with different numbers rather than a different code path, and the numbers it
 * shares with `warden` (an arc and an area attack, a telegraph, a leash) are the
 * ones under test.
 */
import {
  type ArenaDefinition,
  CONTENT_VERSION,
  splitReturnCore,
} from "@carry-or-fall/game-content";
import {
  ACTIVATE_CORE_MESSAGE_TYPE,
  INPUT_MESSAGE_TYPE,
  type InputMessage,
  type LocalPlayerState,
  MATCH_ROOM,
  type MatchRoomState,
  PRIVATE_STATE_MESSAGE_TYPE,
  PROTOCOL_VERSION,
  SECURE_ITEM_MESSAGE_TYPE,
  SETTLEMENT_MESSAGE_TYPE,
  type SettlementMessage,
} from "@carry-or-fall/protocol";
import { Client, type Room } from "@colyseus/sdk";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { Logger } from "../src/logger";
import { MemoryStore } from "../src/progression/memory-store";
import { DEFAULT_UNLOCK_GRANTS, SettlementService } from "../src/progression/settlement-service";
import { createGameServer, type GameServerHandle } from "../src/server";
import { BOSS_LAIR, bossArena, trainingBoss } from "./boss-fixtures";

const BUILD_VERSION = "0.0.0-test";
const TEST_LOBBY_MS = 300;

const silentLogger: Logger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
};

const NEUTRAL: Omit<InputMessage, "sequence"> = {
  moveX: 0,
  moveY: 0,
  aimAngle: 0,
  attackPressed: false,
  secondaryAttackPressed: false,
  dashPressed: false,
  interactPressed: false,
};

/**
 * The same arena with one chaser in it. Used by exactly one test — the one that
 * needs a player to actually *die* while carrying a core (concept §15.2).
 *
 * A chaser rather than the boss, because by the time a core exists the boss is
 * dead, and rather than another player, because PvP damage is M7.5
 * (`docs/DECISIONS.md` D59). It is kept out of the default arena because a
 * chaser that followed every test around would fail them for reasons that have
 * nothing to do with boss cores.
 */
const deathArena: ArenaDefinition = {
  ...bossArena,
  id: "test_boss_death_arena",
  enemySpawnPoints: [{ x: 500, y: 860 }],
  enemyCount: 1,
};

const validJoin = {
  protocolVersion: PROTOCOL_VERSION,
  contentVersion: CONTENT_VERSION,
  buildVersion: BUILD_VERSION,
  skillLoadoutIds: [] as string[],
  accessToken: "boss-core-token",
};

async function waitFor(
  predicate: () => boolean | Promise<boolean>,
  timeoutMs = 20_000,
): Promise<void> {
  const start = Date.now();
  for (;;) {
    if (await predicate()) {
      return;
    }
    if (Date.now() - start > timeoutMs) {
      throw new Error("waitFor: condition not satisfied within timeout");
    }
    await new Promise<void>((resolve) => setTimeout(resolve, 20));
  }
}

interface TestClient {
  readonly room: Room<unknown, MatchRoomState>;
  readonly privateState: () => LocalPlayerState | null;
  readonly settlement: () => SettlementMessage | null;
  send: (input: Partial<Omit<InputMessage, "sequence">>) => void;
}

describe("the boss core's three-way decision, under attack (§38 M7 exit criterion 1)", () => {
  let handle: GameServerHandle;
  let store: MemoryStore;
  let wsBaseUrl: string;
  let sequence = 0;

  function attach(room: Room<unknown, MatchRoomState>): TestClient {
    let privateState: LocalPlayerState | null = null;
    let settlement: SettlementMessage | null = null;
    room.onMessage(PRIVATE_STATE_MESSAGE_TYPE, (message: LocalPlayerState) => {
      privateState = message;
    });
    room.onMessage(SETTLEMENT_MESSAGE_TYPE, (message: SettlementMessage) => {
      settlement = message;
    });
    return {
      room,
      privateState: () => privateState,
      settlement: () => settlement,
      send: (input) => {
        sequence += 1;
        room.send(INPUT_MESSAGE_TYPE, { ...NEUTRAL, ...input, sequence });
      },
    };
  }

  async function joinMatch(token?: string): Promise<TestClient> {
    const client = new Client(wsBaseUrl);
    const room = await client.joinOrCreate<MatchRoomState>(MATCH_ROOM, {
      ...validJoin,
      ...(token === undefined ? {} : { accessToken: token }),
    });
    const joined = attach(room);
    await waitFor(() => (room.state as Partial<MatchRoomState>).players !== undefined);
    return joined;
  }

  /**
   * Wait for the match to start. Deliberately **not** folded into `joinMatch`:
   * a running match is locked, so a second `joinOrCreate` after that point gets
   * its own room. Every test with two clients must seat both first — found the
   * hard way, by a two-player test that silently ran two one-player matches.
   */
  async function waitForRunning(client: TestClient): Promise<void> {
    await waitFor(() => client.room.state.phase === "running");
  }

  async function walkTo(client: TestClient, targetX: number, targetY: number): Promise<void> {
    const id = client.room.sessionId;
    const deadline = Date.now() + 20_000;
    for (;;) {
      const player = client.room.state.players.get(id);
      if (player === undefined) {
        return;
      }
      const dx = targetX - player.x;
      const dy = targetY - player.y;
      if (Math.hypot(dx, dy) < 15) {
        client.send({});
        return;
      }
      if (Date.now() > deadline) {
        throw new Error("walkTo: did not arrive within 20s");
      }
      client.send({
        moveX: Math.abs(dx) > 6 ? (dx > 0 ? 1 : -1) : 0,
        moveY: Math.abs(dy) > 6 ? (dy > 0 ? 1 : -1) : 0,
      });
      await new Promise((resolve) => setTimeout(resolve, 60));
    }
  }

  /** Shoot the boss until it is gone, from just outside where it would wake. */
  async function killBoss(client: TestClient): Promise<void> {
    await walkTo(client, BOSS_LAIR.x - 200, BOSS_LAIR.y);
    const deadline = Date.now() + 30_000;
    while (client.room.state.boss.size > 0) {
      if (Date.now() > deadline) {
        throw new Error("killBoss: the boss survived 30s of arrows");
      }
      client.send({ secondaryAttackPressed: true, aimAngle: 0 });
      await new Promise((resolve) => setTimeout(resolve, 60));
      client.send({ secondaryAttackPressed: false, aimAngle: 0 });
      await new Promise((resolve) => setTimeout(resolve, 60));
    }
  }

  /** Which inventory slot holds the boss core, or -1. */
  function coreSlot(client: TestClient): number {
    return (client.privateState()?.inventory ?? []).indexOf(splitReturnCore.id);
  }

  /** Where the core the boss dropped is lying, or `null`. */
  function corePosition(client: TestClient): { x: number; y: number } | null {
    let found: { x: number; y: number } | null = null;
    client.room.state.groundLoot.forEach((loot) => {
      if (loot.lootId === splitReturnCore.id) {
        found = { x: loot.x, y: loot.y };
      }
    });
    return found;
  }

  /** Kill the boss and walk over the core it dropped. */
  async function takeTheCore(client: TestClient): Promise<number> {
    await killBoss(client);
    // Read where it actually landed rather than assuming the lair: a boss that
    // was awake when it died fell wherever it had walked to.
    await waitFor(() => corePosition(client) !== null);
    const at = corePosition(client) ?? BOSS_LAIR;
    await walkTo(client, at.x, at.y);
    const deadline = Date.now() + 15_000;
    while (coreSlot(client) === -1) {
      if (Date.now() > deadline) {
        throw new Error("takeTheCore: never picked the core up");
      }
      client.send({ interactPressed: true });
      await new Promise((resolve) => setTimeout(resolve, 60));
      client.send({ interactPressed: false });
      await new Promise((resolve) => setTimeout(resolve, 60));
    }
    return coreSlot(client);
  }

  /** Channel the nearest extraction point until this player's run ends. */
  async function extract(client: TestClient): Promise<void> {
    const points: { x: number; y: number }[] = [];
    client.room.state.extractionPoints.forEach((point) => {
      points.push({ x: point.x, y: point.y });
    });
    const point = points[0];
    if (point === undefined) {
      throw new Error("no extraction point in the arena");
    }
    await walkTo(client, point.x, point.y);
    const deadline = Date.now() + 25_000;
    while (client.privateState()?.runResult == null) {
      if (Date.now() > deadline) {
        throw new Error("extract: run did not end within 25s");
      }
      client.send({ interactPressed: true });
      await new Promise((resolve) => setTimeout(resolve, 60));
    }
  }

  /** Boot a server on an ephemeral port. Separate from `beforeEach` so one test can rebuild it. */
  async function startServer(arena: ArenaDefinition): Promise<void> {
    handle = createGameServer({
      buildVersion: BUILD_VERSION,
      logger: silentLogger,
      allowedOrigins: ["http://localhost:5173"],
      progression: {
        store,
        settlement: new SettlementService(store, silentLogger, {
          maxAttempts: 1,
          retryDelayMs: 0,
        }),
      },
      match: {
        lobbyDurationMs: TEST_LOBBY_MS,
        matchDurationMs: 120_000,
        reconnectWindowMs: 1_000,
        seed: 11,
        arena,
        bossDefinition: trainingBoss,
        // Explicit: a server with no Supabase would otherwise provision every
        // unlock, which would make "the core granted the unlock" vacuously true.
        unlockGrants: DEFAULT_UNLOCK_GRANTS,
      },
    });
    await handle.gameServer.listen(0);
    const address = handle.httpServer.address();
    if (address === null || typeof address === "string") {
      throw new Error("expected the server to be listening on a TCP port");
    }
    wsBaseUrl = `ws://127.0.0.1:${String(address.port)}`;
  }

  beforeEach(async () => {
    sequence = 0;
    store = new MemoryStore();
    await startServer(bossArena);
  });

  afterEach(async () => {
    await handle.gameServer.gracefullyShutdown(false);
  });

  it("the boss drops exactly one core, and it becomes ordinary inventory", async () => {
    const a = await joinMatch();
    await waitForRunning(a);
    expect(a.room.state.boss.size).toBe(1);

    const slot = await takeTheCore(a);
    expect(slot).toBeGreaterThanOrEqual(0);

    // One core, not one per tick of the step that killed it.
    const carried = (a.privateState()?.inventory ?? []).filter((id) => id === splitReturnCore.id);
    expect(carried).toHaveLength(1);
    // And the boss is gone from the document every client reads.
    expect(a.room.state.boss.size).toBe(0);

    await a.room.leave(true);
  });

  it("attack 1 — a client cannot secure a core it has already activated", async () => {
    const a = await joinMatch();
    await waitForRunning(a);
    const slot = await takeTheCore(a);

    a.room.send(ACTIVATE_CORE_MESSAGE_TYPE, { sourceSlot: slot });
    await waitFor(() => a.privateState()?.wildcardSkillId === "split_return");
    expect(a.privateState()?.inventory[slot]).toBeNull();

    // Every slot, repeatedly, long after the fact. There is no combination of
    // messages that puts an activated core into the secure slot, because it is
    // not in the inventory to move.
    for (let round = 0; round < 3; round += 1) {
      for (let candidate = 0; candidate < 6; candidate += 1) {
        a.room.send(SECURE_ITEM_MESSAGE_TYPE, { sourceSlot: candidate });
        await new Promise((resolve) => setTimeout(resolve, 30));
      }
    }

    expect(a.privateState()?.secureSlotItemId).toBeNull();
    expect(a.privateState()?.wildcardSkillId).toBe("split_return");

    await a.room.leave(true);
  });

  it("attack 1b — racing activation against a secure request in the same tick resolves once, either order", async () => {
    // The M5-shaped attack, which is why it is here at all: a same-tick pair of
    // inventory commands is where a real defect was found before. Both orders
    // are sent, back to back with no await between them, so they land inside the
    // same 50 ms step.
    for (const activateFirst of [true, false]) {
      const a = await joinMatch(`race-token-${String(activateFirst)}`);
      await waitForRunning(a);
      const slot = await takeTheCore(a);

      if (activateFirst) {
        a.room.send(ACTIVATE_CORE_MESSAGE_TYPE, { sourceSlot: slot });
        a.room.send(SECURE_ITEM_MESSAGE_TYPE, { sourceSlot: slot });
      } else {
        a.room.send(SECURE_ITEM_MESSAGE_TYPE, { sourceSlot: slot });
        a.room.send(ACTIVATE_CORE_MESSAGE_TYPE, { sourceSlot: slot });
      }

      await waitFor(() => a.privateState()?.wildcardSkillId === "split_return");
      await new Promise((resolve) => setTimeout(resolve, 300));

      // Exactly one outcome, and it is activation: `stepPlayerAttacks` resolves
      // discard, then activate, then secure, so the slot is already empty when
      // the secure intent is read. The player got the skill and did not get to
      // keep the core.
      expect(a.privateState()?.wildcardSkillId).toBe("split_return");
      expect(a.privateState()?.secureSlotItemId).toBeNull();
      expect(a.privateState()?.inventory).not.toContain(splitReturnCore.id);

      await a.room.leave(true);
    }
  }, 90_000);

  it("attack 1c — hammering activate grants one skill and never a second core", async () => {
    const a = await joinMatch();
    await waitForRunning(a);
    const slot = await takeTheCore(a);

    // Paced under the room's 40-messages-per-second guard, and after a pause
    // that lets its window reset: the point of this test is that *activation*
    // happens once, not that the rate limiter works — that is `input-guard`'s
    // own test, and letting it swallow the burst here would make this pass for
    // the wrong reason.
    await new Promise((resolve) => setTimeout(resolve, 1_100));
    for (let attempt = 0; attempt < 12; attempt += 1) {
      a.room.send(ACTIVATE_CORE_MESSAGE_TYPE, { sourceSlot: attempt % 6 });
      await new Promise((resolve) => setTimeout(resolve, 120));
    }

    expect(a.privateState()?.wildcardSkillId).toBe("split_return");
    expect(a.privateState()?.inventory.filter((id) => id !== null)).toHaveLength(0);
    expect(slot).toBeGreaterThanOrEqual(0);

    await a.room.leave(true);
  });

  it("attack 1d — an activate message naming a skill instead of a slot is refused outright", async () => {
    const a = await joinMatch();
    await waitForRunning(a);
    const slot = await takeTheCore(a);

    // A client asserting what it is owed. `validateActivateCoreMessage` reads
    // `sourceSlot` and nothing else, so the first two are malformed and the
    // third is an ordinary request with decoration that never reaches a
    // decision.
    a.room.send(ACTIVATE_CORE_MESSAGE_TYPE, { skillId: "split_return" });
    a.room.send(ACTIVATE_CORE_MESSAGE_TYPE, { sourceSlot: 99, skillId: "split_return" });
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(a.privateState()?.wildcardSkillId).toBeNull();

    a.room.send(ACTIVATE_CORE_MESSAGE_TYPE, { sourceSlot: slot, skillId: "bulwark_strike" });
    await waitFor(() => a.privateState()?.wildcardSkillId !== null);
    // The skill it got is the one the *core* names, not the one it asked for.
    expect(a.privateState()?.wildcardSkillId).toBe("split_return");

    await a.room.leave(true);
  });

  it("option 2 — a carried core drops on death and another player takes it (concept §15.2)", async () => {
    // The only test here that needs a chaser, so it gets its own server.
    await handle.gameServer.gracefullyShutdown(false);
    await startServer(deathArena);

    // Both seats taken before the match starts: a running room is locked, and a
    // late `joinOrCreate` would quietly get a room of its own.
    const carrier = await joinMatch("carrier-token");
    const scavenger = await joinMatch("scavenger-token");
    await waitForRunning(carrier);
    await waitForRunning(scavenger);
    expect(carrier.room.roomId).toBe(scavenger.room.roomId);

    // The scavenger retreats to the far corner first. A chaser goes for the
    // *nearest* player, and the point of this test is that the **carrier** dies
    // — leaving the second player next to the chaser would decide that the
    // wrong way round, which is exactly what happened the first time this ran.
    await walkTo(scavenger, 150, 150);

    const slot = await takeTheCore(carrier);
    expect(slot).toBeGreaterThanOrEqual(0);

    // Walk into the chaser and stand still. Nothing about the death that follows
    // is special-cased: a boss core is loot, and the death path drops loot.
    await walkTo(carrier, 500, 860);
    const carrierState = () => carrier.room.state.players.get(carrier.room.sessionId);
    const deadline = Date.now() + 40_000;
    while ((carrierState()?.alive ?? false) && carrier.privateState()?.runResult == null) {
      if (Date.now() > deadline) {
        throw new Error("the carrier survived 40s of standing still next to a chaser");
      }
      carrier.send({});
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    expect(carrier.privateState()?.runResult?.outcome).toBe("died");

    // The core is on the ground where they fell — visible to everyone, because
    // ground loot is public state.
    let dropped: { x: number; y: number } | null = null;
    await waitFor(() => {
      scavenger.room.state.groundLoot.forEach((loot) => {
        if (loot.lootId === splitReturnCore.id) {
          dropped = { x: loot.x, y: loot.y };
        }
      });
      return dropped !== null;
    });
    const where = dropped as { x: number; y: number } | null;
    if (where === null) {
      throw new Error("the carrier died without dropping the core");
    }

    // And the *other* player picks it up. This is §15.2's "another player can
    // take it off your body" as a fact rather than a claim.
    expect(scavenger.room.state.players.get(scavenger.room.sessionId)?.alive).toBe(true);
    await walkTo(scavenger, where.x, where.y);
    const pickupDeadline = Date.now() + 20_000;
    while (coreSlot(scavenger) === -1) {
      if (Date.now() > pickupDeadline) {
        throw new Error("the scavenger never picked up the dropped core");
      }
      scavenger.send({ interactPressed: true });
      await new Promise((resolve) => setTimeout(resolve, 60));
      scavenger.send({ interactPressed: false });
      await new Promise((resolve) => setTimeout(resolve, 60));
    }

    expect(coreSlot(scavenger)).toBeGreaterThanOrEqual(0);
    // The dead carrier settled with nothing: a carried core is not a secured
    // one, so it converts to no unlock and no points.
    expect(carrier.privateState()?.runResult?.outcome).toBe("died");
    await waitFor(() => carrier.settlement() !== null);
    expect(carrier.settlement()?.newUnlockIds).not.toContain("split_return");
    expect(carrier.settlement()?.duplicateCoreIds).toEqual([]);

    // Exactly one core exists in the world: it moved, it did not multiply.
    let coresOnGround = 0;
    scavenger.room.state.groundLoot.forEach((loot) => {
      if (loot.lootId === splitReturnCore.id) {
        coresOnGround += 1;
      }
    });
    expect(coresOnGround).toBe(0);

    await carrier.room.leave(true);
    await scavenger.room.leave(true);
  }, 120_000);

  it("option 3 — a secured core grants no skill, and the unlock lands exactly once", async () => {
    const a = await joinMatch();
    await waitForRunning(a);
    const slot = await takeTheCore(a);

    a.room.send(SECURE_ITEM_MESSAGE_TYPE, { sourceSlot: slot });
    await waitFor(() => a.privateState()?.secureSlotItemId === splitReturnCore.id);

    // Secured, and providing nothing: concept §11 option 3's "stops providing
    // combat power" is trivially true for a core, and the assertion that matters
    // is that securing is not a back door to the wildcard.
    expect(a.privateState()?.wildcardSkillId).toBeNull();

    // And it cannot be activated afterwards, from any slot.
    for (let candidate = 0; candidate < 6; candidate += 1) {
      a.room.send(ACTIVATE_CORE_MESSAGE_TYPE, { sourceSlot: candidate });
      await new Promise((resolve) => setTimeout(resolve, 30));
    }
    expect(a.privateState()?.wildcardSkillId).toBeNull();
    expect(a.privateState()?.secureSlotItemId).toBe(splitReturnCore.id);

    await extract(a);
    await waitFor(() => a.settlement() !== null);

    const settlement = a.settlement();
    expect(settlement?.newUnlockIds).toContain("split_return");
    expect(settlement?.duplicateCoreIds).toEqual([]);
    expect(store.appliedSettlementCount).toBe(1);

    // Read back from the store, not from the message: the unlock must be *in*
    // the account, exactly once.
    const account = await store.loadAccount(SETTLEMENT_USER_ID);
    expect(account?.unlockIds.filter((id) => id === "split_return")).toHaveLength(1);

    await a.room.leave(true);
  }, 90_000);

  it("a duplicate core converts to points instead of granting a second unlock", async () => {
    // Run one earns the unlock.
    const first = await joinMatch();
    await waitForRunning(first);
    const slot = await takeTheCore(first);
    first.room.send(SECURE_ITEM_MESSAGE_TYPE, { sourceSlot: slot });
    await waitFor(() => first.privateState()?.secureSlotItemId === splitReturnCore.id);
    await extract(first);
    await waitFor(() => first.settlement() !== null);
    expect(first.settlement()?.newUnlockIds).toContain("split_return");
    const afterFirst = await store.loadAccount(SETTLEMENT_USER_ID);
    await first.room.leave(true);

    // Run two, same account, earns a second core.
    const second = await joinMatch();
    await waitForRunning(second);
    const slot2 = await takeTheCore(second);
    second.room.send(SECURE_ITEM_MESSAGE_TYPE, { sourceSlot: slot2 });
    await waitFor(() => second.privateState()?.secureSlotItemId === splitReturnCore.id);
    await extract(second);
    await waitFor(() => second.settlement() !== null);

    const settlement = second.settlement();
    // No second unlock, no second inventory object — points, and the client is
    // told which core became them (concept §11's duplicate rule).
    expect(settlement?.newUnlockIds).not.toContain("split_return");
    expect(settlement?.duplicateCoreIds).toEqual([splitReturnCore.id]);

    const afterSecond = await store.loadAccount(SETTLEMENT_USER_ID);
    expect(afterSecond?.unlockIds.filter((id) => id === "split_return")).toHaveLength(1);
    // The conversion is worth something: the balance moved by the core's own
    // declared conversion, not by a number this test restates.
    const gained =
      (afterSecond?.balances.precision ?? 0) - (afterFirst?.balances.precision ?? 0) >=
      splitReturnCore.bossCore!.duplicateConversion.precision;
    expect(gained).toBe(true);

    await second.room.leave(true);
  }, 120_000);
});

/**
 * The account these tests create. The local verifier treats a presented token as
 * the identity (`progression/auth.ts`), so every join with the same token is the
 * same returning player — which is what makes the duplicate-core case testable.
 */
const SETTLEMENT_USER_ID = localUserIdFor(validJoin.accessToken);

/** Mirrors `LocalTokenVerifier`'s id derivation, so a test can name the account it created. */
function localUserIdFor(token: string): string {
  let hash = 0x811c_9dc5;
  for (let index = 0; index < token.length; index += 1) {
    hash ^= token.charCodeAt(index);
    hash = Math.imul(hash, 0x0100_0193) >>> 0;
  }
  return `local-${hash.toString(16).padStart(8, "0")}`;
}
