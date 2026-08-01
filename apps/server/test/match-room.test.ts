/**
 * Room integration tests (technical plan §30.2, §38 M4 exit criterion 3).
 *
 * §30.2's list, in order: create a room, join multiple simulated clients, send
 * messages, verify synchronized state, test disconnects, test room disposal,
 * test extraction, test death and dropped loot. Each is covered below against a
 * **real listening server and real `@colyseus/sdk` clients** — no mocked
 * transport — so what passes here is the same path a browser takes.
 *
 * The adversarial half of M4 (what happens when a client lies) lives in
 * `match-authority.test.ts`.
 */
import { type ArenaDefinition, CONTENT_VERSION, testArena } from "@carry-or-fall/game-content";
import {
  DISCARD_ITEM_MESSAGE_TYPE,
  INCOMPATIBLE_CLIENT_MESSAGE,
  INPUT_MESSAGE_TYPE,
  type InputMessage,
  type LocalPlayerState,
  MATCH_ROOM,
  type MatchRoomState,
  PRIVATE_STATE_MESSAGE_TYPE,
  PROTOCOL_MISMATCH_CODE,
  PROTOCOL_VERSION,
  SECURE_ITEM_MESSAGE_TYPE,
} from "@carry-or-fall/protocol";
import { matchMaker } from "@colyseus/core";
import { Client, type Room } from "@colyseus/sdk";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { Logger } from "../src/logger";
import { createGameServer, type GameServerHandle } from "../src/server";

const BUILD_VERSION = "0.0.0-test";

/** A short lobby and a short match, so a suite does not sit through the real ones. */
const TEST_LOBBY_MS = 300;
const TEST_MATCH_MS = 60_000;

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

/** A joined client plus the private state the server has sent it. */
interface TestClient {
  readonly room: Room<unknown, MatchRoomState>;
  readonly privateState: () => LocalPlayerState | null;
  send: (input: Partial<Omit<InputMessage, "sequence">>) => void;
}

