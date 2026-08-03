/**
 * **Exit criterion 1 for §38 M6: "a party joins one room together."**
 *
 * The requirement is *every time*, not usually, so these tests are written
 * against the mechanism that makes it deterministic rather than against a lucky
 * run (`docs/M6_ISSUES.md` §1.2): the queue reserves every seat a party needs in
 * one atomic step, and the room refuses to start while it holds a seat nobody
 * has taken. Nothing here waits on a window.
 *
 * Also covered, because the interesting cases are the ones where "together"
 * is hard: a room that already holds six players, two parties queueing at the
 * same instant, and a member who drops mid-queue.
 */
import { MATCH_ROOM, type MatchRoomState } from "@carry-or-fall/protocol";
import { matchMaker } from "@colyseus/core";
import type { Room } from "@colyseus/sdk";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { MATCH_MAX_CLIENTS } from "../src/rooms/MatchRoom";
import { createGameServer, type GameServerHandle } from "../src/server";
import {
  BUILD_VERSION,
  consumeSeat,
  createParty,
  joinMatchSolo,
  joinParty,
  leaveQuietly,
  silentLogger,
  sleep,
  waitFor,
  type PartyClient,
} from "./party-helpers";

/**
 * Long enough that a party's seats are still outstanding while a test looks at
 * them, short enough that nothing waits on a human timescale.
 */
const TEST_LOBBY_MS = 3_000;
const TEST_GROUP_HOLD_MS = 2_000;

