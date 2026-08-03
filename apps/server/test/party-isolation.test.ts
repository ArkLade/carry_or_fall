/**
 * **Exit criterion 2 for §38 M6: "individual inventories remain separate."**
 *
 * Before M5 that sentence would have been a HUD note. It is a security property
 * now: a party member is an authenticated account sitting in the same room as
 * another authenticated account, and the question is whether being in a party
 * grants any read or write across that boundary
 * (`docs/M6_ISSUES.md` §1.6, §11.1).
 *
 * The answer M6 implements is **party membership grants shared presence, not
 * shared possessions**, and every test below is an attempt to disprove it: one
 * member trying to read, take, secure, discard, or settle another member's
 * things. Each must be *refused*, and the refusal must be observable — an
 * assertion that a message "does nothing" is checked against the victim's own
 * authoritative state, never against the attacker's belief about it.
 *
 * These are three real accounts on three real sockets in one real match room,
 * seated there by the real party queue.
 */
import { CONTENT_VERSION, type ArenaDefinition } from "@carry-or-fall/game-content";
import {
  DISCARD_ITEM_MESSAGE_TYPE,
  INPUT_MESSAGE_TYPE,
  type InputMessage,
  type LocalPlayerState,
  MATCH_ROOM,
  type MatchRoomState,
  PRIVATE_STATE_MESSAGE_TYPE,
  SECURE_ITEM_MESSAGE_TYPE,
  PROTOCOL_VERSION,
  SETTLEMENT_MESSAGE_TYPE,
  type SettlementMessage,
} from "@carry-or-fall/protocol";
import { INVENTORY_SIZE } from "@carry-or-fall/simulation-core";
import { Client, type Room } from "@colyseus/sdk";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { MemoryStore } from "../src/progression/memory-store";
import { createGameServer, type GameServerHandle } from "../src/server";
import {
  BUILD_VERSION,
  createParty,
  joinParty,
  leaveQuietly,
  silentLogger,
  waitFor,
  withoutAutoReconnect,
  type PartyClient,
} from "./party-helpers";

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
 * Three spawn points, an item on top of each of the first two, an extraction
 * point a step from the first, and no enemies. The subject here is what one
 * account can do to another's possessions; a chaser ending somebody's run would
 * fail these for a reason that has nothing to do with it.
 */
const partyArena: ArenaDefinition = {
  id: "test_party_arena",
  kind: "arena",
  width: 1200,
  height: 1200,
  walls: [],
  playerSpawnPoints: [
    { x: 300, y: 300 },
    { x: 700, y: 300 },
    { x: 300, y: 700 },
  ],
  enemySpawnPoints: [{ x: 1100, y: 1100 }],
  enemyCount: 0,
  groundLootSpawnPoints: [
    { x: 300, y: 320 },
    { x: 700, y: 320 },
  ],
  skillChipSpawnPoints: [],
  extractionCandidatePoints: [
    { x: 340, y: 340 },
    { x: 900, y: 900 },
    { x: 900, y: 200 },
    { x: 200, y: 900 },
  ],
  openLaneY: 1100,
};

/** Distinct tokens, so the three members are three distinct accounts (D45). */
const TOKENS = ["party-member-a", "party-member-b", "party-member-c"] as const;

interface MatchClient {
  readonly room: Room<unknown, MatchRoomState>;
  readonly privateState: () => LocalPlayerState | null;
  /** Every private-state message this client received, for the "never leaked" checks. */
  readonly privateHistory: () => readonly LocalPlayerState[];
  readonly settlement: () => SettlementMessage | null;
  send: (input: Partial<Omit<InputMessage, "sequence">>) => void;
  raw: (type: string, payload: unknown) => void;
}

