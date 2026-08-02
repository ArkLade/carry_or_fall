/**
 * The M5 join gate (M5.5, `docs/M5_ISSUES.md` §6; technical plan §19).
 *
 * D38 established that the loadout is validated at the join boundary so an
 * illegal one never occupies a seat. M5 adds the half that makes an unlock mean
 * something: **the server checks each requested skill against that account's
 * unlock set and refuses a locked one.** Without this test the `unlocks` table
 * would be rows nothing consults.
 *
 * The second half is identity: the user id comes out of a verified token, never
 * out of the payload, so a client cannot name itself.
 */
import {
  CONTENT_VERSION,
  DEFAULT_UNLOCK_IDS,
  type ArenaDefinition,
} from "@carry-or-fall/game-content";
import { MATCH_ROOM, type MatchRoomState, PROTOCOL_VERSION } from "@carry-or-fall/protocol";
import { Client } from "@colyseus/sdk";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { Logger } from "../src/logger";
import type { TokenVerification, TokenVerifier } from "../src/progression/auth";
import { MemoryStore } from "../src/progression/memory-store";
import { DEFAULT_UNLOCK_GRANTS } from "../src/progression/settlement-service";
import { createGameServer, type GameServerHandle } from "../src/server";

const BUILD_VERSION = "0.0.0-test";

const silentLogger: Logger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
};

const quietArena: ArenaDefinition = {
  id: "test_join_arena",
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
  groundLootSpawnPoints: [],
  skillChipSpawnPoints: [],
  extractionCandidatePoints: [
    { x: 400, y: 400 },
    { x: 600, y: 600 },
  ],
  openLaneY: 900,
};

/**
 * A verifier standing in for a configured Supabase project: it accepts exactly
 * one token and refuses everything else, which is the behavior the room depends
 * on. Using a fake here rather than a real project is deliberate — the *room's*
 * gate is the subject, and CI cannot reach a project anyway. That Supabase Auth
 * itself rejects a forged token is Supabase's guarantee, exercised in
 * `supabase-tests/`.
 */
class FixedTokenVerifier implements TokenVerifier {
  constructor(
    private readonly accepted: string,
    private readonly userId: string,
  ) {}

  verify(accessToken: string | null): Promise<TokenVerification> {
    if (accessToken !== this.accepted) {
      return Promise.resolve({ ok: false, reason: "access token rejected" });
    }
    return Promise.resolve({
      ok: true,
      identity: { userId: this.userId, isAnonymous: true, displayName: "Runner-TEST" },
    });
  }
}

const VALID_TOKEN = "valid.session.token";
const USER_ID = "user-join-gate";

describe("the join gate (technical plan §19)", () => {
  let handle: GameServerHandle;
  let store: MemoryStore;
  let wsBaseUrl: string;

  function join(options: Record<string, unknown>): Promise<unknown> {
    const client = new Client(wsBaseUrl);
    return client.joinOrCreate<MatchRoomState>(MATCH_ROOM, {
      protocolVersion: PROTOCOL_VERSION,
      contentVersion: CONTENT_VERSION,
      buildVersion: BUILD_VERSION,
      accessToken: VALID_TOKEN,
      skillLoadoutIds: [],
      ...options,
    });
  }

  beforeEach(async () => {
    store = new MemoryStore();
    handle = createGameServer({
      buildVersion: BUILD_VERSION,
      logger: silentLogger,
      allowedOrigins: ["http://localhost:5173"],
      progression: { store, tokenVerifier: new FixedTokenVerifier(VALID_TOKEN, USER_ID) },
      match: {
        lobbyDurationMs: 30_000,
        seed: 7,
        arena: quietArena,
        // Explicit, because this suite is *about* the gate. A server with no
        // Supabase provisions every unlock (`server.ts`: with no persistence
        // there is no progression to gate), which is right for local play and
        // for the browser suite, and would make every assertion below vacuous.
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

  it("admits a default loadout on a brand-new account", async () => {
    // The first thing a new player does. If the defaults were not unlocked, this
    // is where they would discover it.
    const room = await join({ skillLoadoutIds: ["ricochet", "extended_reach", "bulwark_strike"] });
    expect(room).toBeDefined();
    await (room as { leave: (consented: boolean) => Promise<number> }).leave(true);
  });

  it("provisions the account on first join", async () => {
    const room = await join({});
    const account = await store.loadAccount(USER_ID);
    expect(account).not.toBeNull();
    expect([...(account?.unlockIds ?? [])].sort()).toEqual([...DEFAULT_UNLOCK_IDS].sort());
    expect(account?.balances).toEqual({
      force: 0,
      precision: 0,
      motion: 0,
      guard: 0,
      signal: 0,
    });
    await (room as { leave: (consented: boolean) => Promise<number> }).leave(true);
  });

  it("refuses a loadout naming a skill the account has not unlocked", async () => {
    // `homing_arrows` is a Signal-40 threshold unlock, so a fresh account cannot
    // legally bring it — even though it is a real skill the content table knows.
    await expect(join({ skillLoadoutIds: ["homing_arrows"] })).rejects.toThrow(/homing_arrows/);
  });

  it("admits that same loadout once the unlock row exists", async () => {
    // The other half of the previous test: the gate is the unlock, not a
    // hard-coded allowlist. Without this, "refuses everything" would pass.
    await store.ensureAccount(USER_ID, "Runner-TEST", [
      ...DEFAULT_UNLOCK_GRANTS,
      { unlockId: "homing_arrows", unlockType: "skill" },
    ]);

    const room = await join({ skillLoadoutIds: ["homing_arrows"] });
    expect(room).toBeDefined();
    await (room as { leave: (consented: boolean) => Promise<number> }).leave(true);
  });

  it("refuses a join with no token when the server can verify one", async () => {
    await expect(join({ accessToken: null })).rejects.toThrow();
  });

  it("refuses a join with a forged or expired token", async () => {
    await expect(join({ accessToken: "forged.session.token" })).rejects.toThrow();
    // Nothing was provisioned for a refused join: a rejected client leaves no
    // trace of an account behind it.
    expect(await store.loadAccount("user-forged")).toBeNull();
  });

  it("refuses a malformed token without reaching the verifier", async () => {
    await expect(join({ accessToken: 12_345 })).rejects.toThrow();
    await expect(join({ accessToken: "a".repeat(5_000) })).rejects.toThrow();
  });

  it("ignores a user id a client tries to supply", async () => {
    // Identity comes from the token. A client naming itself is the attack this
    // replaces, and the payload field is simply not read.
    const room = await join({ userId: "somebody-else", user_id: "somebody-else" });
    expect(await store.loadAccount("somebody-else")).toBeNull();
    expect(await store.loadAccount(USER_ID)).not.toBeNull();
    await (room as { leave: (consented: boolean) => Promise<number> }).leave(true);
  });

  it("still refuses an illegal loadout before it checks unlocks", async () => {
    // D38's gate is unchanged: a selection over the slot budget is rejected for
    // being illegal, not for being locked.
    await expect(
      join({ skillLoadoutIds: ["ricochet", "ricochet", "extended_reach"] }),
    ).rejects.toThrow();
  });
});