describe("party matchmaking (§38 M6 exit criterion 1)", () => {
  let handle: GameServerHandle;
  let wsBaseUrl: string;
  const openParties: PartyClient[] = [];
  const openMatches: Room<unknown, MatchRoomState>[] = [];

  beforeEach(async () => {
    handle = createGameServer({
      buildVersion: BUILD_VERSION,
      logger: silentLogger,
      allowedOrigins: ["http://localhost:5173"],
      match: {
        lobbyDurationMs: TEST_LOBBY_MS,
        groupSeatHoldMs: TEST_GROUP_HOLD_MS,
        reconnectWindowMs: 1_000,
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

  /** Build a party of `size`, returning its members with the leader first. */
  async function buildParty(size: number): Promise<PartyClient[]> {
    const leader = await createParty(wsBaseUrl);
    openParties.push(leader);
    const members = [leader];
    for (let index = 1; index < size; index += 1) {
      const member = await joinParty(wsBaseUrl, leader.room.state.joinCode);
      openParties.push(member);
      members.push(member);
    }
    await waitFor(() => leader.room.state.members.size === size);
    return members;
  }

  /** Queue a party and wait until every member has been handed a seat. */
  async function queueParty(members: PartyClient[]): Promise<void> {
    members[0]!.room.send("queue_match", {});
    await waitFor(
      () => members.every((member) => member.seats.length > 0),
      15_000,
      "every member to receive a seat",
    );
  }

  /** Consume every member's seat and wait until the match room reports them all. */
  async function enterMatch(members: PartyClient[]): Promise<Room<unknown, MatchRoomState>[]> {
    const rooms: Room<unknown, MatchRoomState>[] = [];
    for (const member of members) {
      const room = await consumeSeat(member, member.seats.at(-1)!);
      openMatches.push(room);
      rooms.push(room);
    }
    await waitFor(
      () => rooms.every((room) => (room.state as Partial<MatchRoomState>).players !== undefined),
      15_000,
      "match state to arrive",
    );
    return rooms;
  }

  it("seats a party of three in one room, every time", async () => {
    // Three consecutive allocations, because the claim is "every time". One
    // pass proves the happy path exists; three consecutive ones on a server
    // that also has other rooms alive is the weakest form of "reliably".
    for (let round = 0; round < 3; round += 1) {
      const members = await buildParty(3);
      await queueParty(members);
      const rooms = await enterMatch(members);

      const roomIds = new Set(rooms.map((room) => room.roomId));
      expect(roomIds.size, `round ${String(round)} split the party`).toBe(1);

      // Not merely "all connected": each client sees exactly the three of them,
      // and its own id among them.
      for (const room of rooms) {
        await waitFor(() => room.state.players.size === 3, 10_000, "three players");
        const ids = [...room.state.players.keys()].sort();
        expect(ids).toEqual(rooms.map((entry) => entry.sessionId).sort());
        expect(ids).toContain(room.sessionId);
      }

      for (const room of rooms) {
        await leaveQuietly(room);
      }
      for (const member of members) {
        await leaveQuietly(member.room);
      }
      openMatches.length = 0;
      openParties.length = 0;
    }
  }, 90_000);

  it("does not split a party of three around a room that already holds six", async () => {
    // The named case. Six free-standing players fill a room to six; three seats
    // short of the party's three, the queue must decline that room outright
    // rather than seating two there and one elsewhere.
    const solos: Room<unknown, MatchRoomState>[] = [];
    for (let index = 0; index < 6; index += 1) {
      const room = await joinMatchSolo(wsBaseUrl);
      openMatches.push(room);
      solos.push(room);
    }
    const soloRoomIds = new Set(solos.map((room) => room.roomId));
    expect(soloRoomIds.size, "the six solos did not share one room").toBe(1);
    const crowdedRoomId = solos[0]!.roomId;

    const members = await buildParty(3);
    await queueParty(members);
    const rooms = await enterMatch(members);

    const partyRoomIds = new Set(rooms.map((room) => room.roomId));
    expect(partyRoomIds.size, "the party was split").toBe(1);
    expect([...partyRoomIds][0]).not.toBe(crowdedRoomId);

    // And the crowded room is untouched — nobody was displaced to make space.
    await waitFor(() => solos[0]!.state.players.size === 6, 10_000, "six players still there");
    expect(solos[0]!.state.players.size).toBe(6);
  }, 90_000);

  it("seats a party of three into a room that can still hold them", async () => {
    // The other half of the same rule: declining a room that is too full must
    // not become "always make a new room", or parties would never meet anyone.
    const solo = await joinMatchSolo(wsBaseUrl);
    openMatches.push(solo);

    const members = await buildParty(3);
    await queueParty(members);
    const rooms = await enterMatch(members);

    expect(new Set(rooms.map((room) => room.roomId)).size).toBe(1);
    expect(rooms[0]!.roomId).toBe(solo.roomId);
    await waitFor(() => solo.state.players.size === 4, 10_000, "four players");
  }, 90_000);

  it("keeps two parties intact when they queue at the same instant", async () => {
    const first = await buildParty(3);
    const second = await buildParty(3);

    // Both leaders press the button in the same tick. The queue serializes
    // them; without that they could both be told the same seats are free.
    first[0]!.room.send("queue_match", {});
    second[0]!.room.send("queue_match", {});

    await waitFor(
      () => [...first, ...second].every((member) => member.seats.length > 0),
      20_000,
      "all six seats",
    );

    const firstRooms = await enterMatch(first);
    const secondRooms = await enterMatch(second);

    expect(new Set(firstRooms.map((room) => room.roomId)).size, "party one split").toBe(1);
    expect(new Set(secondRooms.map((room) => room.roomId)).size, "party two split").toBe(1);

    // Six seats were allocated, and no room went over its cap.
    for (const cache of await matchMaker.query({ name: MATCH_ROOM })) {
      expect(cache.clients).toBeLessThanOrEqual(MATCH_MAX_CLIENTS);
    }
    const seated = firstRooms[0]!.roomId === secondRooms[0]!.roomId ? 6 : 3;
    await waitFor(
      () => firstRooms[0]!.state.players.size === seated,
      10_000,
      "every seat filled exactly once",
    );
  }, 90_000);

  it("holds the lobby until the party has taken the seats it was promised", async () => {
    // §8.3 disables late join, so a member must not arrive to find the match
    // already running. The countdown is *held*, not widened.
    const members = await buildParty(3);
    await queueParty(members);

    // Only the leader connects. The countdown is shorter than the wait below,
    // so a room that ignored the hold would already be running.
    const leaderRoom = await consumeSeat(members[0]!, members[0]!.seats.at(-1)!);
    openMatches.push(leaderRoom);
    await waitFor(() => (leaderRoom.state as Partial<MatchRoomState>).players !== undefined);
    await sleep(TEST_LOBBY_MS + 300);
    expect(leaderRoom.state.phase).toBe("countdown");

    // The other two arrive late and still land in the same match.
    const rest = await enterMatch(members.slice(1));
    expect(new Set([leaderRoom.roomId, ...rest.map((room) => room.roomId)]).size).toBe(1);
    await waitFor(() => leaderRoom.state.phase === "running", 15_000, "the match to start");
  }, 90_000);

  it("starts anyway once a promised seat's hold expires", async () => {
    // The hold is bounded, so one member who never arrives delays a match
    // rather than preventing it.
    const members = await buildParty(3);
    await queueParty(members);

    const leaderRoom = await consumeSeat(members[0]!, members[0]!.seats.at(-1)!);
    openMatches.push(leaderRoom);
    await waitFor(
      () => leaderRoom.state.phase === "running",
      TEST_GROUP_HOLD_MS + TEST_LOBBY_MS + 10_000,
      "the match to start without the absent members",
    );
    expect(leaderRoom.state.players.size).toBe(1);
  }, 90_000);

  it("queues without a member who dropped mid-queue, and never splits the rest", async () => {
    const members = await buildParty(3);
    const [leader, second, third] = members;

    // The third member's connection dies before the leader queues.
    await third!.room.leave(true);
    await waitFor(() => leader!.room.state.members.size === 2, 10_000, "the party to shrink");

    await queueParty([leader!, second!]);
    const rooms = await enterMatch([leader!, second!]);

    expect(new Set(rooms.map((room) => room.roomId)).size).toBe(1);
    expect(third!.seats).toHaveLength(0);
    await waitFor(() => rooms[0]!.state.players.size === 2, 10_000, "two players");
  }, 90_000);

  it("applies the ordinary disconnect policy to a party member mid-match", async () => {
    // D39 is not weakened by being in a party: the member stays in the world,
    // stationary and vulnerable, then their run is abandoned. Their teammates
    // keep playing.
    const members = await buildParty(3);
    await queueParty(members);
    const rooms = await enterMatch(members);
    await waitFor(() => rooms[0]!.state.phase === "running", 15_000, "the match to start");

    const droppedId = rooms[2]!.sessionId;
    await rooms[2]!.leave(false);

    await waitFor(
      () => rooms[0]!.state.players.get(droppedId)?.connected === false,
      10_000,
      "the drop to show as disconnected",
    );
    await waitFor(
      () => !rooms[0]!.state.players.has(droppedId),
      15_000,
      "the abandoned run to be removed",
    );
    expect(rooms[0]!.state.players.size).toBe(2);
  }, 90_000);

  it("counts an outstanding reservation as an occupied seat", async () => {
    // The capacity check reads Colyseus's own `_reservedSeats`, which is not a
    // public API. If a Colyseus upgrade renames it the room would silently
    // think it had eight free seats while holding three, and overcommit — so
    // the accessor is checked here rather than trusted.
    const members = await buildParty(3);
    await queueParty(members);

    const [cache] = await matchMaker.query({ name: MATCH_ROOM });
    expect(cache, "the queue created a match room").toBeDefined();
    // Three seats are held and nobody has connected: Colyseus counts them.
    expect(cache!.clients).toBe(3);
  }, 60_000);
});
