/**
 * **Exit criterion 2 for §38 M4: "the client cannot set position or rewards."**
 *
 * Every test here *attempts a cheat* and asserts the server's own state is
 * unaffected. None of them is a happy path, and none is satisfied by "an error
 * was logged" — the assertion is always on authoritative state: the position the
 * server has for that player, the enemy's health, what is on the ground, what is
 * in the inventory, whether a run result exists, and how many projectiles were
 * actually created.
 *
 * `docs/DEVELOPMENT_RULES.md` is the rule being defended: "A client may never
 * assert damage dealt, position reached, loot gained, cooldown completion,
 * death, extraction success, or reward." Each of those gets a test.
 *
 * Two shapes of cheat are covered, because they fail for different reasons:
 *
 * 1. **A fabricated message type** ("I picked this up", "give me points"). It
 *    fails because no such message exists in the protocol at all — there is
 *    nothing to reject, only an unrecognized type to count and drop.
 * 2. **A well-formed message carrying extra claims** (an `input` with an `x`,
 *    a `damage`, a `pointsGained`). It fails because the validator rebuilds the
 *    message from its known fields and the simulation never sees the rest.
 */
import {
  basicBow,
  chaser,
  CONTENT_VERSION,
  type ArenaDefinition,
} from "@carry-or-fall/game-content";
import {
  DISCARD_ITEM_MESSAGE_TYPE,
  INPUT_MESSAGE_TYPE,
  type InputMessage,
  INVALID_MESSAGE_DISCONNECT_CODE,
  type LocalPlayerState,
  MATCH_ROOM,
  type MatchRoomState,
  PRIVATE_STATE_MESSAGE_TYPE,
  PROTOCOL_VERSION,
  SECURE_ITEM_MESSAGE_TYPE,
} from "@carry-or-fall/protocol";
import { Client, type Room } from "@colyseus/sdk";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { Logger } from "../src/logger";
import { MAX_INVALID_MESSAGES } from "../src/rooms/input-guard";
import { createGameServer, type GameServerHandle } from "../src/server";

const BUILD_VERSION = "0.0.0-test";
const TEST_LOBBY_MS = 300;

const validJoin = {
  protocolVersion: PROTOCOL_VERSION,
  contentVersion: CONTENT_VERSION,
  buildVersion: BUILD_VERSION,
  skillLoadoutIds: [] as string[],
};

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
 * A deliberately quiet arena: no enemies, one loot pile and one extraction
 * point at known positions far from the spawn. The cheats below are about what
 * a client can and cannot cause, and chasers converging on the only player
 * would end runs for reasons that have nothing to do with the cheat.
 */
const cheatArena: ArenaDefinition = {
  id: "test_cheat_arena",
  kind: "arena",
  width: 2000,
  height: 2000,
  walls: [],
  playerSpawnPoints: [
    { x: 100, y: 100 },
    { x: 160, y: 100 },
  ],
  enemySpawnPoints: [{ x: 1900, y: 1900 }],
  enemyCount: 0,
  groundLootSpawnPoints: [{ x: 1000, y: 1000 }],
  skillChipSpawnPoints: [{ x: 1000, y: 1200 }],
  extractionCandidatePoints: [
    { x: 1500, y: 1500 },
    { x: 1500, y: 1700 },
    { x: 1700, y: 1500 },
    { x: 1700, y: 1700 },
  ],
  openLaneY: 1900,
};

/** The same arena with one chaser, for the cases that need an enemy to lie about. */
const cheatArenaWithEnemy: ArenaDefinition = {
  ...cheatArena,
  id: "test_cheat_arena_enemy",
  // Stationary and far away: present to be damaged (or not), never a threat.
  enemySpawnPoints: [{ x: 1900, y: 100 }],
  enemyCount: 1,
};