describe("a party shares presence, not possessions (§38 M6 exit criterion 2)", () => {
  let handle: GameServerHandle;
  let store: MemoryStore;
  let wsBaseUrl: string;
  let sequence = 0;
  const openParties: PartyClient[] = [];
  const openMatches: Room<unknown, MatchRoomState>[] = [];

  beforeEach(async () => {
    sequence = 0;
    store = new MemoryStore();
    handle = createGameServer({
      buildVersion: BUILD_VERSION,
      logger: silentLogger,
      allowedOrigins: ["http://localhost:5173"],
      progression: { store },
      match: {
        // Long enough that a solo player can be in the room before a party is
        // seated into it (the intruder case below), and short enough that ten
        // tests do not spend a minute waiting.
        lobbyDurationMs: 1_500,
        groupSeatHoldMs: 5_000,
        reconnectWindowMs: 1_000,
        arena: partyArena,
        seed: 76,
      },
      party: { reconnectWindowMs: 1_000 },
    });
    await handle.gameServer.listen(0);
    const address = handle.httpServer.address();
    if (address === null || typeof address === "string") {
      throw new Error("expected the server to be listening on a TCP port");
    }
    wsBaseUrl = `ws://127.0.0.1:${String(address.port)}`;
  });

  afterEach(async () => {
    for (const room of openMatches.splice(0)) {
      await leaveQuietly(room);
    }
    for (const party of openParties.splice(0)) {
      await leaveQuietly(party.room);
    }
    await handle.gameServer.gracefullyShutdown(false);
  });

  function attach(room: Room<unknown, MatchRoomState>): MatchClient {
    const history: LocalPlayerState[] = [];
    let settlement: SettlementMessage | null = null;
    room.onMessage(PRIVATE_STATE_MESSAGE_TYPE, (message: LocalPlayerState) => {
      history.push(message);
    });
    room.onMessage(SETTLEMENT_MESSAGE_TYPE, (message: SettlementMessage) => {
      settlement = message;
    });
    return {
      room,
      privateState: () => history.at(-1) ?? null,
      privateHistory: () => history,
      settlement: () => settlement,
      send: (input) => {
        sequence += 1;
        room.send(INPUT_MESSAGE_TYPE, { ...NEUTRAL, ...input, sequence });
      },
      raw: (type, payload) => {
        room.send(type, payload);
      },
    };
  }

  /** Form a party of three, queue it, and take every seat: three accounts, one match. */
  async function partyInOneMatch(): Promise<MatchClient[]> {
    const leader = await createParty(wsBaseUrl, { accessToken: TOKENS[0] });
    openParties.push(leader);
    const members = [leader];
    for (const token of TOKENS.slice(1)) {
      const member = await joinParty(wsBaseUrl, leader.room.state.joinCode, {
        accessToken: token,
      });
      openParties.push(member);
      members.push(member);
    }
    await waitFor(() => leader.room.state.members.size === 3);

    leader.room.send("queue_match", {});
    await waitFor(() => members.every((member) => member.seats.length > 0), 15_000, "seats");

    const clients: MatchClient[] = [];
    for (const member of members) {
      const room = withoutAutoReconnect(
        (await member.client.consumeSeatReservation<MatchRoomState>(member.seats.at(-1)!)) as Room<
          unknown,
          MatchRoomState
        >,
      );
      openMatches.push(room);
      clients.push(attach(room));
    }
    await waitFor(
      // `>= 3`, not `=== 3`: one case seats the party into a room that already
      // holds an unrelated player, and the party being three of four is the
      // whole point of that one.
      () => clients.every((client) => (client.room.state.players?.size ?? 0) >= 3),
      15_000,
      "three players in one room",
    );
    // The premise every test below rests on, checked once rather than assumed.
    expect(new Set(clients.map((client) => client.room.roomId)).size).toBe(1);
    await waitFor(() => clients[0]!.room.state.phase === "running", 15_000, "the match to start");
    return clients;
  }

  async function walkTo(client: MatchClient, x: number, y: number): Promise<void> {
    const id = client.room.sessionId;
    const deadline = Date.now() + 20_000;
    for (;;) {
      const player = client.room.state.players.get(id);
      if (player === undefined) {
        return;
      }
      const dx = x - player.x;
      const dy = y - player.y;
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

  function heldItems(client: MatchClient): string[] {
    return (client.privateState()?.inventory ?? []).filter((item): item is string => item !== null);
  }

  async function pickUpNearest(client: MatchClient, x: number, y: number): Promise<string> {
    const before = heldItems(client).length;
    await walkTo(client, x, y);
    client.send({ interactPressed: true });
    await waitFor(() => heldItems(client).length > before, 15_000, "a pickup");
    client.send({ interactPressed: false });
    return heldItems(client).at(-1)!;
  }

  it("marks teammates for each other, and tells a non-party player nothing", async () => {
    const [a, b, c] = await partyInOneMatch();

    // Each member is told its own two teammates — ids it already has from the
    // party roster, of players already in the public snapshot.
    await waitFor(() => (a!.privateState()?.partyMemberIds.length ?? 0) === 2, 10_000, "markers");
    expect([...a!.privateState()!.partyMemberIds].sort()).toEqual(
      [b!.room.sessionId, c!.room.sessionId].sort(),
    );
    expect(a!.privateState()!.partyMemberIds).not.toContain(a!.room.sessionId);

    // And the public document every client receives carries no party field at
    // all, so there is no filtering rule to misconfigure.
    const publicPlayer = { ...a!.room.state.players.get(b!.room.sessionId)! };
    const publicKeys = Object.keys(publicPlayer).join(",").toLowerCase();
    expect(publicKeys).not.toContain("party");
  }, 90_000);

  it("never puts one member's inventory in another member's private state", async () => {
    const [a, b] = await partyInOneMatch();
    const itemA = await pickUpNearest(a!, 300, 320);
    const itemB = await pickUpNearest(b!, 700, 320);

    // Both members have been sent several private updates by now (each pickup
    // changes their own state), so this is not "B happened to receive nothing":
    // it is every message either of them has *ever* received, checked against
    // the other's belongings.
    expect(a!.privateHistory().length).toBeGreaterThan(1);
    expect(b!.privateHistory().length).toBeGreaterThan(1);

    for (const state of b!.privateHistory()) {
      expect(state.playerId).toBe(b!.room.sessionId);
      expect(state.inventory).not.toContain(itemA);
      expect(state.secureSlotItemId).not.toBe(itemA);
    }
    for (const state of a!.privateHistory()) {
      expect(state.playerId).toBe(a!.room.sessionId);
      expect(state.inventory).not.toContain(itemB);
    }

    // And the inventories really are two different things, not one shared bag.
    expect(heldItems(a!)).toContain(itemA);
    expect(heldItems(b!)).toContain(itemB);
    expect(heldItems(a!)).not.toContain(itemB);
    expect(heldItems(b!)).not.toContain(itemA);
  }, 120_000);

  it("refuses one member's attempt to secure or discard another's items", async () => {
    const [a, b] = await partyInOneMatch();
    const item = await pickUpNearest(a!, 300, 320);
    await waitFor(() => heldItems(a!).length === 1);

    // B fires every slot index at both inventory commands. There is no field on
    // either message that could name A — that is the point — so the worst B can
    // do is act on B's own (empty) inventory.
    for (let slot = 0; slot < INVENTORY_SIZE; slot += 1) {
      b!.raw(SECURE_ITEM_MESSAGE_TYPE, { sourceSlot: slot });
      b!.raw(DISCARD_ITEM_MESSAGE_TYPE, { sourceSlot: slot });
    }
    await new Promise((resolve) => setTimeout(resolve, 600));

    expect(heldItems(a!)).toContain(item);
    expect(a!.privateState()!.secureSlotItemId).toBeNull();
    expect(b!.privateState()!.secureSlotItemId).toBeNull();
    expect(heldItems(b!)).toHaveLength(0);
  }, 90_000);

  it("ignores a forged message that tries to name a teammate as its subject", async () => {
    const [a, b] = await partyInOneMatch();
    const item = await pickUpNearest(a!, 300, 320);

    // Two shapes: a known message decorated with a victim, and an invented one.
    // The first has its extra field dropped by the validator; the second has no
    // handler at all and is counted as abuse (technical plan §33).
    b!.raw(SECURE_ITEM_MESSAGE_TYPE, { sourceSlot: 0, targetPlayerId: a!.room.sessionId });
    b!.raw(DISCARD_ITEM_MESSAGE_TYPE, { sourceSlot: 0, playerId: a!.room.sessionId });
    for (const type of ["steal_item", "take_from_party", "give_item", "share_inventory"]) {
      b!.raw(type, { from: a!.room.sessionId, to: b!.room.sessionId, slot: 0 });
    }
    await new Promise((resolve) => setTimeout(resolve, 600));

    expect(heldItems(a!)).toContain(item);
    expect(heldItems(b!)).not.toContain(item);
  }, 90_000);

  it("keeps a secured item private to the member who secured it", async () => {
    const [a, b] = await partyInOneMatch();
    const item = await pickUpNearest(a!, 300, 320);

    a!.raw(SECURE_ITEM_MESSAGE_TYPE, { sourceSlot: heldItems(a!).indexOf(item) });
    await waitFor(() => a!.privateState()?.secureSlotItemId === item, 10_000, "the secure to land");

    expect(b!.privateState()!.secureSlotItemId).toBeNull();
    for (const state of b!.privateHistory()) {
      expect(state.secureSlotItemId).not.toBe(item);
    }
    // Nor is it in the public document, for anyone.
    expect(
      JSON.stringify([...b!.room.state.players.values()].map((p) => ({ ...p }))),
    ).not.toContain(item);
  }, 90_000);

  it("does not share a pickup between party members", async () => {
    // Concept §16.2's group advantages are cooperation, not a shared bag. One
    // item, one owner — party or not.
    const [a, b] = await partyInOneMatch();
    const item = await pickUpNearest(a!, 300, 320);

    // B holds interact where it stands, far from where A's item was.
    b!.send({ interactPressed: true });
    await new Promise((resolve) => setTimeout(resolve, 600));
    b!.send({ interactPressed: false });

    expect(heldItems(b!)).not.toContain(item);
    expect(heldItems(a!)).toContain(item);
  }, 90_000);

  it("settles one member's run into that member's account alone", async () => {
    const [a, b, c] = await partyInOneMatch();
    await pickUpNearest(a!, 300, 320);

    // A channels the nearby extraction point to completion. B and C do nothing.
    const point = [...a!.room.state.extractionPoints.values()][0]!;
    await walkTo(a!, point.x, point.y);
    const deadline = Date.now() + 25_000;
    while (a!.privateState()?.runResult == null) {
      if (Date.now() > deadline) {
        throw new Error("the extraction never completed");
      }
      a!.send({ interactPressed: true });
      await new Promise((resolve) => setTimeout(resolve, 60));
    }
    await waitFor(() => a!.settlement() !== null, 15_000, "a settlement for A");

    // The reward went to exactly one account. The other two are read from the
    // store rather than from a message, because a message they never received
    // is the weaker claim.
    const balances = await Promise.all(
      TOKENS.map(
        async (token) => (await store.loadAccount(`local-${localIdFor(token)}`))?.balances,
      ),
    );
    const earned = balances.filter(
      (entry) => entry !== undefined && Object.values(entry).some((value) => value > 0),
    );
    expect(earned).toHaveLength(1);

    // And no teammate was handed A's settlement message.
    expect(b!.settlement()).toBeNull();
    expect(c!.settlement()).toBeNull();
    expect(b!.privateState()!.runResult).toBeNull();
    expect(c!.privateState()!.runResult).toBeNull();
  }, 120_000);

  it("ignores a fabricated settlement naming a teammate", async () => {
    const [a, b] = await partyInOneMatch();

    // There is deliberately no client → server message that can express a
    // reward (`docs/DATA_MODEL.md` §6), so this has no handler to reach.
    for (let attempt = 0; attempt < 5; attempt += 1) {
      b!.raw(SETTLEMENT_MESSAGE_TYPE, {
        userId: "anyone",
        balances: { force: 999_999, precision: 0, motion: 0, guard: 0, signal: 0 },
      });
      b!.raw("settle_party", { members: [a!.room.sessionId, b!.room.sessionId] });
    }
    await new Promise((resolve) => setTimeout(resolve, 600));

    for (const token of TOKENS) {
      const account = await store.loadAccount(`local-${localIdFor(token)}`);
      for (const value of Object.values(account?.balances ?? {})) {
        expect(value).toBe(0);
      }
    }
  }, 90_000);

  it("does not mark a client as anyone's teammate because it said so", async () => {
    // Technical plan §5.1 puts "party membership authorization" among the
    // things a client must not decide, and the obvious wrong implementation is
    // a `partyId` in the match room's join options. Here an unrelated player
    // sends exactly that — and every party field it can think of — from inside
    // the same room the party is seated into.
    const client = new Client(wsBaseUrl);
    const intruderRoom = withoutAutoReconnect(
      (await client.joinOrCreate<MatchRoomState>(MATCH_ROOM, {
        protocolVersion: PROTOCOL_VERSION,
        contentVersion: CONTENT_VERSION,
        buildVersion: BUILD_VERSION,
        skillLoadoutIds: [],
        accessToken: "intruder",
        partyId: "the-party-i-am-not-in",
        party: { members: TOKENS },
        partyMemberIds: ["anyone", "everyone"],
      })) as Room<unknown, MatchRoomState>,
    );
    openMatches.push(intruderRoom);
    const intruder = attach(intruderRoom);
    await waitFor(() => intruderRoom.state.players !== undefined, 10_000, "the intruder to join");

    const members = await partyInOneMatch();
    // The premise: they really are in one room together.
    expect(members[0]!.room.roomId).toBe(intruderRoom.roomId);
    await waitFor(
      () => (members[0]!.privateState()?.partyMemberIds.length ?? 0) === 2,
      10_000,
      "markers",
    );

    // The intruder is nobody's teammate, and nobody is theirs.
    expect(intruder.privateState()!.partyMemberIds).toEqual([]);
    for (const member of members) {
      expect(member.privateState()!.partyMemberIds).not.toContain(intruderRoom.sessionId);
      expect(member.privateState()!.partyMemberIds).toHaveLength(2);
    }
  }, 120_000);
});

/**
 * How `LocalTokenVerifier` derives a stable local id from a token — mirrored
 * here so a test can look an account up in the store by the token it presented.
 */
function localIdFor(token: string): string {
  let hash = 0x811c_9dc5;
  for (let index = 0; index < token.length; index += 1) {
    hash ^= token.charCodeAt(index);
    hash = Math.imul(hash, 0x0100_0193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}
