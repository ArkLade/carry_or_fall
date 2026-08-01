/**
 * Session durability: a server that hosts many matches in sequence must not
 * accumulate work.
 *
 * The browser suite runs thirty tests against **one** server process, and each
 * abandons its match by closing the browser rather than leaving politely. That
 * makes it a small soak test whether or not it was meant to be one, and
 * technical plan §38 M8 requires the server to stay stable under its target
 * test — so a room that keeps stepping after everyone has gone is a server
 * defect, not a test inconvenience. `docs/TEST_PLAN.md` §2.5 names exactly this
 * class: "rooms that fail to dispose", "disconnected clients retained in
 * memory", "growing projectile collections".
 *
 * These tests measure rather than assume. They create and abandon matches back
 * to back, then assert on the two numbers that matter: how many rooms are still
 * alive, and how long a simulation step takes late in the session compared with
 * the start.
 */
import { CONTENT_VERSION } from "@carry-or-fall/game-content";
import { MATCH_ROOM, type MatchRoomState, PROTOCOL_VERSION } from "@carry-or-fall/protocol";
import { matchMaker } from "@colyseus/core";
import { Client } from "@colyseus/sdk";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { Logger } from "../src/logger";
import { createGameServer, type GameServerHandle } from "../src/server";

const BUILD_VERSION = "0.0.0-test";

/** Short enough to keep the suite quick; long enough that a room really does start. */
const TEST_LOBBY_MS = 200;

/**
 * The reconnect window, deliberately short here. The production default is 15s
 * (technical plan §34.1's "short reconnect window"), and these tests are about
 * what happens *after* it lapses, not about the window itself.
 */
const TEST_RECONNECT_MS = 1_000;

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

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** How many match rooms the matchmaker currently knows about. */
async function liveMatchRooms(): Promise<number> {
  return (await matchMaker.query({ name: MATCH_ROOM })).length;
}

describe("match room session durability", () => {
  let handle: GameServerHandle;
  let wsBaseUrl: string;

  beforeEach(async () => {
    handle = createGameServer({
      buildVersion: BUILD_VERSION,
      logger: silentLogger,
      allowedOrigins: ["http://localhost:5173"],
      match: {
        lobbyDurationMs: TEST_LOBBY_MS,
        reconnectWindowMs: TEST_RECONNECT_MS,
        seed: 76,
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

  /** Join a match and wait until it is actually simulating. */
  async function joinRunningMatch(): Promise<{ leave: () => Promise<void> }> {
    const client = new Client(wsBaseUrl);
    const room = await client.joinOrCreate<MatchRoomState>(MATCH_ROOM, validJoin);
    await waitFor(() => (room.state as Partial<MatchRoomState>).players !== undefined);
    await waitFor(() => room.state.phase === "running");
    // `false` is an *unconsented* leave: the shape a closing browser tab makes,
    // which is how every browser test ends its match.
    return {
      leave: async () => {
        await room.leave(false);
      },
    };
  }

  it("disposes an abandoned match once its reconnect window lapses", async () => {
    const match = await joinRunningMatch();
    expect(await liveMatchRooms()).toBe(1);

    await match.leave();

    // The room legitimately outlives the disconnect by the reconnect window —
    // the player may come back (technical plan §34.1). What it must not do is
    // outlive it indefinitely.
    await waitFor(async () => (await liveMatchRooms()) === 0, 15_000);
    expect(await liveMatchRooms()).toBe(0);
  }, 30_000);

  it("does not accumulate rooms across a sequence of abandoned matches", async () => {
    // The browser suite's shape: match, abandon, match, abandon — against one
    // server process. If each abandoned room lingered, the count would climb
    // with every iteration and every one of them would still be stepping.
    const rounds = 6;
    const observed: number[] = [];

    for (let round = 0; round < rounds; round += 1) {
      const match = await joinRunningMatch();
      await match.leave();
      await waitFor(async () => (await liveMatchRooms()) === 0, 15_000);
      observed.push(await liveMatchRooms());
    }

    expect(observed).toEqual(Array.from({ length: rounds }, () => 0));
  }, 90_000);

  it("keeps simulation step timing flat from the first match to the last", async () => {
    // The measurement that matters for §38 M8: a server whose steps get slower
    // as matches accumulate fails its stability target, and the symptom in a
    // long browser run is a late test timing out at work an early test finished
    // comfortably.
    const measure = async (): Promise<number> => {
      const match = await joinRunningMatch();
      const started = performance.now();
      // Long enough to average over many 50 ms steps rather than catch one.
      await sleep(1_000);
      const elapsed = performance.now() - started;
      await match.leave();
      await waitFor(async () => (await liveMatchRooms()) === 0, 15_000);
      return elapsed;
    };

    const first = await measure();
    for (let round = 0; round < 4; round += 1) {
      const match = await joinRunningMatch();
      await match.leave();
      await waitFor(async () => (await liveMatchRooms()) === 0, 15_000);
    }
    const last = await measure();

    // Wall-clock over a fixed sleep is a blunt instrument, but it is the honest
    // one here: it captures event-loop contention from anything still running,
    // which is precisely the failure mode. A late window taking half again as
    // long as the first means something did not clean up.
    expect(last).toBeLessThan(first * 1.5);
  }, 90_000);
});
