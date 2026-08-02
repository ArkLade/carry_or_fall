/**
 * Adversarial evidence for the §38 M5 exit criteria (M5.9, `docs/M5_ISSUES.md`
 * §10).
 *
 * The contract suite (`progression-contract.ts`) attacks the *store*. This file
 * attacks the **room**: a real listening server, real `@colyseus/sdk` clients,
 * and a `MemoryStore` whose faults can be staged so a database can fail in ways
 * a caller cannot distinguish.
 *
 * Two questions it exists to answer, both of which a happy-path test would
 * quietly pass without answering:
 *
 * 1. Can a client cause a second award? (No message it can send even mentions a
 *    reward — attack 4 below sends one anyway.)
 * 2. Can a player be told an item is secure when the write did not land? (The
 *    ordering makes it structurally impossible, and the two tests here stage
 *    both a failing and a hanging write.)
 */
import { type ArenaDefinition, CONTENT_VERSION, warlordsSeal } from "@carry-or-fall/game-content";
import {
  type ExtractionPointView,
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
import type { Balances } from "../src/progression/store";
import { createGameServer, type GameServerHandle } from "../src/server";

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
 * One token, reused across joins, so every join in a test is the *same account*.
 * That is what makes recovery testable at all: a returning player is the entire
 * premise of technical plan §14.3's "the next login finalizes the protected
 * reward".
 */
const RETURNING_TOKEN = "test-session-token-a";

const validJoin = {
  protocolVersion: PROTOCOL_VERSION,
  contentVersion: CONTENT_VERSION,
  buildVersion: BUILD_VERSION,
  skillLoadoutIds: [] as string[],
  accessToken: RETURNING_TOKEN,
};

/**
 * No enemies, one loot item next to the spawn, and an extraction point a step
 * away. The subject here is settlement, so a chaser interrupting a channel would
 * make these fail for a reason that has nothing to do with what they test.
 */
const settlementArena: ArenaDefinition = {
  id: "test_settlement_arena",
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
  skillChipSpawnPoints: [],
  extractionCandidatePoints: [
    { x: 560, y: 560 },
    { x: 440, y: 440 },
    { x: 560, y: 440 },
    { x: 440, y: 560 },
  ],
  openLaneY: 900,
};

async function waitFor(
  predicate: () => boolean | Promise<boolean>,
  timeoutMs = 15_000,
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

describe("settlement under attack (§38 M5 exit criteria)", () => {
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

  async function pickUp(client: TestClient, x: number, y: number): Promise<void> {
    const held = () =>
      (client.privateState()?.inventory ?? []).filter((item) => item !== null).length;
    const before = held();
    await walkTo(client, x, y);
    client.send({ interactPressed: true });
    await waitFor(() => held() > before);
    client.send({ interactPressed: false });
  }

  /** Channel the nearest extraction point until this player's run ends. */
  async function extract(client: TestClient): Promise<void> {
    const points: ExtractionPointView[] = [];
    client.room.state.extractionPoints.forEach((point) => {
      points.push(point);
    });
    const point = points[0];
    if (point === undefined) {
      throw new Error("no extraction point in the arena");
    }
    await walkTo(client, point.x, point.y);
    const deadline = Date.now() + 20_000;
    while (client.privateState()?.runResult == null) {
      if (Date.now() > deadline) {
        throw new Error("extract: run did not end within 20s");
      }
      client.send({ interactPressed: true });
      await new Promise((resolve) => setTimeout(resolve, 60));
    }
  }

  beforeEach(async () => {
    sequence = 0;
    store = new MemoryStore();
    handle = createGameServer({
      buildVersion: BUILD_VERSION,
      logger: silentLogger,
      allowedOrigins: ["http://localhost:5173"],
      progression: {
        store,
        // One attempt with no back-off: these tests are about what happens when
        // a write fails, not about how long the server waits between tries.
        settlement: new SettlementService(store, silentLogger, {
          maxAttempts: 1,
          retryDelayMs: 0,
        }),
      },
      match: {
        lobbyDurationMs: TEST_LOBBY_MS,
        matchDurationMs: 60_000,
        reconnectWindowMs: 1_000,
        seed: 7,
        arena: settlementArena,
        // Explicit: a server with no Supabase provisions every unlock
        // (`server.ts` — with no persistence there is no progression to gate),
        // which would make "the forged message did not grant itself an unlock"
        // vacuously true because the account already held it.
        unlockGrants: DEFAULT_UNLOCK_GRANTS,
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

  it("settles an extraction exactly once, and persists the points (exit criterion 1)", async () => {
    const a = await joinMatch();
    await waitForRunning(a);
    await pickUp(a, 500, 540);
    await extract(a);

    await waitFor(() => a.settlement() !== null);
    const settlement = a.settlement();
    expect(settlement?.alreadySettled).toBe(false);

    // The account, read back through the store rather than from the message the
    // client received — the points must be *in* the account, not merely reported.
    const account = await store.loadAccount(
      // The room's identity for this seat is the local verifier's id, and the
      // store knows exactly one account at this point.
      (await firstUserId(store)) ?? "",
    );
    expect(account?.balances).toEqual(settlement?.balances);
    expect(sumPoints(account?.balances)).toBeGreaterThan(0);
    expect(store.appliedSettlementCount).toBe(1);

    await a.room.leave(true);
  });

  it("attack 4 — a client replaying a settlement message awards nothing", async () => {
    const a = await joinMatch();
    await waitForRunning(a);
    await pickUp(a, 500, 540);
    await extract(a);
    await waitFor(() => a.settlement() !== null);

    const banked = (await store.loadAccount((await firstUserId(store)) ?? ""))?.balances;
    expect(store.appliedSettlementCount).toBe(1);

    // A fabricated settlement, shaped exactly like the one the server sent, plus
    // a generous invented balance. There is no handler for it: the room's "*"
    // handler counts it as invalid behavior and discards it.
    for (let attempt = 0; attempt < 5; attempt += 1) {
      a.room.send(SETTLEMENT_MESSAGE_TYPE, {
        alreadySettled: false,
        balances: { force: 9999, precision: 9999, motion: 9999, guard: 9999, signal: 9999 },
        unlockIds: ["returning_shot"],
        newUnlockIds: ["returning_shot"],
        isAnonymous: false,
      });
      await new Promise((resolve) => setTimeout(resolve, 60));
    }

    const after = (await store.loadAccount((await firstUserId(store)) ?? ""))?.balances;
    expect(after).toEqual(banked);
    expect(store.appliedSettlementCount).toBe(1);
    // And the unlock it tried to grant itself never appeared.
    const account = await store.loadAccount((await firstUserId(store)) ?? "");
    expect(account?.unlockIds).not.toContain("returning_shot");
  });

  it("attack 4b — an invented reward message is counted invalid and eventually disconnects", async () => {
    const a = await joinMatch();
    await waitForRunning(a);

    // Technical plan §33: repeated invalid behavior earns a disconnect. Twenty
    // fabricated messages is well past the room's tolerance.
    let left = false;
    a.room.onLeave(() => {
      left = true;
    });
    for (let attempt = 0; attempt < 20; attempt += 1) {
      a.room.send("grant_reward", { force: 1_000_000 });
      await new Promise((resolve) => setTimeout(resolve, 30));
    }

    await waitFor(() => left);
    expect(store.appliedSettlementCount).toBe(0);
  });

  it("crash between the simulation ending and the write landing awards exactly once", async () => {
    const a = await joinMatch();
    await waitForRunning(a);
    await pickUp(a, 500, 540);

    // Secure the item first, so there is a reservation for recovery to find.
    a.room.send(SECURE_ITEM_MESSAGE_TYPE, { sourceSlot: 0 });
    await waitFor(() => a.privateState()?.secureSlotItemId != null);

    // The settlement write fails and the (single-attempt) service gives up: this
    // is the crash, staged so the run genuinely ends with nothing written.
    store.faults.failNextSettleBeforeCommit = true;
    await extract(a);
    await new Promise((resolve) => setTimeout(resolve, 300));

    expect(store.appliedSettlementCount).toBe(0);
    const userId = (await firstUserId(store)) ?? "";
    expect(await store.listPendingReservations(userId, null)).toHaveLength(1);

    // The next join runs recovery, which finishes it under the same key.
    const b = await joinMatch();
    await waitFor(async () => (await store.listPendingReservations(userId, null)).length === 0);
    expect(store.appliedSettlementCount).toBe(1);

    const recovered = await store.loadAccount(userId);
    expect(sumPoints(recovered?.balances)).toBeGreaterThan(0);

    // And a third join must not award it a second time.
    const before = recovered?.balances;
    await joinMatch();
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect((await store.loadAccount(userId))?.balances).toEqual(before);
    expect(store.appliedSettlementCount).toBe(1);

    await b.room.leave(true);
  });

  it("a settlement whose write landed but whose reply was lost awards once", async () => {
    const a = await joinMatch();
    await waitForRunning(a);
    await pickUp(a, 500, 540);
    a.room.send(SECURE_ITEM_MESSAGE_TYPE, { sourceSlot: 0 });
    await waitFor(() => a.privateState()?.secureSlotItemId != null);

    // The dangerous failure: the write commits and *then* the call rejects, so
    // the server cannot tell whether it succeeded.
    store.faults.failNextSettleAfterCommit = true;
    await extract(a);
    await new Promise((resolve) => setTimeout(resolve, 300));

    expect(store.appliedSettlementCount).toBe(1);
    const userId = (await firstUserId(store)) ?? "";
    const banked = (await store.loadAccount(userId))?.balances;

    // Recovery runs anyway, because the room never learned it succeeded. It must
    // find the ledger row and change nothing.
    await joinMatch();
    await new Promise((resolve) => setTimeout(resolve, 300));

    expect(store.appliedSettlementCount).toBe(1);
    expect((await store.loadAccount(userId))?.balances).toEqual(banked);
  });
});

describe("secure-slot persistence before confirmation (§38 M5 exit criterion 2)", () => {
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

  async function joinMatch(): Promise<TestClient> {
    const client = new Client(wsBaseUrl);
    const room = await client.joinOrCreate<MatchRoomState>(MATCH_ROOM, { ...validJoin });
    const joined = attach(room);
    await waitFor(() => (room.state as Partial<MatchRoomState>).players !== undefined);
    return joined;
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

  async function pickUp(client: TestClient, x: number, y: number): Promise<void> {
    const held = () =>
      (client.privateState()?.inventory ?? []).filter((item) => item !== null).length;
    const before = held();
    await walkTo(client, x, y);
    client.send({ interactPressed: true });
    await waitFor(() => held() > before);
    client.send({ interactPressed: false });
  }

  beforeEach(async () => {
    sequence = 0;
    store = new MemoryStore();
    handle = createGameServer({
      buildVersion: BUILD_VERSION,
      logger: silentLogger,
      allowedOrigins: ["http://localhost:5173"],
      progression: { store },
      match: {
        lobbyDurationMs: TEST_LOBBY_MS,
        matchDurationMs: 60_000,
        reconnectWindowMs: 1_000,
        seed: 7,
        arena: settlementArena,
        // Explicit: a server with no Supabase provisions every unlock
        // (`server.ts` — with no persistence there is no progression to gate),
        // which would make "the forged message did not grant itself an unlock"
        // vacuously true because the account already held it.
        unlockGrants: DEFAULT_UNLOCK_GRANTS,
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

  it("persists the reservation before the client ever sees the slot filled", async () => {
    const a = await joinMatch();
    await waitFor(() => a.room.state.phase === "running");
    await pickUp(a, 500, 540);

    a.room.send(SECURE_ITEM_MESSAGE_TYPE, { sourceSlot: 0 });
    await waitFor(() => a.privateState()?.secureSlotItemId != null);

    // By the time the client can observe a filled secure slot, the row exists.
    const userId = (await firstUserId(store)) ?? "";
    const pending = await store.listPendingReservations(userId, null);
    expect(pending).toHaveLength(1);
    expect(pending[0]?.itemId).toBe(a.privateState()?.secureSlotItemId);

    await a.room.leave(true);
  });

  it("crash between report and write — a failed write never reports success", async () => {
    // `docs/DEVELOPMENT_RULES.md`: "insertion must be persisted before it is
    // reported successful, so a server crash cannot invalidate the protection
    // promise." The write here fails outright.
    const a = await joinMatch();
    await waitFor(() => a.room.state.phase === "running");
    await pickUp(a, 500, 540);

    const heldBefore = a.privateState()?.inventory.filter((item) => item !== null).length ?? 0;
    store.faults.failNextReserve = true;
    a.room.send(SECURE_ITEM_MESSAGE_TYPE, { sourceSlot: 0 });

    // Give the room far longer than a secure action needs, then assert nothing
    // moved: the item is still in normal inventory, the secure slot is empty, and
    // no reservation exists. The player was told nothing, which is the truth.
    await new Promise((resolve) => setTimeout(resolve, 500));

    expect(a.privateState()?.secureSlotItemId).toBeNull();
    expect(a.privateState()?.inventory.filter((item) => item !== null).length).toBe(heldBefore);
    const userId = (await firstUserId(store)) ?? "";
    expect(await store.listPendingReservations(userId, null)).toHaveLength(0);

    await a.room.leave(true);
  });

  it("crash between report and write — a hung write never reports success either", async () => {
    // The nastier shape: the call neither resolves nor rejects, which is what a
    // database that has stopped answering looks like. The secure slot must stay
    // empty for as long as that lasts, not fill optimistically.
    const a = await joinMatch();
    await waitFor(() => a.room.state.phase === "running");
    await pickUp(a, 500, 540);

    store.faults.hangNextReserve = true;
    a.room.send(SECURE_ITEM_MESSAGE_TYPE, { sourceSlot: 0 });
    await new Promise((resolve) => setTimeout(resolve, 800));

    expect(a.privateState()?.secureSlotItemId).toBeNull();

    // And a second request while the first is still hanging must not open a
    // second reservation (technical plan §14.2's "not already processing another
    // inventory action").
    a.room.send(SECURE_ITEM_MESSAGE_TYPE, { sourceSlot: 0 });
    await new Promise((resolve) => setTimeout(resolve, 300));

    const userId = (await firstUserId(store)) ?? "";
    expect(await store.listPendingReservations(userId, null)).toHaveLength(0);
    expect(a.privateState()?.secureSlotItemId).toBeNull();

    await a.room.leave(true);
  });

  it("cancels the reservation when the slot changed while the write was in flight", async () => {
    const a = await joinMatch();
    await waitFor(() => a.room.state.phase === "running");
    await pickUp(a, 500, 540);
    await pickUp(a, 500, 580);

    // Secure slot 0 and immediately discard the same slot. Whichever order the
    // room observes, the invariant is the same: the secure slot never ends up
    // holding an item the player no longer had, and no `pending` row is left
    // behind for recovery to honor.
    a.room.send(SECURE_ITEM_MESSAGE_TYPE, { sourceSlot: 0 });
    a.room.send("discard_item", { sourceSlot: 0 });
    await new Promise((resolve) => setTimeout(resolve, 500));

    const userId = (await firstUserId(store)) ?? "";
    const secured = a.privateState()?.secureSlotItemId ?? null;
    const pending = await store.listPendingReservations(userId, null);

    if (secured === null) {
      // The discard won: the reservation must have been withdrawn, not left
      // pending, or recovery would later award an item that was never secured.
      expect(pending).toHaveLength(0);
    } else {
      // The secure won: exactly one reservation, for exactly that item.
      expect(pending).toHaveLength(1);
      expect(pending[0]?.itemId).toBe(secured);
    }

    await a.room.leave(true);
  });

  it("secured progress survives death (exit criterion 2)", async () => {
    const a = await joinMatch();
    await waitFor(() => a.room.state.phase === "running");
    await pickUp(a, 500, 540);
    a.room.send(SECURE_ITEM_MESSAGE_TYPE, { sourceSlot: 0 });
    await waitFor(() => a.privateState()?.secureSlotItemId != null);
    const securedId = a.privateState()?.secureSlotItemId;

    // Leaving abandons the run (D39). Its carried loot is lost, but the secured
    // item is exactly the thing that must not be — recovery finalizes it on the
    // next join.
    await a.room.leave(true);
    const userId = (await firstUserId(store)) ?? "";
    await waitFor(async () => (await store.listPendingReservations(userId, null)).length === 1);

    await joinMatch();
    await waitFor(async () => (await store.listPendingReservations(userId, null)).length === 0);

    const account = await store.loadAccount(userId);
    expect(sumPoints(account?.balances)).toBeGreaterThan(0);
    // The awarded points are that item's, not an invented total.
    if (securedId === warlordsSeal.id) {
      expect(account?.balances).toEqual(warlordsSeal.points);
    }
  });
});

/**
 * The account behind {@link RETURNING_TOKEN}. The local verifier treats a
 * presented token as the identity (`progression/auth.ts`), which is what lets
 * these tests model *the same player returning* — the case crash recovery is
 * entirely about.
 */
async function firstUserId(store: MemoryStore): Promise<string | null> {
  const candidate = await store.loadAccount(localUserIdFor(RETURNING_TOKEN));
  return candidate === null ? null : candidate.userId;
}

/** Mirrors `LocalTokenVerifier`'s id derivation, so a test can name the account it created. */
function localUserIdFor(token: string): string {
  let hash = 0x811c_9dc5;
  for (let index = 0; index < token.length; index += 1) {
    hash ^= token.charCodeAt(index);
    hash = Math.imul(hash, 0x0100_0193) >>> 0;
  }
  return `local-${hash.toString(16).padStart(8, "0")}`;
}

function sumPoints(balances: Balances | undefined): number {
  if (balances === undefined) {
    return 0;
  }
  return balances.force + balances.precision + balances.motion + balances.guard + balances.signal;
}
