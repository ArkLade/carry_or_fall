/**
 * Assembles the Colyseus server. Split from the process bootstrap (`index.ts`)
 * so integration tests can construct a server, listen on an ephemeral port, and
 * shut it down without going through signal handling or `process.exit`.
 */
import http from "node:http";

import { Server } from "@colyseus/core";
import { WebSocketTransport } from "@colyseus/ws-transport";
import { HEALTH_PATH, type HealthResponse, PROTOCOL_VERSION } from "@carry-or-fall/protocol";

import { assertPersistenceSelected } from "./config/env";
import type { Logger } from "./logger";
import { MatchQueue } from "./party/match-queue";
import { LocalTokenVerifier, SupabaseTokenVerifier, type TokenVerifier } from "./progression/auth";
import { MemoryStore } from "./progression/memory-store";
import {
  ALL_UNLOCK_GRANTS,
  DEFAULT_UNLOCK_GRANTS,
  SettlementService,
} from "./progression/settlement-service";
import type { ProgressionStore } from "./progression/store";
import { SupabaseStore } from "./progression/supabase-store";
import { defineFoundationRoom } from "./rooms/FoundationRoom";
import { defineMatchRoom, type MatchRoomTuning } from "./rooms/MatchRoom";
import { definePartyRoom, type PartyRoomTuning } from "./rooms/PartyRoom";

const DEFAULT_MAX_CLIENTS = 64;

export interface GameServerDeps {
  readonly buildVersion: string;
  readonly logger: Logger;
  readonly allowedOrigins: readonly string[];
  /**
   * Permanent account storage (M5). Optional so an integration test can supply
   * a `MemoryStore` it also holds a reference to — which is how the adversarial
   * tests inject a database failure. When omitted, a fresh `MemoryStore` is
   * created, so a server with no Supabase configuration still boots and plays
   * (`docs/DECISIONS.md` D46).
   */
  readonly progression?: {
    readonly store: ProgressionStore;
    readonly tokenVerifier?: TokenVerifier;
    /** Overridable so a test does not sit through real retry back-off. */
    readonly settlement?: SettlementService;
  };
  /** Per-room client cap for the connection-only probe room. Overridable in tests. */
  readonly maxClients?: number;
  /**
   * Match-room timings and seed. Every field is optional and defaults to the
   * real values; integration tests override them so a suite does not sit
   * through a real 8-second lobby or a 12-minute match (M4.3). The match room's
   * own client cap is fixed at eight (technical plan §8.1) and is deliberately
   * not configurable.
   */
  readonly match?: MatchRoomTuning;
  /**
   * Party-room timings (M6). Optional and defaulting to the real values;
   * integration tests shorten the join-code lifetime so an expiry can be tested
   * without waiting ten real minutes. The party's size cap is fixed at three
   * (concept §15.3) and is deliberately not configurable.
   */
  readonly party?: PartyRoomTuning;
}

export interface GameServerHandle {
  readonly gameServer: Server;
  /** The HTTP server the transport is bound to; exposed so tests can read the bound port. */
  readonly httpServer: http.Server;
  /** The progression store this server is running on; closed at shutdown. */
  readonly store: ProgressionStore;
}

/**
 * Build (but do not start) the game server. Owns its own HTTP server so the
 * `/health` route and the WebSocket transport share one port, and so callers
 * can read the bound address after `listen()`.
 */
