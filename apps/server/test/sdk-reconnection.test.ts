/**
 * `docs/DECISIONS.md` D54's prediction, made into a test (M6.12,
 * `docs/M6_ISSUES.md` §13; the decision is D64).
 *
 * D54 recorded, while investigating something else: `@colyseus/sdk` performs
 * automatic reconnection on its own timers — enabled by default, 15 retries with
 * exponential back-off — and declines only while a room has been up for less
 * than `minUptime` (5 s). It also recorded why our tests escaped it: no room
 * reached five seconds of uptime before its unconsented leave. It then said, in
 * as many words, that "a test that got slower would silently start
 * reconnecting".
 *
 * M6 is where that stops being hypothetical. A party room lives for whole
 * matches, and the queue tests hold match rooms open through a lobby, a hold,
 * and a run. So the escape is gone, and the policy is made explicit instead:
 * every helper in `party-helpers.ts` calls `withoutAutoReconnect`, and the
 * client's match connection disables the SDK's reconnection because it already
 * has an explicit one of its own (technical plan §34.1).
 *
 * These two tests are the evidence that the hazard is real and that the policy
 * answers it. The first reads the SDK's own defaults — not a constant of ours,
 * a third-party behavior our test policy depends on — and the second holds a
 * room past those defaults and drops a client that must stay dropped.
 */
import { MATCH_ROOM, type MatchRoomState } from "@carry-or-fall/protocol";
import { matchMaker } from "@colyseus/core";
import { Client } from "@colyseus/sdk";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createGameServer, type GameServerHandle } from "../src/server";
import {
  BUILD_VERSION,
  matchJoinOptions,
  silentLogger,
  sleep,
  waitFor,
  withoutAutoReconnect,
} from "./party-helpers";

/** Short, because this test is about what happens *after* the window lapses. */
const TEST_RECONNECT_MS = 1_000;

describe("the SDK's automatic reconnection (docs/DECISIONS.md D54, D64)", () => {
  let handle: GameServerHandle;
  let wsBaseUrl: string;

  beforeEach(async () => {
    handle = createGameServer({
      buildVersion: BUILD_VERSION,
      logger: silentLogger,
      allowedOrigins: ["http://localhost:5173"],
      match: { lobbyDurationMs: 200, reconnectWindowMs: TEST_RECONNECT_MS, seed: 76 },
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

  async function liveMatchRooms(): Promise<number> {
    return (await matchMaker.query({ name: MATCH_ROOM })).length;
  }

  it("is on by default, and starts declining to decline after five seconds", async () => {
    // The hazard, read off the installed package rather than remembered. If a
    // future SDK turns this off by default, or drops `minUptime`, the policy
    // below becomes unnecessary or insufficient — and this is where that shows
    // up, instead of as a flake somewhere else.
    const client = new Client(wsBaseUrl);
    const room = await client.joinOrCreate<MatchRoomState>(MATCH_ROOM, matchJoinOptions());
    try {
      expect(room.reconnection.enabled).toBe(true);
      expect(room.reconnection.minUptime).toBeGreaterThan(0);
      expect(room.reconnection.maxRetries).toBeGreaterThan(1);
    } finally {
      withoutAutoReconnect(room);
      await room.leave(true).catch(() => undefined);
    }
  }, 30_000);

  it("does not resurrect a client that was dropped past the uptime threshold", async () => {
    const client = new Client(wsBaseUrl);
    const room = withoutAutoReconnect(
      await client.joinOrCreate<MatchRoomState>(MATCH_ROOM, matchJoinOptions()),
    );
    await waitFor(() => (room.state as Partial<MatchRoomState>).players !== undefined);
    await waitFor(() => room.state.phase === "running", 10_000, "the match to start");
    expect(await liveMatchRooms()).toBe(1);

    // Past the SDK's `minUptime`, which is the whole point: before this line the
    // SDK would decline to reconnect on its own and the test would prove
    // nothing.
    await sleep(room.reconnection.minUptime + 500);

    // An *unconsented* drop — a closing tab, a dead network — which is the shape
    // that arms automatic reconnection.
    await room.leave(false);

    // The room legitimately outlives the drop by the server's reconnect window
    // (technical plan §34.1). What it must not do is come back because the SDK
    // quietly dialled again: a reconnected client keeps the room alive, so a
    // room count that never reaches zero *is* the observation.
    await waitFor(async () => (await liveMatchRooms()) === 0, 15_000, "the abandoned room to go");
    await sleep(1_000);
    expect(await liveMatchRooms()).toBe(0);
  }, 60_000);
});
