import { matchMaker } from "@colyseus/core";
import { Client } from "@colyseus/sdk";
import {
  CLIENT_MESSAGE_TYPES,
  FOUNDATION_ROOM,
  type FoundationRoomState,
  PROTOCOL_VERSION,
} from "@carry-or-fall/protocol";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { Logger } from "../src/logger";
import { createGameServer, type GameServerHandle } from "../src/server";

const BUILD_VERSION = "0.0.0-test";

// The server logs verbosely; silence it so test output stays readable.
const silentLogger: Logger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
};

async function waitFor(
  predicate: () => boolean | Promise<boolean>,
  timeoutMs = 5000,
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

describe("foundation room integration", () => {
  let handle: GameServerHandle;
  let httpBaseUrl: string;
  let wsBaseUrl: string;

  beforeEach(async () => {
    handle = createGameServer({
      buildVersion: BUILD_VERSION,
      logger: silentLogger,
      allowedOrigins: ["http://localhost:5173"],
    });
    await handle.gameServer.listen(0);

    const address = handle.httpServer.address();
    if (address === null || typeof address === "string") {
      throw new Error("expected the server to be listening on a TCP port");
    }
    httpBaseUrl = `http://127.0.0.1:${String(address.port)}`;
    wsBaseUrl = `ws://127.0.0.1:${String(address.port)}`;
  });

  afterEach(async () => {
    await handle.gameServer.gracefullyShutdown(false);
  });

  it("serves a health endpoint reporting build and protocol versions", async () => {
    const response = await fetch(`${httpBaseUrl}/health`);
    expect(response.status).toBe(200);

    const body = (await response.json()) as Record<string, unknown>;
    expect(body).toMatchObject({
      status: "ok",
      buildVersion: BUILD_VERSION,
      protocolVersion: PROTOCOL_VERSION,
    });
    expect(typeof body["uptime"]).toBe("number");
  });

  it("accepts a valid client and exposes the authoritative state", async () => {
    const client = new Client(wsBaseUrl);
    const room = await client.joinOrCreate<FoundationRoomState>(FOUNDATION_ROOM);

    await waitFor(() => room.state.connectedPlayers === 1);
    expect(room.state.serverBuildVersion).toBe(BUILD_VERSION);

    await room.leave(true);
  });

  it("increments and decrements the player count as clients join and leave", async () => {
    const clientA = new Client(wsBaseUrl);
    const roomA = await clientA.joinOrCreate<FoundationRoomState>(FOUNDATION_ROOM);
    await waitFor(() => roomA.state.connectedPlayers === 1);

    const clientB = new Client(wsBaseUrl);
    const roomB = await clientB.joinOrCreate<FoundationRoomState>(FOUNDATION_ROOM);
    await waitFor(() => roomA.state.connectedPlayers === 2);
    expect(roomB.roomId).toBe(roomA.roomId);

    await roomB.leave(true);
    await waitFor(() => roomA.state.connectedPlayers === 1);

    await roomA.leave(true);
  });

  it("disposes the room once the last client leaves", async () => {
    const client = new Client(wsBaseUrl);
    const room = await client.joinOrCreate<FoundationRoomState>(FOUNDATION_ROOM);
    await waitFor(() => room.state.connectedPlayers === 1);
    const { roomId } = room;

    await room.leave(true);

    await waitFor(async () => (await matchMaker.query({ roomId })).length === 0);
    expect(await matchMaker.query({ roomId })).toHaveLength(0);
  });

  it("rejects a client whose handshake fails validation", async () => {
    const client = new Client(wsBaseUrl);
    const room = await client.joinOrCreate<FoundationRoomState>(FOUNDATION_ROOM);
    await waitFor(() => room.state.connectedPlayers === 1);

    const left = new Promise<number>((resolve) => {
      room.onLeave((code) => resolve(code));
    });

    // protocolVersion must be a positive integer; a string must be rejected at
    // the server boundary rather than trusted.
    room.send(CLIENT_MESSAGE_TYPES.hello, {
      protocolVersion: "not-a-number",
      buildVersion: BUILD_VERSION,
    });

    expect(await left).toBeGreaterThanOrEqual(4000);
  });
});