export function createGameServer(deps: GameServerDeps): GameServerHandle {
  const { buildVersion, logger, allowedOrigins } = deps;

  const store = deps.progression?.store ?? new MemoryStore();
  const settlement = deps.progression?.settlement ?? new SettlementService(store, logger);
  // With a real project, identity is whatever Supabase Auth vouches for. Without
  // one there is nothing to verify a token *against*, so the local verifier
  // mints a per-join identity instead — unreachable in production, where a
  // server with no Supabase configuration refuses to start (`config/env.ts`).
  //
  // The store is what decides, rather than a separate "persistent" flag, so
  // there is only one source of the truth "can this process reach Supabase".
  const persistent = store instanceof SupabaseStore;
  // The two behaviors below — minting local identities (D45) and provisioning
  // every unlock (D49) — are chosen right here, from `persistent`. `index.ts`
  // already refuses to start a production process without Supabase, and this is
  // the same invariant asserted at the seam where the consequence is decided:
  // `createGameServer` is a public entry point (every integration test builds
  // one, and so would any future embedding), and an invariant enforced only in
  // the process bootstrap is one a second entry point silently escapes.
  assertPersistenceSelected(process.env["NODE_ENV"], persistent);

  const tokenVerifier: TokenVerifier =
    deps.progression?.tokenVerifier ??
    (persistent ? new SupabaseTokenVerifier(store.authClient) : new LocalTokenVerifier());

  // What a new account starts with, decided by the same fact.
  //
  // **With no persistence there is no progression**, so a gate on accumulated
  // points has nothing to gate: nothing accumulates across runs, and five of the
  // ten skills would be permanently unreachable in local play and in the browser
  // suite rather than merely un-earned. "No accounts here" therefore means "no
  // entitlements here", and every unlock is provisioned.
  //
  // The gate itself is untouched — `onAuth` still refuses anything the account
  // does not hold. This changes what the set starts as, and it cannot apply to a
  // deployment, because production without Supabase refuses to start
  // (`config/env.ts`).
  const unlockGrants = persistent ? DEFAULT_UNLOCK_GRANTS : ALL_UNLOCK_GRANTS;

  const httpServer = http.createServer();
  const transport = new WebSocketTransport({ server: httpServer });

  const gameServer = new Server({
    transport,
    greet: false,
    // We register our own signal handlers in index.ts so shutdown is logged;
    // disable Colyseus's built-in handlers to avoid double-handling.
    gracefullyShutdown: false,
    // Custom health endpoint. Colyseus's built-in /__healthcheck returns a bare
    // "OK"; this one also reports the build and protocol versions for diagnostics
    // and, crucially, is reachable cross-origin by the browser client (which runs
    // on a different origin than the server). Registering via the `express`
    // option lets Colyseus's router fall through to it for unmatched routes,
    // avoiding a competing HTTP request listener.
    express: (app) => {
      app.get(HEALTH_PATH, (req, res) => {
        // Colyseus's router reflects any request Origin by default (its default
        // Access-Control-Allow-Origin is `*`/reflected). Enforce our allowlist on
        // this endpoint instead: reflect only a configured origin so the browser
        // client on the Vite dev origin can read this cross-origin response, and
        // strip the grant for any other origin — never a wildcard (technical
        // plan §20.3).
        res.setHeader("Vary", "Origin");
        const origin = req.headers.origin;
        if (typeof origin === "string" && allowedOrigins.includes(origin)) {
          res.setHeader("Access-Control-Allow-Origin", origin);
        } else {
          res.removeHeader("Access-Control-Allow-Origin");
        }
        const body: HealthResponse = {
          status: "ok",
          buildVersion,
          protocolVersion: PROTOCOL_VERSION,
          uptime: process.uptime(),
        };
        res.json(body);
      });
    },
  });

  defineFoundationRoom(gameServer, {
    buildVersion,
    logger,
    maxClients: deps.maxClients ?? DEFAULT_MAX_CLIENTS,
  });

  // One room per match (docs/DECISIONS.md D7), alongside the connection-only
  // probe room above (D40).
  defineMatchRoom(gameServer, {
    buildVersion,
    logger,
    store,
    settlement,
    tokenVerifier,
    unlockGrants,
    ...deps.match,
  });

  // The party room (M6) and the queue it hands parties to. The queue is
  // constructed here, once, because it serializes every allocation in this
  // process — two queues would be two chains and no serialization at all
  // (`docs/DECISIONS.md` D55).
  definePartyRoom(gameServer, {
    logger,
    store,
    tokenVerifier,
    unlockGrants,
    queue: new MatchQueue({ logger }),
    ...deps.party,
  });

  return { gameServer, httpServer, store };
}