async function waitFor(
  predicate: () => boolean | Promise<boolean>,
  timeoutMs = 10_000,
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

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * The legal ceiling on client messages (technical plan §9.1: 20 per second).
 * The magnitude tests below deliberately send at exactly this rate: a client
 * that floods faster is disconnected for abuse, which proves a different point
 * (see the rate-limit tests) and would hide whether distance is actually bounded
 * by the server's own speed.
 */
const LEGAL_INPUT_INTERVAL_MS = 50;

/**
 * Leave without hanging. A client the server has already dropped for abuse has
 * no socket left to send a consented leave over, so awaiting one would block
 * until the test times out.
 */
async function leaveQuietly(client: TestClient): Promise<void> {
  await Promise.race([client.room.leave(true).catch(() => undefined), sleep(1000)]);
}

interface TestClient {
  readonly room: Room<unknown, MatchRoomState>;
  readonly privateState: () => LocalPlayerState | null;
  readonly leaveCode: () => number | null;
  send: (input: Partial<Omit<InputMessage, "sequence">>) => void;
  /** Send a raw payload under an arbitrary message type — the shape of a cheat. */
  cheat: (type: string, payload: unknown) => void;
}

describe.each([
  { label: "with no enemies", arena: cheatArena },
  { label: "with one enemy", arena: cheatArenaWithEnemy },
])("match room authority ($label)", ({ arena }) => {
  let handle: GameServerHandle;
  let wsBaseUrl: string;
  let sequence = 0;

  async function joinMatch(): Promise<TestClient> {
    const client = new Client(wsBaseUrl);
    const room = await client.joinOrCreate<MatchRoomState>(MATCH_ROOM, validJoin);
    let privateState: LocalPlayerState | null = null;
    let leaveCode: number | null = null;
    room.onMessage(PRIVATE_STATE_MESSAGE_TYPE, (message: LocalPlayerState) => {
      privateState = message;
    });
    room.onLeave((code) => {
      leaveCode = code;
    });
    await waitFor(() => (room.state as Partial<MatchRoomState>).players !== undefined);
    await waitFor(() => room.state.phase === "running");
    return {
      room,
      privateState: () => privateState,
      leaveCode: () => leaveCode,
      send: (input) => {
        sequence += 1;
        room.send(INPUT_MESSAGE_TYPE, { ...NEUTRAL, ...input, sequence });
      },
      cheat: (type, payload) => {
        room.send(type, payload);
      },
    };
  }

  /** This client's player, as the *server* sees them. */
  function me(client: TestClient) {
    const player = client.room.state.players.get(client.room.sessionId);
    if (player === undefined) {
      throw new Error("this client has no player in the authoritative state");
    }
    return player;
  }

  beforeEach(async () => {
    sequence = 0;
    handle = createGameServer({
      buildVersion: BUILD_VERSION,
      logger: silentLogger,
      allowedOrigins: ["http://localhost:5173"],
      match: { lobbyDurationMs: TEST_LOBBY_MS, seed: 99, arena },
    });
    await handle.gameServer.listen(0);
    const address = handle.httpServer.address();
    if (address === null || typeof address === "string") {
      throw new Error("expected the server to be listening on a TCP port");
    }
    wsBaseUrl = `ws://127.0.0.1:${String(address.port)}`;
  });

  afterEach(async () => {
    await handle.gameServer.gracefullyShutdown(false);
  });

  it("cannot set a position it did not reach — not by decorating an input", async () => {
    const a = await joinMatch();
    const { x, y } = me(a);

    // A well-formed input carrying a position claim. The validator rebuilds the
    // message from its known fields, so the claim never reaches the simulation.
    sequence += 1;
    a.cheat(INPUT_MESSAGE_TYPE, {
      ...NEUTRAL,
      sequence,
      x: 1500,
      y: 1500,
      position: { x: 1500, y: 1500 },
      teleport: true,
    });
    await sleep(400);

    expect(me(a).x).toBe(x);
    expect(me(a).y).toBe(y);

    await leaveQuietly(a);
  });

  it("cannot set a position it did not reach — not by inventing a message", async () => {
    const a = await joinMatch();
    const { x, y } = me(a);

    for (const type of ["set_position", "move_to", "teleport", "position"]) {
      a.cheat(type, { x: 1500, y: 1500 });
    }
    await sleep(400);

    expect(me(a).x).toBe(x);
    expect(me(a).y).toBe(y);

    await leaveQuietly(a);
  });

  it("can only move at the speed the server decides, however many inputs it sends", async () => {
    const a = await joinMatch();
    const startX = me(a).x;

    // A full second of movement at the maximum legal message rate. Distance
    // comes from the server's own speed times its own fixed step, so the number
    // of messages cannot buy extra ground (technical plan §9.3, §33 "movement
    // magnitude"). The client's messages cannot even express a distance.
    const deadline = Date.now() + 1000;
    while (Date.now() < deadline) {
      a.send({ moveX: 1 });
      await sleep(LEGAL_INPUT_INTERVAL_MS);
    }
    await sleep(100);

    // One second of legitimate movement is a few hundred pixels; twenty
    // messages' worth of steps, if each bought a step, would be far more.
    const travelled = me(a).x - startX;
    expect(travelled).toBeGreaterThan(0);
    expect(travelled).toBeLessThan(400);

    await leaveQuietly(a);
  });

  it("is disconnected for flooding, rather than being given extra simulation (technical plan §33)", async () => {
    const a = await joinMatch();
    const startX = me(a).x;

    // The same intent, sent as fast as the socket takes it. The rate limit
    // rejects the excess and counts it as abuse, so a flood buys nothing and
    // ends the connection.
    for (let i = 0; i < 300; i += 1) {
      a.send({ moveX: 1 });
    }

    await waitFor(() => a.leaveCode() !== null, 10_000);
    expect(a.leaveCode()).toBe(INVALID_MESSAGE_DISCONNECT_CODE);
    // Whatever ground was covered before the drop is at most an ordinary
    // second of walking — nowhere near 300 steps.
    expect(me(a).x - startX).toBeLessThan(400);
  });

  it("cannot deal damage it did not deal", async () => {
    const a = await joinMatch();
    const enemies = [...a.room.state.enemies.values()];
    const before = enemies.map((enemy) => ({ id: enemy.id, health: enemy.health }));

    for (const enemy of enemies) {
      a.cheat("damage", { targetId: enemy.id, damage: 9999 });
      a.cheat("hit", { enemyId: enemy.id, damage: 9999 });
      a.cheat("kill", { targetId: enemy.id });
      // Also as a decoration on a legitimate input.
      sequence += 1;
      a.cheat(INPUT_MESSAGE_TYPE, { ...NEUTRAL, sequence, damage: 9999, targetId: enemy.id });
    }
    await sleep(500);

    for (const { id, health } of before) {
      expect(a.room.state.enemies.get(id)?.health).toBe(health);
    }

    await leaveQuietly(a);
  });

  it("cannot pick up loot it is nowhere near", async () => {
    const a = await joinMatch();
    const target = [...a.room.state.groundLoot.values()][0]!;
    // The spawn is ~1270 px from the loot; interact is held the whole time.
    expect(Math.hypot(target.x - me(a).x, target.y - me(a).y)).toBeGreaterThan(500);

    a.send({ interactPressed: true });
    a.cheat("pickup", { lootId: target.id });
    a.cheat("take_loot", { id: target.id });
    a.cheat("grant_item", { itemId: target.lootId });
    await sleep(1000);

    expect(a.room.state.groundLoot.has(target.id)).toBe(true);
    expect((a.privateState()?.inventory ?? []).every((item) => item === null)).toBe(true);

    await leaveQuietly(a);
  });

  it("cannot secure or discard an item it does not have", async () => {
    const a = await joinMatch();
    expect((a.privateState()?.inventory ?? []).every((item) => item === null)).toBe(true);

    // Well-formed commands naming empty slots: refused by the simulation, which
    // owns the inventory, not by hoping the client asked nicely.
    for (let slot = 0; slot < 6; slot += 1) {
      a.room.send(SECURE_ITEM_MESSAGE_TYPE, { sourceSlot: slot });
      a.room.send(DISCARD_ITEM_MESSAGE_TYPE, { sourceSlot: slot });
    }
    await sleep(400);

    expect(a.privateState()?.secureSlotItemId ?? null).toBeNull();
    expect((a.privateState()?.inventory ?? []).every((item) => item === null)).toBe(true);

    await leaveQuietly(a);
  });

  it("cannot complete an extraction it did not channel", async () => {
    const a = await joinMatch();
    const point = [...a.room.state.extractionPoints.values()][0]!;
    expect(Math.hypot(point.x - me(a).x, point.y - me(a).y)).toBeGreaterThan(500);

    // Hold interact far outside every zone for longer than the whole channel
    // (5 s), and separately claim the extraction outright.
    a.send({ interactPressed: true });
    a.cheat("extract", { pointId: point.id });
    a.cheat("extraction_complete", {});
    a.cheat("run_result", { outcome: "extracted", pointsGained: { force: 5000 } });
    await sleep(6000);

    expect(a.privateState()?.runResult ?? null).toBeNull();
    expect(me(a).runOver).toBe(false);
    expect(me(a).extractionProgressMs).toBe(0);

    await leaveQuietly(a);
  }, 30_000);

  it("cannot award itself points or unlocks", async () => {
    const a = await joinMatch();

    a.cheat("add_points", { force: 5000 });
    a.cheat("reward", { pointsGained: { force: 5000, precision: 5000 } });
    a.cheat("settle", { outcome: "extracted" });
    await sleep(400);

    // The golden rule, technical plan §5.4: a message like this is never
    // accepted. The only reward that exists is the one the server computes when
    // a run actually ends, and no run has ended.
    expect(a.privateState()?.runResult ?? null).toBeNull();

    await leaveQuietly(a);
  });

  it("cannot bypass an attack cooldown by sending faster", async () => {
    const a = await joinMatch();

    // Fire continuously for two seconds. `basic_bow`'s interval is 650 ms, so
    // at most four volleys are legitimate — a client whose message rate bought
    // extra attacks would produce far more live projectiles than that.
    const deadline = Date.now() + 2000;
    let peak = 0;
    while (Date.now() < deadline) {
      a.send({ secondaryAttackPressed: true });
      peak = Math.max(peak, a.room.state.projectiles.size);
      await sleep(LEGAL_INPUT_INTERVAL_MS);
    }
    await sleep(200);
    peak = Math.max(peak, a.room.state.projectiles.size);

    const legitimateVolleys = Math.ceil(2200 / basicBow.attackIntervalMs) + 1;
    expect(peak).toBeGreaterThan(0); // it really did fire
    expect(peak).toBeLessThanOrEqual(legitimateVolleys * (basicBow.projectileCount ?? 1));

    await leaveQuietly(a);
  }, 30_000);

  it("cannot dash repeatedly by holding the dash intent", async () => {
    const a = await joinMatch();
    const startX = me(a).x;

    // Dash held down for 600 ms at the legal message rate. The dash cooldown is
    // server state the client cannot see or set, so only the first one lands.
    const deadline = Date.now() + 600;
    while (Date.now() < deadline) {
      a.send({ moveX: 1, dashPressed: true });
      await sleep(LEGAL_INPUT_INTERVAL_MS);
    }
    await sleep(100);

    // One dash is 140 px; twelve would be 1680. Two thirds of a second of
    // walking plus one dash is nowhere near that.
    expect(me(a).x - startX).toBeLessThan(400);

    await leaveQuietly(a);
  });

  it("ignores a replayed or reordered input sequence", async () => {
    const a = await joinMatch();

    // Establish a high sequence with a neutral input, then replay a *lower*
    // sequence carrying movement. It must not be applied.
    a.room.send(INPUT_MESSAGE_TYPE, { ...NEUTRAL, sequence: 5000 });
    await sleep(200);
    const restingX = me(a).x;

    for (let i = 0; i < 20; i += 1) {
      a.room.send(INPUT_MESSAGE_TYPE, { ...NEUTRAL, moveX: 1, sequence: 10 + i });
    }
    await sleep(600);

    expect(me(a).x).toBe(restingX);

    await leaveQuietly(a);
  });

  it("rejects malformed inputs without applying any part of them", async () => {
    const a = await joinMatch();
    const { x, y, facing } = me(a);

    const malformed: unknown[] = [
      { ...NEUTRAL, sequence: 9001, moveX: 50 }, // out-of-range axis
      { ...NEUTRAL, sequence: 9002, moveY: -50 },
      { ...NEUTRAL, sequence: 9003, aimAngle: Number.NaN },
      { ...NEUTRAL, sequence: 9004, aimAngle: 1e9 },
      { ...NEUTRAL, sequence: 9005, attackPressed: "yes" },
      { ...NEUTRAL, sequence: -1, moveX: 1 },
      { ...NEUTRAL, sequence: 1.5, moveX: 1 },
      "not an object",
      42,
      null,
      [],
    ];
    for (const payload of malformed) {
      a.cheat(INPUT_MESSAGE_TYPE, payload);
    }
    await sleep(600);

    // Not partially applied: no movement, no facing change, no crash.
    expect(me(a).x).toBe(x);
    expect(me(a).y).toBe(y);
    expect(me(a).facing).toBe(facing);
    expect(a.room.state.phase).toBe("running");

    await leaveQuietly(a);
  });

  it("rejects an out-of-range inventory slot", async () => {
    const a = await joinMatch();

    for (const sourceSlot of [-1, 6, 99, 1.5, Number.NaN, "0", null]) {
      a.cheat(SECURE_ITEM_MESSAGE_TYPE, { sourceSlot });
      a.cheat(DISCARD_ITEM_MESSAGE_TYPE, { sourceSlot });
    }
    await sleep(400);

    expect(a.privateState()?.secureSlotItemId ?? null).toBeNull();
    expect(a.room.state.phase).toBe("running");

    await leaveQuietly(a);
  });

  it("disconnects a client that keeps sending invalid messages (technical plan §33)", async () => {
    const a = await joinMatch();

    // Comfortably past the threshold, all of them nonsense.
    for (let i = 0; i < MAX_INVALID_MESSAGES + 5; i += 1) {
      a.cheat("nonsense_message", { i });
    }

    await waitFor(() => a.leaveCode() !== null, 10_000);
    expect(a.leaveCode()).toBe(INVALID_MESSAGE_DISCONNECT_CODE);
  });

  it("keeps one client's cheating from touching another client's state", async () => {
    const a = await joinMatch();
    const b = await joinMatch();
    const beforeB = { x: me(b).x, y: me(b).y, health: me(b).health };

    // A tries to move, damage, and end B's run.
    a.cheat("set_position", { playerId: b.room.sessionId, x: 1500, y: 1500 });
    a.cheat("damage", { playerId: b.room.sessionId, damage: 9999 });
    a.cheat("kill", { playerId: b.room.sessionId });
    a.cheat("extract", { playerId: b.room.sessionId });
    await sleep(500);

    expect(me(b).x).toBe(beforeB.x);
    expect(me(b).y).toBe(beforeB.y);
    expect(me(b).health).toBe(beforeB.health);
    expect(b.privateState()?.runResult ?? null).toBeNull();

    await leaveQuietly(b);
  });

  it("stops accepting input from a player whose run is over", async () => {
    // A run that has ended is settled; a later input is not a delayed
    // instruction, it is a stale one, and applying it would let a finished
    // player keep playing.
    const a = await joinMatch();
    if (arena.enemyCount > 0) {
      // This case only needs the no-enemy arena's determinism; skip the noisy
      // variant rather than racing a chaser.
      await leaveQuietly(a);
      return;
    }

    const point = [...a.room.state.extractionPoints.values()][0]!;
    // Walk to the point and channel out for real.
    const deadline = Date.now() + 30_000;
    while (Math.hypot(point.x - me(a).x, point.y - me(a).y) > 15 && Date.now() < deadline) {
      const dx = point.x - me(a).x;
      const dy = point.y - me(a).y;
      a.send({
        moveX: Math.abs(dx) > 6 ? (dx > 0 ? 1 : -1) : 0,
        moveY: Math.abs(dy) > 6 ? (dy > 0 ? 1 : -1) : 0,
      });
      await sleep(60);
    }
    a.send({ interactPressed: true });
    await waitFor(() => a.privateState()?.runResult !== null, 20_000);

    const settled = a.privateState()!.runResult!;
    const restingX = me(a).x;

    for (let i = 0; i < 20; i += 1) {
      a.send({ moveX: 1, secondaryAttackPressed: true });
    }
    await sleep(600);

    expect(me(a).x).toBe(restingX);
    expect(a.privateState()!.runResult).toEqual(settled);

    await leaveQuietly(a);
  }, 60_000);

  it("never reports another player's private state to a client", async () => {
    const a = await joinMatch();
    const b = await joinMatch();

    await waitFor(() => a.privateState() !== null && b.privateState() !== null);
    expect(a.privateState()?.playerId).toBe(a.room.sessionId);
    expect(b.privateState()?.playerId).toBe(b.room.sessionId);

    // And asking for it does not produce it.
    a.cheat("get_private_state", { playerId: b.room.sessionId });
    a.cheat(PRIVATE_STATE_MESSAGE_TYPE, { playerId: b.room.sessionId });
    await sleep(400);
    expect(a.privateState()?.playerId).toBe(a.room.sessionId);

    await leaveQuietly(a);
    await leaveQuietly(b);
  });

  it("cannot revive itself or change the enemy roster", async () => {
    const a = await joinMatch();
    const enemyIdsBefore = [...a.room.state.enemies.keys()].sort();

    a.cheat("spawn_enemy", { definitionId: chaser.id });
    a.cheat("remove_enemy", { id: enemyIdsBefore[0] ?? "enemy-0" });
    a.cheat("set_health", { health: 9999 });
    a.cheat("revive", {});
    await sleep(400);

    expect([...a.room.state.enemies.keys()].sort()).toEqual(enemyIdsBefore);
    expect(me(a).health).toBe(me(a).maxHealth);

    await leaveQuietly(a);
  });
});
