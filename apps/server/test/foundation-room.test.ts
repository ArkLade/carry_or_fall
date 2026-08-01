import { CONTENT_VERSION } from "@carry-or-fall/game-content";
import { matchMaker } from "@colyseus/core";
import { Client } from "@colyseus/sdk";
import {
  FOUNDATION_ROOM,
  type FoundationRoomState,
  HEALTH_PATH,
  MATCH_ROOM,
  INCOMPATIBLE_CLIENT_MESSAGE,
  PROTOCOL_MISMATCH_CODE,
  PROTOCOL_VERSION,
  validateHealthResponse,
} from "@carry-or-fall/protocol";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { Logger } from "../src/logger";
import { createGameServer, type GameServerHandle } from "../src/server";

const BUILD_VERSION = "0.0.0-test";
const CLIENT_ORIGIN = "http://localhost:5173";

// The version handshake a compatible client supplies as Colyseus join options.
// `contentVersion` became required in protocol version 2 (`docs/DECISIONS.md` D34).
const validHandshake = {
  protocolVersion: PROTOCOL_VERSION,
  contentVersion: CONTENT_VERSION,
  buildVersion: BUILD_VERSION,
};

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
      allowedOrigins: [CLIENT_ORIGIN],
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

  it("serves a health endpoint with CORS for an allowed cross-origin request", async () => {
    // The browser client runs on a different origin than the server, so the
    // health response must carry an Access-Control-Allow-Origin the browser
    // accepts. Simulate that by sending the client's Origin header.
    const response = await fetch(`${httpBaseUrl}${HEALTH_PATH}`, {
      headers: { Origin: CLIENT_ORIGIN },
    });
    expect(response.status).toBe(200);
    expect(response.headers.get("access-control-allow-origin")).toBe(CLIENT_ORIGIN);

    const result = validateHealthResponse(await response.json());
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toMatchObject({
        status: "ok",
        buildVersion: BUILD_VERSION,
        protocolVersion: PROTOCOL_VERSION,
      });
      expect(typeof result.value.uptime).toBe("number");
    }
  });

  it("does not send CORS headers for a disallowed origin", async () => {
    // Never reflect an arbitrary origin (technical plan §20.3): a request from an
    // origin outside the allowlist gets a healthy body but no CORS grant.
    const response = await fetch(`${httpBaseUrl}${HEALTH_PATH}`, {
      headers: { Origin: "http://evil.example" },
    });
    expect(response.status).toBe(200);
    expect(response.headers.get("access-control-allow-origin")).toBeNull();
  });

  it("accepts a compatible client and exposes the authoritative state", async () => {
    const client = new Client(wsBaseUrl);
    const room = await client.joinOrCreate<FoundationRoomState>(FOUNDATION_ROOM, validHandshake);

    await waitFor(() => room.state.connectedPlayers === 1);
    expect(room.state.serverBuildVersion).toBe(BUILD_VERSION);

    await room.leave(true);
  });

  it("increments and decrements the player count as clients join and leave", async () => {
    const clientA = new Client(wsBaseUrl);
    const roomA = await clientA.joinOrCreate<FoundationRoomState>(FOUNDATION_ROOM, validHandshake);
    await waitFor(() => roomA.state.connectedPlayers === 1);

    const clientB = new Client(wsBaseUrl);
    const roomB = await clientB.joinOrCreate<FoundationRoomState>(FOUNDATION_ROOM, validHandshake);
    await waitFor(() => roomA.state.connectedPlayers === 2);
    expect(roomB.roomId).toBe(roomA.roomId);

    await roomB.leave(true);
    await waitFor(() => roomA.state.connectedPlayers === 1);

    await roomA.leave(true);
  });

  it("disposes the room once the last client leaves", async () => {
    const client = new Client(wsBaseUrl);
    const room = await client.joinOrCreate<FoundationRoomState>(FOUNDATION_ROOM, validHandshake);
    await waitFor(() => room.state.connectedPlayers === 1);
    const { roomId } = room;

    await room.leave(true);

    await waitFor(async () => (await matchMaker.query({ roomId })).length === 0);
    expect(await matchMaker.query({ roomId })).toHaveLength(0);
  });

  it("refuses a client with an incompatible protocol version at join", async () => {
    const client = new Client(wsBaseUrl);

    // A newer/older protocol must be refused at the join boundary — never
    // accepted and later desynced — and must carry the refresh/update message.
    await expect(
      client.joinOrCreate(FOUNDATION_ROOM, {
        ...validHandshake,
        protocolVersion: PROTOCOL_VERSION + 1,
      }),
    ).rejects.toMatchObject({
      message: INCOMPATIBLE_CLIENT_MESSAGE,
      code: PROTOCOL_MISMATCH_CODE,
    });

    // The rejected client never occupied a seat, so no room lingers.
    await waitFor(async () => (await matchMaker.query({})).length === 0);
  });

  it("refuses a client whose handshake is malformed at join", async () => {
    const client = new Client(wsBaseUrl);

    await expect(
      client.joinOrCreate(FOUNDATION_ROOM, { protocolVersion: "not-a-number" }),
    ).rejects.toMatchObject({
      message: INCOMPATIBLE_CLIENT_MESSAGE,
      code: PROTOCOL_MISMATCH_CODE,
    });
  });

  it("refuses a client whose content version is incompatible (docs/DECISIONS.md D34)", async () => {
    const client = new Client(wsBaseUrl);

    await expect(
      client.joinOrCreate(FOUNDATION_ROOM, {
        ...validHandshake,
        contentVersion: CONTENT_VERSION + 1,
      }),
    ).rejects.toMatchObject({
      message: INCOMPATIBLE_CLIENT_MESSAGE,
      code: PROTOCOL_MISMATCH_CODE,
    });
  });

  it("refuses a pre-M4 client, which sends no content version at all", async () => {
    // The exact shape a browser tab loaded before this milestone would send.
    // It is stopped at the join boundary rather than admitted and desynced.
    const client = new Client(wsBaseUrl);

    await expect(
      client.joinOrCreate(FOUNDATION_ROOM, {
        protocolVersion: PROTOCOL_VERSION,
        buildVersion: BUILD_VERSION,
      }),
    ).rejects.toMatchObject({
      message: INCOMPATIBLE_CLIENT_MESSAGE,
      code: PROTOCOL_MISMATCH_CODE,
    });
  });

  it("keeps the probe room free of gameplay: joining it starts no match", async () => {
    // The reason this room survived M4 (`docs/DECISIONS.md` D40): it proves the
    // socket path works without consuming a match seat or starting a countdown.
    const client = new Client(wsBaseUrl);
    const room = await client.joinOrCreate<FoundationRoomState>(FOUNDATION_ROOM, validHandshake);
    await waitFor(() => room.state.connectedPlayers === 1);

    expect(await matchMaker.query({ name: MATCH_ROOM })).toHaveLength(0);

    await room.leave(true);
  });
});
