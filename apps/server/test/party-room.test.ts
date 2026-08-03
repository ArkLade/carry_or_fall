/**
 * The party room itself (M6.3, `docs/M6_ISSUES.md` §11.3).
 *
 * Creation, joining by code, the three-player cap (concept §15.3), leadership
 * when the leader leaves, and every way a join code can fail: malformed,
 * unknown, expired, replaced, absent, and chosen by the client. The four failure
 * modes are asserted to be **indistinguishable from the outside**, because
 * telling them apart is what would help somebody guessing codes
 * (`docs/DECISIONS.md` D56).
 */
import {
  MAX_PARTY_SIZE,
  PARTY_CODE_ALPHABET,
  PARTY_CODE_LENGTH,
  PARTY_ROOM,
  type PartyRoomState,
} from "@carry-or-fall/protocol";
import { Client } from "@colyseus/sdk";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createGameServer, type GameServerHandle } from "../src/server";
import {
  createParty,
  joinParty,
  leaveQuietly,
  partyJoinOptions,
  silentLogger,
  BUILD_VERSION,
  waitFor,
  withoutAutoReconnect,
  type PartyClient,
} from "./party-helpers";

/** Long enough that no test hits it by accident; short enough to expire on purpose. */
const TEST_CODE_TTL_MS = 60_000;