describe("match room integration (technical plan §30.2)", () => {
  let handle: GameServerHandle;
  let wsBaseUrl: string;
  let sequence = 0;

  function attach(room: Room<unknown, MatchRoomState>): TestClient {
    let privateState: LocalPlayerState | null = null;
    room.onMessage(PRIVATE_STATE_MESSAGE_TYPE, (message: LocalPlayerState) => {
      privateState = message;
    });
    return {
      room,
      privateState: () => privateState,
      send: (input) => {
        sequence += 1;
        room.send(INPUT_MESSAGE_TYPE, { ...NEUTRAL, ...input, sequence });
      },
    };
  }

  async function joinMatch(options: Record<string, unknown> = {}): Promise<TestClient> {
    const client = new Client(wsBaseUrl);
    const room = await client.joinOrCreate<MatchRoomState>(MATCH_ROOM, {
      ...validJoin,
      ...options,
    });
    const joined = attach(room);
    // The first patch arrives a moment after the join resolves; every
    // assertion below reads synchronized state, so wait for it once here
    // rather than guarding every read.
    await waitFor(() => (room.state as Partial<MatchRoomState>).players !== undefined);
    return joined;
  }

  /** Wait until the lobby countdown has expired and the match is actually simulating. */
  async function waitForRunning(client: TestClient): Promise<void> {
    await waitFor(() => client.room.state.phase === "running");
  }

  beforeEach(async () => {
    sequence = 0;
    handle = createGameServer({
      buildVersion: BUILD_VERSION,
      logger: silentLogger,
      allowedOrigins: ["http://localhost:5173"],
      match: {
        lobbyDurationMs: TEST_LOBBY_MS,
        matchDurationMs: TEST_MATCH_MS,
        reconnectWindowMs: 1_000,
        endingDurationMs: 60_000,
        seed: 12_345,
      },
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

  it("creates a room, admits two clients into it, and starts the match together", async () => {
    const a = await joinMatch();
    const b = await joinMatch();

    expect(b.room.roomId).toBe(a.room.roomId);
    await waitFor(() => a.room.state.players.size === 2);
    await waitForRunning(a);
    await waitForRunning(b);

    // Both clients see the same match: same arena, same seed, same two players.
    expect(a.room.state.arenaId).toBe(testArena.id);
    expect(b.room.state.seed).toBe(a.room.state.seed);
    expect([...b.room.state.players.keys()].sort()).toEqual(
      [...a.room.state.players.keys()].sort(),
    );

    await a.room.leave(true);
    await b.room.leave(true);
  });

  it("locks the room at match start, so a later client gets a different match (D7)", async () => {
    const a = await joinMatch();
    await waitForRunning(a);

    const b = await joinMatch();
    expect(b.room.roomId).not.toBe(a.room.roomId);

    await a.room.leave(true);
    await b.room.leave(true);
  });

  it("spawns two players at different positions", async () => {
    const a = await joinMatch();
    const b = await joinMatch();
    await waitFor(() => a.room.state.players.size === 2);

    const positions = [...a.room.state.players.values()].map(
      (player) => `${String(player.x)},${String(player.y)}`,
    );
    expect(new Set(positions).size).toBe(2);

    await a.room.leave(true);
    await b.room.leave(true);
  });

  it("moves a player only in the direction they asked for, and each client sees the other move", async () => {
    const a = await joinMatch();
    const b = await joinMatch();
    await waitForRunning(a);
    await waitForRunning(b);

    const idA = a.room.sessionId;
    const startX = a.room.state.players.get(idA)!.x;

    a.send({ moveX: 1 });
    await waitFor(() => a.room.state.players.get(idA)!.x > startX + 20);

    // The other client's view of A agrees.
    await waitFor(() => (b.room.state.players.get(idA)?.x ?? 0) > startX + 20);
    expect(b.room.state.players.get(idA)!.y).toBeCloseTo(a.room.state.players.get(idA)!.y, 0);

    await a.room.leave(true);
    await b.room.leave(true);
  });

  it("synchronizes enemies identically to every client", async () => {
    const a = await joinMatch();
    const b = await joinMatch();
    await waitForRunning(a);
    await waitForRunning(b);

    await waitFor(() => a.room.state.enemies.size === testArena.enemyCount);
    await waitFor(() => b.room.state.enemies.size === testArena.enemyCount);
    expect([...b.room.state.enemies.keys()].sort()).toEqual(
      [...a.room.state.enemies.keys()].sort(),
    );

    await a.room.leave(true);
    await b.room.leave(true);
  });

  it("sends each client its own private state and never another client's", async () => {
    const a = await joinMatch({ skillLoadoutIds: ["ricochet"] });
    const b = await joinMatch({ skillLoadoutIds: ["multishot", "wide_arc"] });
    await waitFor(() => a.privateState() !== null && b.privateState() !== null);

    expect(a.privateState()?.playerId).toBe(a.room.sessionId);
    expect(a.privateState()?.skillIds).toEqual(["ricochet"]);
    expect(b.privateState()?.skillIds).toEqual(["multishot", "wide_arc"]);

    // The synchronized state — the document *both* clients receive — carries no
    // inventory, secure slot, loadout, or run result for anyone (technical plan
    // §10.3). This is the filtering rule, checked as a property of the wire
    // format rather than of one code path.
    const publicPlayer = b.room.state.players.get(a.room.sessionId)! as unknown as Record<
      string,
      unknown
    >;
    for (const privateKey of [
      "inventory",
      "secureSlot",
      "secureSlotItemId",
      "skillIds",
      "skillLoadout",
      "wildcardSkillId",
      "runResult",
    ]) {
      expect(publicPlayer[privateKey]).toBeUndefined();
    }
    // The public fields a renderer does need are all there, so the assertion
    // above is about filtering rather than about an empty object.
    expect(typeof publicPlayer["health"]).toBe("number");

    await a.room.leave(true);
    await b.room.leave(true);
  });

  it("refuses a client whose protocol version is incompatible", async () => {
    const client = new Client(wsBaseUrl);
    await expect(
      client.joinOrCreate(MATCH_ROOM, { ...validJoin, protocolVersion: PROTOCOL_VERSION + 1 }),
    ).rejects.toMatchObject({
      message: INCOMPATIBLE_CLIENT_MESSAGE,
      code: PROTOCOL_MISMATCH_CODE,
    });
  });

  it("refuses a client whose content version is incompatible (docs/DECISIONS.md D34)", async () => {
    const client = new Client(wsBaseUrl);
    await expect(
      client.joinOrCreate(MATCH_ROOM, { ...validJoin, contentVersion: CONTENT_VERSION + 1 }),
    ).rejects.toMatchObject({
      message: INCOMPATIBLE_CLIENT_MESSAGE,
      code: PROTOCOL_MISMATCH_CODE,
    });
  });

  it("refuses a client whose skill loadout is over budget or unknown", async () => {
    const client = new Client(wsBaseUrl);
    // returning_shot costs 2 slots; plus two 1-slot skills is 4, over the budget
    // of 3. The client's own picker refuses this too — but the server is the one
    // that decides.
    await expect(
      client.joinOrCreate(MATCH_ROOM, {
        ...validJoin,
        skillLoadoutIds: ["returning_shot", "ricochet", "piercing_rounds"],
      }),
    ).rejects.toThrow();

    await expect(
      client.joinOrCreate(MATCH_ROOM, { ...validJoin, skillLoadoutIds: ["no_such_skill"] }),
    ).rejects.toThrow();

    // Neither refused client occupies a seat, so no match room lingers.
    await waitFor(async () => (await matchMaker.query({ name: MATCH_ROOM })).length === 0);
  });

  it("kills a player who stands in the chasers, and drops their carried loot for others", async () => {
    const a = await joinMatch();
    await waitForRunning(a);

    // Pick something up first, so the death has loot to drop.
    const loot = [...a.room.state.groundLoot.values()][0]!;
    await walkTo(a, loot.x, loot.y);
    a.send({ interactPressed: true });
    await waitFor(() => (a.privateState()?.inventory ?? []).some((item) => item !== null));
    a.send({ interactPressed: false });

    // Then stand still. The chasers come to the player — that is what they do
    // (concept §14.2) — so nothing here scripts the kill.
    await waitFor(() => !a.room.state.players.get(a.room.sessionId)!.alive, 60_000);
    await waitFor(() => a.privateState()?.runResult !== null);
    expect(a.privateState()?.runResult?.outcome).toBe("died");

    // Concept §15.2: normal inventory items drop and stay lootable.
    const dropped = [...a.room.state.groundLoot.values()].filter((entry) =>
      entry.id.startsWith(`loot-death-${a.room.sessionId}`),
    );
    expect(dropped).toHaveLength(1);
    expect((a.privateState()?.inventory ?? []).every((item) => item === null)).toBe(true);

    await a.room.leave(true);
  }, 90_000);

  it("keeps a disconnected player in the match, stationary but still present (technical plan §34.1)", async () => {
    const a = await joinMatch();
    const b = await joinMatch();
    await waitForRunning(a);
    await waitForRunning(b);
    const idA = a.room.sessionId;

    a.send({ moveX: 1 });
    await waitFor(() => b.room.state.players.get(idA)!.x > 0);

    // An unconsented drop: the socket goes away without a deliberate leave.
    await a.room.leave(false);
    await waitFor(() => b.room.state.players.get(idA)?.connected === false);

    const restingX = b.room.state.players.get(idA)!.x;
    await new Promise((resolve) => setTimeout(resolve, 400));
    // Their last input is discarded, so they stop where they were — they do not
    // keep sliding, and they do not vanish.
    expect(b.room.state.players.get(idA)!.x).toBe(restingX);
    expect(b.room.state.players.get(idA)).toBeDefined();

    await b.room.leave(true);
  });

  it("removes an abandoned player once the reconnect window lapses, dropping their loot", async () => {
    const a = await joinMatch();
    const b = await joinMatch();
    await waitForRunning(a);
    await waitForRunning(b);
    const idA = a.room.sessionId;

    const loot = [...a.room.state.groundLoot.values()][0]!;
    await walkTo(a, loot.x, loot.y);
    a.send({ interactPressed: true });
    await waitFor(() => (a.privateState()?.inventory ?? []).some((item) => item !== null));
    await a.room.leave(false);
    // The window is 1s in this suite; after it lapses the run is abandoned.
    await waitFor(() => !b.room.state.players.has(idA), 15_000);
    // Abandoning must not remove contested loot from the match: what they were
    // carrying is dropped where they stood, with an id that records why.
    const dropped = [...b.room.state.groundLoot.values()].filter((loot) =>
      loot.id.startsWith(`loot-left-${idA}`),
    );
    expect(dropped).toHaveLength(1);

    await b.room.leave(true);
  });

  it("frees the seat immediately on a deliberate leave", async () => {
    const a = await joinMatch();
    const b = await joinMatch();
    await waitForRunning(a);
    const idA = a.room.sessionId;

    await a.room.leave(true);
    await waitFor(() => !b.room.state.players.has(idA));

    await b.room.leave(true);
  });

  it("disposes the room once the last client leaves", async () => {
    const a = await joinMatch();
    await waitFor(() => a.room.state.players.size === 1);
    const { roomId } = a.room;

    await a.room.leave(true);
    await waitFor(async () => (await matchMaker.query({ roomId })).length === 0);
    expect(await matchMaker.query({ roomId })).toHaveLength(0);
  });

  /**
   * Drive the player toward a point with real input messages, giving up at
   * `timeoutMs` or when `stop()` says so. Movement is server-decided, so this
   * polls the authoritative position rather than assuming a travel time.
   */
  async function walkTo(
    client: TestClient,
    targetX: number,
    targetY: number,
    timeoutMs = 30_000,
    stop: () => boolean = () => false,
  ): Promise<void> {
    const id = client.room.sessionId;
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const player = client.room.state.players.get(id);
      if (player === undefined || stop()) {
        return;
      }
      const dx = targetX - player.x;
      const dy = targetY - player.y;
      if (Math.hypot(dx, dy) < 20) {
        client.send({});
        return;
      }
      if (Date.now() > deadline) {
        throw new Error(
          `walkTo: did not reach (${String(targetX)}, ${String(targetY)}) within ${String(timeoutMs)}ms`,
        );
      }
      client.send({
        moveX: Math.abs(dx) > 8 ? (dx > 0 ? 1 : -1) : 0,
        moveY: Math.abs(dy) > 8 ? (dy > 0 ? 1 : -1) : 0,
      });
      await new Promise((resolve) => setTimeout(resolve, 60));
    }
  }
});

/**
 * The same room, on an arena with no chasers on it. Extraction, pickup, and the
 * secure slot are rules about a player and the world, and running them next to
 * three enemies converging on the only player tests the walk rather than the
 * rule — a chaser interrupting a channel is *correct* behavior that would make
 * these cases fail for the wrong reason. The chasers get their own test above,
 * where they are the subject.
 *
 * The arena here is a fixture, not content: it is passed through the same
 * `MatchRoomDeps.arena` seam a second real map would arrive through.
 */
describe("match room rules, isolated from the chasers", () => {
  let handle: GameServerHandle;
  let wsBaseUrl: string;
  let sequence = 0;

  /** No enemies; loot, a chip, and every extraction point a step from the spawn. */
  const quietArena: ArenaDefinition = {
    id: "test_quiet_arena",
    kind: "arena",
    width: 1000,
    height: 1000,
    walls: [],
    playerSpawnPoints: [
      { x: 500, y: 500 },
      { x: 560, y: 500 },
    ],
    enemySpawnPoints: [{ x: 900, y: 900 }],
    enemyCount: 0,
    groundLootSpawnPoints: [
      { x: 500, y: 540 },
      { x: 500, y: 580 },
    ],
    skillChipSpawnPoints: [{ x: 460, y: 500 }],
    extractionCandidatePoints: [
      { x: 400, y: 400 },
      { x: 600, y: 400 },
      { x: 400, y: 600 },
      { x: 600, y: 600 },
    ],
    openLaneY: 900,
  };

  function attach(room: Room<unknown, MatchRoomState>): TestClient {
    let privateState: LocalPlayerState | null = null;
    room.onMessage(PRIVATE_STATE_MESSAGE_TYPE, (message: LocalPlayerState) => {
      privateState = message;
    });
    return {
      room,
      privateState: () => privateState,
      send: (input) => {
        sequence += 1;
        room.send(INPUT_MESSAGE_TYPE, { ...NEUTRAL, ...input, sequence });
      },
    };
  }

  async function joinMatch(options: Record<string, unknown> = {}): Promise<TestClient> {
    const client = new Client(wsBaseUrl);
    const room = await client.joinOrCreate<MatchRoomState>(MATCH_ROOM, {
      ...validJoin,
      ...options,
    });
    const joined = attach(room);
    await waitFor(() => (room.state as Partial<MatchRoomState>).players !== undefined);
    return joined;
  }

  /**
   * Wait until the lobby countdown has expired. Deliberately *not* folded into
   * `joinMatch`: the room locks when the match starts (technical plan §8.3), so
   * a helper that waited for `running` before returning would push a second
   * client into a different match.
   */
  async function waitForRunning(...clients: TestClient[]): Promise<void> {
    for (const client of clients) {
      await waitFor(() => client.room.state.phase === "running");
    }
  }

  /** Walk onto a ground-loot item and take it, then release interact. */
  async function pickUp(client: TestClient, x: number, y: number): Promise<void> {
    const held = () =>
      (client.privateState()?.inventory ?? []).filter((item) => item !== null).length;
    const before = held();
    await walkTo(client, x, y);
    client.send({ interactPressed: true });
    await waitFor(() => held() > before);
    client.send({ interactPressed: false });
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

  beforeEach(async () => {
    sequence = 0;
    handle = createGameServer({
      buildVersion: BUILD_VERSION,
      logger: silentLogger,
      allowedOrigins: ["http://localhost:5173"],
      match: {
        lobbyDurationMs: TEST_LOBBY_MS,
        matchDurationMs: TEST_MATCH_MS,
        reconnectWindowMs: 1_000,
        seed: 7,
        arena: quietArena,
      },
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

  it("picks up loot on request, removing it from the world for everyone", async () => {
    const a = await joinMatch();
    const b = await joinMatch();
    await waitForRunning(a, b);

    const target = [...a.room.state.groundLoot.values()][0]!;
    await pickUp(a, target.x, target.y);

    await waitFor(() => !a.room.state.groundLoot.has(target.id));
    expect((a.privateState()?.inventory ?? []).filter((item) => item !== null)).toHaveLength(1);
    // Gone for the other client too: one world, one item.
    await waitFor(() => !b.room.state.groundLoot.has(target.id));
    expect((b.privateState()?.inventory ?? []).every((item) => item === null)).toBe(true);

    await a.room.leave(true);
    await b.room.leave(true);
  });

  it("secures an item on request, and refuses a second secure while the slot is occupied", async () => {
    const a = await joinMatch();
    await waitForRunning(a);
    const loot = [...a.room.state.groundLoot.values()];

    await pickUp(a, loot[0]!.x, loot[0]!.y);
    await pickUp(a, loot[1]!.x, loot[1]!.y);
    expect((a.privateState()?.inventory ?? []).filter((item) => item !== null)).toHaveLength(2);

    a.room.send(SECURE_ITEM_MESSAGE_TYPE, { sourceSlot: 0 });
    await waitFor(() => a.privateState()?.secureSlotItemId !== null);
    const secured = a.privateState()?.secureSlotItemId;

    // A second secure attempt cannot displace the first (concept §7.2: the
    // secure slot "cannot be removed during the run").
    a.room.send(SECURE_ITEM_MESSAGE_TYPE, { sourceSlot: 1 });
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(a.privateState()?.secureSlotItemId).toBe(secured);
    expect((a.privateState()?.inventory ?? [])[1]).not.toBeNull();

    await a.room.leave(true);
  });

  it("discards an item on request", async () => {
    const a = await joinMatch();
    await waitForRunning(a);
    const target = [...a.room.state.groundLoot.values()][0]!;

    await pickUp(a, target.x, target.y);

    a.room.send(DISCARD_ITEM_MESSAGE_TYPE, { sourceSlot: 0 });
    await waitFor(() => (a.privateState()?.inventory ?? []).every((item) => item === null));

    await a.room.leave(true);
  });

  it("extracts a player who channels a point, ending their run alone", async () => {
    const a = await joinMatch();
    const b = await joinMatch();
    await waitForRunning(a, b);

    const point = [...a.room.state.extractionPoints.values()][0]!;
    await walkTo(a, point.x, point.y);
    a.send({ interactPressed: true });

    await waitFor(() => a.privateState()?.runResult !== null, 20_000);
    expect(a.privateState()?.runResult?.outcome).toBe("extracted");

    // B's own run is untouched by A's extraction (concept §17.1: extraction
    // ends the run "for that player").
    expect(b.privateState()?.runResult ?? null).toBeNull();
    expect(b.room.state.players.get(b.room.sessionId)!.runOver).toBe(false);
    // And B sees A as out of the match.
    await waitFor(() => b.room.state.players.get(a.room.sessionId)?.runOver === true);

    await a.room.leave(true);
    await b.room.leave(true);
  });

  it("converts a carried item into points on extraction, and reports it once", async () => {
    const a = await joinMatch();
    await waitForRunning(a);
    const target = [...a.room.state.groundLoot.values()][0]!;

    await pickUp(a, target.x, target.y);

    const point = [...a.room.state.extractionPoints.values()][0]!;
    await walkTo(a, point.x, point.y);
    a.send({ interactPressed: true });
    await waitFor(() => a.privateState()?.runResult !== null, 20_000);

    const result = a.privateState()!.runResult!;
    expect(result.outcome).toBe("extracted");
    expect(result.itemsConverted).toBe(1);
    expect(result.itemsLost).toBe(0);
    const total =
      result.pointsGained.force +
      result.pointsGained.precision +
      result.pointsGained.motion +
      result.pointsGained.guard +
      result.pointsGained.signal;
    expect(total).toBeGreaterThan(0);

    await a.room.leave(true);
  });
});