describe("party room", () => {
  let handle: GameServerHandle;
  let wsBaseUrl: string;
  const open: PartyClient[] = [];

  async function startServer(joinCodeTtlMs = TEST_CODE_TTL_MS): Promise<void> {
    handle = createGameServer({
      buildVersion: BUILD_VERSION,
      logger: silentLogger,
      allowedOrigins: ["http://localhost:5173"],
      match: { lobbyDurationMs: 200, seed: 76 },
      party: { joinCodeTtlMs, reconnectWindowMs: 1_000 },
    });
    await handle.gameServer.listen(0);
    const address = handle.httpServer.address();
    if (address === null || typeof address === "string") {
      throw new Error("expected the server to be listening on a TCP port");
    }
    wsBaseUrl = `ws://127.0.0.1:${String(address.port)}`;
  }

  beforeEach(async () => {
    await startServer();
  });

  afterEach(async () => {
    for (const party of open.splice(0)) {
      await leaveQuietly(party.room);
    }
    await handle.gameServer.gracefullyShutdown(false);
  });

  async function party(): Promise<PartyClient> {
    const created = await createParty(wsBaseUrl);
    open.push(created);
    return created;
  }

  async function join(code: string): Promise<PartyClient> {
    const joined = await joinParty(wsBaseUrl, code);
    open.push(joined);
    return joined;
  }

  it("mints a well-formed code the creator can read, and makes them the leader", async () => {
    const leader = await party();

    expect(leader.room.state.joinCode).toHaveLength(PARTY_CODE_LENGTH);
    for (const character of leader.room.state.joinCode) {
      expect(PARTY_CODE_ALPHABET).toContain(character);
    }
    expect(leader.room.state.leaderSessionId).toBe(leader.room.sessionId);
    expect(leader.room.state.status).toBe("forming");
  });

  it("two different parties get two different codes", async () => {
    const first = await party();
    const second = await party();
    expect(second.room.state.joinCode).not.toBe(first.room.state.joinCode);
  });

  it("routes a member holding the code into that exact party, not another", async () => {
    const other = await party();
    const leader = await party();

    const member = await join(leader.room.state.joinCode);

    expect(member.room.roomId).toBe(leader.room.roomId);
    expect(member.room.roomId).not.toBe(other.room.roomId);
    await waitFor(() => leader.room.state.members.size === 2);
    expect(member.room.state.joinCode).toBe(leader.room.state.joinCode);
  });

  it("fills to three and refuses a fourth holder of a valid code", async () => {
    const leader = await party();
    const code = leader.room.state.joinCode;
    await join(code);
    await join(code);
    await waitFor(() => leader.room.state.members.size === MAX_PARTY_SIZE);

    // A code is a party address, not a single-use ticket: reuse is bounded by
    // the cap (concept §15.3), which is what "already used" actually means here.
    await expect(joinParty(wsBaseUrl, code)).rejects.toThrow();
    expect(leader.room.state.members.size).toBe(MAX_PARTY_SIZE);
  });

  it("refuses a malformed code at the boundary, before matchmaking sees it", async () => {
    await party();
    const client = new Client(wsBaseUrl);
    for (const bad of ["", "abc", "iiiiiiii", "ABCDEFGHI"]) {
      await expect(
        client.join<PartyRoomState>(PARTY_ROOM, partyJoinOptions(bad)),
      ).rejects.toThrow();
    }
  });

  it("refuses a join whose options omit joinCode, which would otherwise match any party", async () => {
    // The hole this closes: Colyseus builds its matchmaking filter from the
    // properties a client actually sent, so an absent `joinCode` is an empty
    // filter — and an empty filter matches a stranger's party.
    const stranger = await party();
    const client = new Client(wsBaseUrl);
    const { joinCode: _omitted, ...withoutCode } = partyJoinOptions(null);

    await expect(client.join<PartyRoomState>(PARTY_ROOM, withoutCode)).rejects.toThrow();
    expect(stranger.room.state.members.size).toBe(1);
  });

  it("refuses an unknown code, and says the same thing as a full or expired one", async () => {
    const leader = await party();
    const code = leader.room.state.joinCode;
    // Same length, same alphabet, not any party's code.
    const unknown = code
      .split("")
      .map((character) =>
        character === PARTY_CODE_ALPHABET[0] ? PARTY_CODE_ALPHABET[1]! : PARTY_CODE_ALPHABET[0]!,
      )
      .join("");

    await expect(joinParty(wsBaseUrl, unknown)).rejects.toThrow();
    expect(leader.room.state.members.size).toBe(1);
  });

  it("delivers the refusal message to the client rather than an internal error", async () => {
    // The refusal is only useful if the player can read it, and getting that
    // right is not free: a party join is refused during **matchmaking**, which
    // Colyseus turns into an HTTP status. Throwing a 4000-range WebSocket close
    // code there makes Colyseus's router throw `init["status"] must be in the
    // range of 200 to 599` while building the response, and the player sees an
    // unrelated internal error instead of "ask your friend for a fresh one".
    // Caught exactly that way; this is the regression test.
    const leader = await party();
    const unknown = leader.room.state.joinCode
      .split("")
      .map((character) =>
        character === PARTY_CODE_ALPHABET[0] ? PARTY_CODE_ALPHABET[1]! : PARTY_CODE_ALPHABET[0]!,
      )
      .join("");

    await expect(joinParty(wsBaseUrl, unknown)).rejects.toThrow(/party code|no rooms found/i);
  });

  it("is not enumerable: the SDK exposes no way to list rooms or read their metadata", async () => {
    // The join code lives in matchmaking metadata so Colyseus can route a member
    // to the right party. That is only safe because there is nowhere to read it
    // from: `@colyseus/core@0.17.45` exposes one matchmaking route,
    // `POST /matchmake/:method/:roomName`, and no room-listing route at all
    // (`docs/DECISIONS.md` D56). Asserted against the installed package rather
    // than remembered, so an upgrade that adds a listing endpoint fails here.
    const leader = await party();
    const client = new Client(wsBaseUrl) as unknown as Record<string, unknown>;
    expect(typeof client["getAvailableRooms"]).toBe("undefined");

    const httpBase = wsBaseUrl.replace("ws://", "http://");
    for (const path of [`/matchmake/${PARTY_ROOM}`, "/matchmake", `/${PARTY_ROOM}`, "/rooms"]) {
      const response = await fetch(`${httpBase}${path}`).catch(() => null);
      const body = response === null ? "" : await response.text().catch(() => "");
      expect(body, `${path} disclosed a join code`).not.toContain(leader.room.state.joinCode);
    }
  });

  it("refuses an expired code while the party lives on, and a refreshed one works", async () => {
    await handle.gameServer.gracefullyShutdown(false);
    await startServer(300);

    const leader = await party();
    const expiring = leader.room.state.joinCode;
    await new Promise<void>((resolve) => setTimeout(resolve, 500));

    await expect(joinParty(wsBaseUrl, expiring)).rejects.toThrow();
    // The party did not end with its code — that is the whole point of a
    // bounded lifetime being usable (`docs/DECISIONS.md` D56).
    expect(leader.room.state.members.size).toBe(1);

    leader.room.send("refresh_join_code", {});
    await waitFor(() => leader.room.state.joinCode !== expiring);
    const member = await join(leader.room.state.joinCode);
    expect(member.room.roomId).toBe(leader.room.roomId);
  }, 30_000);

  it("invalidates the previous code the instant a new one is minted", async () => {
    const leader = await party();
    const original = leader.room.state.joinCode;

    leader.room.send("refresh_join_code", {});
    await waitFor(() => leader.room.state.joinCode !== original);

    await expect(joinParty(wsBaseUrl, original)).rejects.toThrow();
    expect(leader.room.state.members.size).toBe(1);
  });

  it("does not let a client choose its own code", async () => {
    // A client that could pick a code could squat memorable ones, or pick one
    // an accomplice already knows. `create` accepts the option; the server
    // ignores it and mints its own.
    const chosen = PARTY_CODE_ALPHABET.slice(-PARTY_CODE_LENGTH);
    const client = new Client(wsBaseUrl);
    const room = withoutAutoReconnect(
      await client.create<PartyRoomState>(PARTY_ROOM, partyJoinOptions(null, { joinCode: null })),
    );
    await waitFor(() => room.state.joinCode !== undefined && room.state.joinCode.length > 0);
    expect(room.state.joinCode).not.toBe(chosen);
    await room.leave(true);
  });

  it("passes leadership to the earliest-joined remaining member when the leader leaves", async () => {
    const leader = await party();
    const second = await join(leader.room.state.joinCode);
    const third = await join(leader.room.state.joinCode);
    await waitFor(() => third.room.state.members.size === 3);

    await leader.room.leave(true);

    await waitFor(() => second.room.state.leaderSessionId === second.room.sessionId, 10_000);
    expect(second.room.state.members.size).toBe(2);
    expect(second.room.state.members.get(second.room.sessionId)?.isLeader).toBe(true);
    expect(third.room.state.members.get(third.room.sessionId)?.isLeader).toBe(false);
  });

  it("ignores a queue request from a member who is not the leader", async () => {
    const leader = await party();
    const member = await join(leader.room.state.joinCode);
    await waitFor(() => leader.room.state.members.size === 2);

    member.room.send("queue_match", {});
    await waitFor(() => member.errors.length > 0, 10_000, "a party error");

    expect(member.errors[0]?.code).toBe("not_leader");
    expect(leader.room.state.status).toBe("forming");
    expect(member.seats).toHaveLength(0);
  });

  it("never puts an access token or an account id into synchronized state", async () => {
    // Being in someone's party is not a licence to read their account
    // (`docs/M6_ISSUES.md` §1.6). The state a member sees about another member
    // is a name and a connection light.
    const leader = await party();
    const member = await join(leader.room.state.joinCode);
    await waitFor(() => member.room.state.members.size === 2);

    const serialized = JSON.stringify(
      [...member.room.state.members.values()].map((entry) => ({ ...entry })),
    );
    expect(serialized).not.toContain("accessToken");
    expect(serialized).not.toContain("userId");
    expect(serialized).not.toContain("balances");
    expect(serialized).not.toContain("unlock");
    const [first] = [...member.room.state.members.values()];
    expect(Object.keys({ ...first }).sort()).toEqual([
      "connected",
      "displayName",
      "isLeader",
      "sessionId",
    ]);
  });

  it("disposes the party, and its code, when the last member leaves", async () => {
    const leader = await createParty(wsBaseUrl);
    const code = leader.room.state.joinCode;
    await leader.room.leave(true);

    await waitFor(async () => {
      try {
        const joined = await joinParty(wsBaseUrl, code);
        await joined.room.leave(true);
        return false;
      } catch {
        return true;
      }
    }, 10_000);
  });
});
