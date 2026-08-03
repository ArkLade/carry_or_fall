/**
 * The authoritative match room (M4.3, `docs/M4_ISSUES.md`). One room is one
 * match (`docs/DECISIONS.md` D7), holding two to eight players (technical plan
 * §8.1).
 *
 * This is where the simulation lives now. `packages/simulation-core` has been a
 * headless fixed-50 ms-step loop since M1 specifically so it could move behind a
 * server room at this milestone, and this room is the host it moved to: it
 * stores each player's latest validated input, advances the world by exactly one
 * fixed step per tick (technical plan §9.3), publishes the public result into
 * synchronized state, and sends each player their own private state. The client
 * no longer steps anything.
 *
 * Authority rules this room enforces structurally rather than by checking:
 *
 * - A client's messages carry intent only. There is no wire message that can
 *   express a position, damage, a pickup, an extraction, or a reward, so there
 *   is nothing to reject — a fabricated one simply has no handler.
 * - Movement distance comes from the server's own speed and fixed step; the
 *   client can only say which of nine directions it is holding.
 * - Cooldowns, interaction distance, extraction presence, and inventory
 *   contents are all decided inside the simulation, from state the client
 *   cannot see or set.
 *
 * Server configuration is injected through a closure rather than read from room
 * options, because Colyseus merges a client's join options into the room's
 * create options — anything read from options could be spoofed by a client.
 *
 * **M5 adds persistence, and only at two moments** (`docs/DATA_MODEL.md` §1):
 * one write when a player secures an item, and one when a player's run ends.
 * The 50 ms step performs no database call and never has. Both persistence paths
 * are `async` and live outside `stepSimulation`, which is unchanged.
 */
import {
  type ArenaDefinition,
  basicBow,
  basicSword,
  chaser,
  lockedContentIds,
  testArena,
} from "@carry-or-fall/game-content";
import {
  DISCARD_ITEM_MESSAGE_TYPE,
  INPUT_MESSAGE_TYPE,
  INVALID_MESSAGE_DISCONNECT_CODE,
  MATCH_ROOM,
  type MatchJoinOptions,
  type MatchPhase,
  PRIVATE_STATE_MESSAGE_TYPE,
  SECURE_ITEM_MESSAGE_TYPE,
  SETTLEMENT_MESSAGE_TYPE,
  type SettlementMessage,
  UNAUTHORIZED_JOIN_CODE,
  validateDiscardItemMessage,
  validateInputMessage,
  validateMatchJoinOptions,
  validateSecureItemMessage,
} from "@carry-or-fall/protocol";
import {
  addPlayerToWorld,
  createSimulation,
  createSkillLoadout,
  findPlayer,
  INVENTORY_SIZE,
  MAX_SKILL_SLOTS,
  NEUTRAL_INPUT,
  removePlayerFromWorld,
  reservationKey,
  SIMULATION_DT_MS,
  stepSimulation,
  type InputState,
  type Player,
  type SkillLoadout,
  type World,
} from "@carry-or-fall/simulation-core";
import { randomUUID } from "node:crypto";
import {
  type Client,
  CloseCode,
  type IRoomCache,
  matchMaker,
  Room,
  type Server,
  ServerError,
} from "@colyseus/core";

import type { Logger } from "../logger";
import { matchMetrics } from "../metrics";
import type { TokenVerifier } from "../progression/auth";
import { DEFAULT_UNLOCK_GRANTS, type SettlementService } from "../progression/settlement-service";
import type { AccountSnapshot, ProgressionStore, UnlockGrant } from "../progression/store";
import { authorizeHandshake } from "./authorize";
import { InputGuard } from "./input-guard";
import { syncMatchState } from "./match-sync";
import { MatchState, type MatchStateType } from "./MatchState";
import { privateStateSignature, toLocalPlayerState } from "./private-state";

/** Technical plan §8.1: "maximum 8 players". */
export const MATCH_MAX_CLIENTS = 8;

/**
 * How long the lobby stays open before the match starts together (technical
 * plan §8.3 "players join during a brief lobby"; concept §22.2 "short lobby
 * countdown"). Neither document gives a number, so this is proposed and
 * balance-deferred like every other unsourced value. Long enough that a second
 * browser tab can realistically finish loading and join the same match.
 */
export const DEFAULT_LOBBY_MS = 8_000;

/** Concept §22.3: "suggested initial maximum match duration: 12 minutes". */
export const DEFAULT_MATCH_MS = 12 * 60 * 1_000;

/**
 * Technical plan §34.1's "short reconnect window". During it the player stays in
 * the world, stationary and — deliberately — still vulnerable.
 */
export const DEFAULT_RECONNECT_MS = 15_000;

/**
 * How long a finished match stays open so players can read their result before
 * the room drops them. Without it a room whose players never close their tab
 * would linger forever holding a finished world.
 */
export const DEFAULT_ENDING_MS = 60_000;

/**
 * How long a match room holds its lobby open for a party whose seats it has
 * reserved but whose members have not connected yet (M6,
 * `docs/M6_ISSUES.md` §1.8).
 *
 * This is not a race window — the seats are already the party's and nobody else
 * can take them. It is the bound on how long one absent member may delay a
 * match, so a party member who closed their laptop between queueing and
 * connecting cannot stall the room forever. Ten seconds is comfortably above
 * the 620-930 ms a browser actually takes to reach a match (`docs/DECISIONS.md`
 * D43) and below Colyseus's own 15 s seat-reservation timeout, so the room stops
 * waiting before the seat itself lapses.
 */
export const DEFAULT_GROUP_SEAT_HOLD_MS = 10_000;

/**
 * One member of a party being seated into this room (M6). `options` is that
 * member's **own** join options — their handshake, their access token, their
 * loadout — recorded with the seat and handed to `onAuth` when they connect, so
 * every join gate still runs per member and nothing is admitted on a
 * teammate's credentials.
 */
export interface GroupSeatMember {
  readonly sessionId: string;
  readonly options: MatchJoinOptions;
}

/** Why a group allocation was refused, so the queue can try the next room. */
export type GroupSeatRefusal = "phase" | "capacity" | "raced";

export type GroupSeatOutcome =
  { readonly ok: true } | { readonly ok: false; readonly reason: GroupSeatRefusal };

/**
 * The one thing `MatchQueue` needs from a live match room. Expressed as an
 * interface, and recovered from a `Room` by {@link asGroupSeatHost}, because
 * `matchMaker.getLocalRoomById` returns the base `Room` type — the concrete
 * class is defined inside `defineMatchRoom`'s closure and is deliberately not
 * exported.
 */
export interface GroupSeatHost {
  reserveGroupSeats(
    partyId: string,
    members: readonly GroupSeatMember[],
    roomCache: IRoomCache,
  ): Promise<GroupSeatOutcome>;
}

/** Narrow a room instance to a {@link GroupSeatHost}, or `null` if it is not one. */
export function asGroupSeatHost(room: Room | undefined | null): GroupSeatHost | null {
  if (room === undefined || room === null) {
    return null;
  }
  const candidate = room as unknown as Partial<GroupSeatHost>;
  return typeof candidate.reserveGroupSeats === "function" ? (candidate as GroupSeatHost) : null;
}

export interface MatchRoomDeps {
  readonly buildVersion: string;
  readonly logger: Logger;
  /** Overridable so integration tests do not wait out a real lobby. */
  readonly lobbyDurationMs?: number;
  readonly matchDurationMs?: number;
  readonly reconnectWindowMs?: number;
  readonly endingDurationMs?: number;
  /** Overridable so a test does not sit through a real party seat hold (M6). */
  readonly groupSeatHoldMs?: number;
  /** Overridable so a test can seed a reproducible match (technical plan §9.4). */
  readonly seed?: number;
  /**
   * The arena this server's matches are played on. Defaults to the one arena
   * the game ships (concept §21.1); this is the seam a second map would arrive
   * through, and the one integration tests use to isolate a rule from the
   * chasers that would otherwise interrupt it.
   */
  readonly arena?: ArenaDefinition;
  /** Permanent account storage (M5). */
  readonly store: ProgressionStore;
  readonly settlement: SettlementService;
  /**
   * How an access token becomes an identity. Which implementation arrives here
   * is `server.ts`'s decision: Supabase Auth when a project is configured, and
   * otherwise a local verifier that mints a per-join identity, because there is
   * nothing to verify a token against (`docs/DECISIONS.md` D45). The room does
   * not branch on the difference — it asks, and refuses whatever is refused.
   */
  readonly tokenVerifier: TokenVerifier;
  /**
   * What a new account is provisioned with. Defaults to concept §5.4's set; a
   * development server may be configured to provision everything instead
   * (`DEV_UNLOCK_ALL`, `config/env.ts`), which is what lets the browser suite
   * test skills a fresh account has not earned.
   */
  readonly unlockGrants?: readonly UnlockGrant[];
}

/** The dependencies `server.ts` owns, rather than a caller configuring a match. */
export type MatchRoomTuning = Omit<
  MatchRoomDeps,
  "buildVersion" | "logger" | "store" | "settlement" | "tokenVerifier"
>;

/** What the room tracks per connected client, alongside their simulated `Player`. */
interface Connection {
  readonly guard: InputGuard;
  /** The latest valid input; re-applied every tick until a newer one arrives (technical plan §9.3). */
  input: InputState;
  /** One-shot inventory commands, consumed by the next tick. */
  pendingSecureSlot: number | null;
  pendingDiscardSlot: number | null;
  connected: boolean;
  lastPrivateSignature: string | null;
  /** The verified account behind this seat (M5). */
  readonly userId: string;
  readonly isAnonymous: boolean;
  account: AccountSnapshot;
  /**
   * Technical plan §14.2's fifth check: "player is not already processing
   * another inventory action". True from the moment a secure request is accepted
   * until its reservation write has landed (or failed), so a client hammering
   * the key cannot open several reservations.
   */
  inventoryActionInFlight: boolean;
  /**
   * The item id a reservation was written for, held until the simulation has
   * actually moved it — see `confirmSecureActions`. Cleared on confirmation or
   * cancellation.
   */
  reservedItemId: string | null;
  /** True from the tick the secure intent is handed to the simulation until its outcome is known. */
  awaitingSecureConfirmation: boolean;
  /** Set once this player's run has been settled, so a settlement never runs twice from here. */
  settlementStarted: boolean;
}

/**
 * What `onAuth` establishes and hands to `onJoin`: the validated join options,
 * the identity Supabase Auth vouched for, and that account's progression. The
 * user id in here came from the *token*, not from the payload — a client never
 * gets to name itself.
 */
interface AuthContext {
  readonly options: MatchJoinOptions;
  readonly identity: { readonly userId: string; readonly isAnonymous: boolean };
  readonly account: AccountSnapshot;
}

/**
 * Register the match room on `gameServer`. A function rather than a bare class
 * so the injected dependencies are captured before the room is defined —
 * matching `defineFoundationRoom`.
 */
export function defineMatchRoom(gameServer: Server, deps: MatchRoomDeps): void {
  const { buildVersion, logger, store, settlement, tokenVerifier } = deps;
  const unlockGrants = deps.unlockGrants ?? DEFAULT_UNLOCK_GRANTS;
  const lobbyDurationMs = deps.lobbyDurationMs ?? DEFAULT_LOBBY_MS;
  const matchDurationMs = deps.matchDurationMs ?? DEFAULT_MATCH_MS;
  const reconnectWindowMs = deps.reconnectWindowMs ?? DEFAULT_RECONNECT_MS;
  const endingDurationMs = deps.endingDurationMs ?? DEFAULT_ENDING_MS;
  const groupSeatHoldMs = deps.groupSeatHoldMs ?? DEFAULT_GROUP_SEAT_HOLD_MS;

  class MatchRoom extends Room<{ state: MatchStateType; auth: AuthContext }> {
    override maxClients = MATCH_MAX_CLIENTS;
    override autoDispose = true;

    private world!: World;
    private readonly connections = new Map<string, Connection>();
    private readonly arena: ArenaDefinition = deps.arena ?? testArena;
    private endingElapsedMs = 0;
    /**
     * A server-generated UUID identifying this match in storage. Deliberately
     * **not** `roomId`: that is a short, human-typable Colyseus identifier with
     * no uniqueness guarantee across process restarts, and it is the primary key
     * half of every settlement — a collision would make two different matches
     * share one ledger row.
     */
    private readonly matchId = randomUUID();
    private readonly startedAt = new Date();

    /**
     * Which party each seated (or expected) player belongs to, written by
     * {@link reserveGroupSeats} before the members connect (M6).
     *
     * **This is the only source of party membership in this room.** It is
     * written by the server, from the party room, over a direct in-process call;
     * no join option, message field, or client-supplied value can reach it.
     * That is what makes technical plan §5.1's "party membership authorization"
     * structurally the server's rather than a check somebody has to remember
     * (`docs/M6_ISSUES.md` §1.3).
     */
    private readonly partyBySession = new Map<string, string>();

    /**
     * Seats promised to a party that has not connected yet, and the deadline
     * after which the room stops waiting for them. The lobby countdown does not
     * complete while any of these is live (`docs/M6_ISSUES.md` §1.8), so a party
     * never arrives to find its match already running.
     */
    private readonly groupSeatHolds = new Map<string, number>();

    /**
     * Join gate. Runs before `onJoin` and before the client occupies a seat, so
     * an incompatible, unauthenticated, or under-unlocked client never takes one
     * of the eight.
     *
     * Four checks now, all refusing rather than correcting:
     *
     * 1. the shared version gate (protocol + content, `authorize.ts`);
     * 2. the payload's shape, including the access token's bounds;
     * 3. **identity** — the token is verified against Supabase Auth, and the
     *    user id comes back from *that*, never from the client (M5);
     * 4. the pre-run skill loadout: `createSkillLoadout` for shape and slot
     *    budget (D38), then the account's unlock set for entitlement (technical
     *    plan §19, "server rejects locked or incompatible combinations").
     *
     * Check 4's second half is what makes an unlock mean something. Without it,
     * a client could name any skill in the content table regardless of what its
     * account has earned, and the `unlocks` table would be decoration.
     */
    override async onAuth(client: Client, options: unknown): Promise<AuthContext> {
      authorizeHandshake(options, client.sessionId, logger);

      const joinOptions = validateMatchJoinOptions(options, MAX_SKILL_SLOTS);
      if (!joinOptions.ok) {
        logger.warn("refused malformed match join options", {
          sessionId: client.sessionId,
          error: joinOptions.error,
        });
        throw new ServerError(INVALID_MESSAGE_DISCONNECT_CODE, "Invalid join options.");
      }

      const verification = await tokenVerifier.verify(joinOptions.value.accessToken);
      if (!verification.ok) {
        logger.warn("refused join with an unverifiable access token", {
          sessionId: client.sessionId,
          reason: verification.reason,
          // The token itself is never logged.
        });
        throw new ServerError(
          UNAUTHORIZED_JOIN_CODE,
          "Your session could not be verified. Please reload the page to sign in again.",
        );
      }
      const { identity } = verification;

      const loadout = createSkillLoadout(joinOptions.value.skillLoadoutIds);
      if (!loadout.ok) {
        logger.warn("refused illegal skill loadout at join", {
          sessionId: client.sessionId,
          reason: loadout.reason,
        });
        throw new ServerError(
          INVALID_MESSAGE_DISCONNECT_CODE,
          `Your skill loadout was rejected (${loadout.reason}).`,
        );
      }

      // Provision on first sight, then finish any reward a crashed server left
      // pending (technical plan §14.3). Recovery runs *before* the player enters
      // a new match so a protected item is never owed across two of them.
      const account = await store.ensureAccount(
        identity.userId,
        identity.displayName,
        unlockGrants,
      );
      await settlement.recoverPending(identity.userId, this.matchId);

      const locked = lockedContentIds(joinOptions.value.skillLoadoutIds, account.unlockIds);
      if (locked.length > 0) {
        logger.warn("refused join naming locked skills", {
          sessionId: client.sessionId,
          userId: identity.userId,
          locked: locked.join(","),
        });
        throw new ServerError(
          UNAUTHORIZED_JOIN_CODE,
          `Your account has not unlocked: ${locked.join(", ")}.`,
        );
      }

      // Re-read: recovery may have granted points that crossed a threshold, so
      // the account the player joins with is the post-recovery one.
      return {
        options: joinOptions.value,
        identity,
        account: (await store.loadAccount(identity.userId)) ?? account,
      };
    }

    override onCreate(): void {
      // The seed is generated here, on the server (technical plan §9.4). It is
      // logged with the room id so a reported match can be reproduced.
      const seed = deps.seed ?? Math.floor(Math.random() * 0xffff_ffff);

      this.world = createSimulation({
        walls: this.arena.walls,
        players: [],
        enemyDefinition: chaser,
        enemySpawnPoints: this.arena.enemySpawnPoints,
        enemyCount: this.arena.enemyCount,
        groundLootSpawnPoints: this.arena.groundLootSpawnPoints,
        skillChipSpawnPoints: this.arena.skillChipSpawnPoints,
        extractionCandidatePoints: this.arena.extractionCandidatePoints,
        seed,
      });

      this.state = new MatchState({
        phase: "waiting" satisfies MatchPhase,
        arenaId: this.arena.id,
        serverBuildVersion: buildVersion,
        seed,
        tick: 0,
        countdownRemainingMs: lobbyDurationMs,
        matchRemainingMs: matchDurationMs,
      });
      this.publishState();

      this.registerMessageHandlers();

      // One fixed step per tick, never a wall-clock delta (technical plan §9.3).
      this.setSimulationInterval(() => {
        this.tick();
      }, SIMULATION_DT_MS);

      logger.info("match room created", {
        roomId: this.roomId,
        matchId: this.matchId,
        seed,
        arenaId: this.arena.id,
      });
    }

    override onJoin(client: Client, _options: unknown, auth: AuthContext): void {
      // Already validated in onAuth; this cannot fail, and re-running it is how
      // the room gets the typed loadout rather than trusting a cached value.
      const loadout = createSkillLoadout(auth.options.skillLoadoutIds);
      const skillLoadout: SkillLoadout = loadout.ok ? loadout.loadout : [];

      this.world = addPlayerToWorld(this.world, {
        id: client.sessionId,
        position: this.nextSpawnPoint(),
        meleeWeapon: basicSword,
        rangedWeapon: basicBow,
        skillLoadout,
      });
      this.connections.set(client.sessionId, {
        guard: new InputGuard(),
        input: NEUTRAL_INPUT,
        pendingSecureSlot: null,
        pendingDiscardSlot: null,
        connected: true,
        lastPrivateSignature: null,
        userId: auth.identity.userId,
        isAnonymous: auth.identity.isAnonymous,
        account: auth.account,
        inventoryActionInFlight: false,
        reservedItemId: null,
        awaitingSecureConfirmation: false,
        settlementStarted: false,
      });

      // A party member has arrived, so the room no longer waits on their seat
      // (M6). A solo player never had a hold to clear.
      this.groupSeatHolds.delete(client.sessionId);

      if (this.state.phase === "waiting") {
        // The lobby countdown starts when the first player arrives, so a solo
        // player is not left waiting for a second who may never come.
        this.state.phase = "countdown" satisfies MatchPhase;
      }

      this.publishState();
      this.sendPrivateState(client.sessionId, true);
      // Their teammates' marker lists just grew by one, and during `countdown`
      // nothing else would resend it: private state is refreshed inside the
      // step, and the step does not run until the match starts. So the first
      // member of a party to arrive would sit through the whole lobby seeing
      // nobody, and only learn about the others on the first tick.
      for (const teammateId of this.partyMemberIdsFor(client.sessionId)) {
        this.sendPrivateState(teammateId, false);
      }

      logger.info("player joined match", {
        roomId: this.roomId,
        sessionId: client.sessionId,
        players: this.world.players.length,
        phase: this.state.phase,
      });
    }

    /**
     * Technical plan §34.1's disconnect policy. An unconsented drop keeps the
     * player in the world — stationary (their stored input becomes neutral) and
     * still vulnerable — for a short window. Reconnecting restores control;
     * letting the window lapse abandons the run, and their carried loot drops on
     * the ground for whoever is still playing.
     *
     * §34.2's account-token reconnect authentication is not available: there are
     * no accounts until M5. Colyseus's own reconnection token is used instead —
     * single-use and issued to that socket, which is the strongest identity that
     * exists right now (`docs/M4_ISSUES.md` §1.8).
     */
    override async onLeave(client: Client, code?: number): Promise<void> {
      const connection = this.connections.get(client.sessionId);
      if (connection === undefined) {
        return;
      }

      const consented = code === CloseCode.CONSENTED;
      if (consented || this.state.phase === "ending") {
        this.removePlayer(client.sessionId, "left");
        return;
      }

      connection.connected = false;
      connection.input = NEUTRAL_INPUT;
      this.publishState();
      logger.info("player disconnected, awaiting reconnect", {
        roomId: this.roomId,
        sessionId: client.sessionId,
        windowMs: reconnectWindowMs,
      });

      try {
        await this.allowReconnection(client, Math.ceil(reconnectWindowMs / 1000));
        connection.connected = true;
        connection.lastPrivateSignature = null;
        this.publishState();
        this.sendPrivateState(client.sessionId, true);
        logger.info("player reconnected", { roomId: this.roomId, sessionId: client.sessionId });
      } catch {
        this.removePlayer(client.sessionId, "abandoned");
      }
    }

    override onDispose(): void {
      logger.info("match room disposed", { roomId: this.roomId, tick: this.world.tick });
    }

    /**
     * Seat a whole party into this room, or refuse — never partially (M6.4/M6.5,
     * `docs/M6_ISSUES.md` §1.1, §1.8). Called by `MatchQueue` on the live room
     * instance, in this process.
     *
     * **The ordering is the guarantee, and it is easy to break.** Steps 1-3 are
     * synchronous, and step 4 must be reached with **no `await` in between**:
     *
     * 1. refuse unless the match has not started;
     * 2. refuse unless every one of the party's seats fits right now;
     * 3. record the party and the seat holds;
     * 4. `reserveMultipleSeatsFor`, whose own capacity check and seat write are
     *    likewise synchronous inside `@colyseus/core`'s `Room#_reserveSeat`.
     *
     * Because JavaScript is single-threaded and `docs/DECISIONS.md` D8 keeps
     * every room in one process, nothing — no other party, no solo
     * `joinOrCreate`, no timer — can run between the check and the write. So the
     * allocation is atomic, and a party of three lands in one room *every time*
     * rather than usually. Insert an `await` above step 4 and that stops being
     * true, silently.
     *
     * Step 5 exists only because "structurally impossible" deserves a check
     * rather than a comment.
     */
    async reserveGroupSeats(
      partyId: string,
      members: readonly GroupSeatMember[],
      roomCache: IRoomCache,
    ): Promise<GroupSeatOutcome> {
      if (this.state.phase !== "waiting" && this.state.phase !== "countdown") {
        return { ok: false, reason: "phase" };
      }
      if (this.freeSeats() < members.length) {
        // Refused rather than trimmed: a party is never split
        // (`docs/M6_ISSUES.md` §1.8). The queue takes the next room, or makes
        // one.
        return { ok: false, reason: "capacity" };
      }

      const deadline = Date.now() + groupSeatHoldMs;
      for (const member of members) {
        this.partyBySession.set(member.sessionId, partyId);
        this.groupSeatHolds.set(member.sessionId, deadline);
      }

      const granted = await matchMaker.reserveMultipleSeatsFor(
        roomCache,
        members.map((member) => ({
          sessionId: member.sessionId,
          options: member.options,
          // No pre-computed auth: leaving this undefined is what makes
          // Colyseus run this room's own `onAuth` when the member connects,
          // with that member's recorded options. Every join gate — version,
          // token, loadout, unlocks — therefore still runs, per member.
          auth: undefined,
        })),
      );

      if (granted.some((seat) => !seat)) {
        for (const member of members) {
          this.partyBySession.delete(member.sessionId);
          this.groupSeatHolds.delete(member.sessionId);
        }
        logger.warn("group seat reservation lost a race it should not have", {
          roomId: this.roomId,
          partyId,
          requested: members.length,
        });
        return { ok: false, reason: "raced" };
      }

      logger.info("reserved group seats", {
        roomId: this.roomId,
        matchId: this.matchId,
        partyId,
        seats: members.length,
        phase: this.state.phase,
      });
      return { ok: true };
    }

    /**
     * Seats nobody holds right now.
     *
     * Colyseus counts a reserved seat in `hasReachedMaxClients()` but does not
     * expose the count, so it is read from the room's own `_reservedSeats`
     * record. Entries become non-enumerable once their client has actually
     * joined (`Room#_onJoin`), so a joined player is counted once, through
     * `this.clients`, and never twice.
     *
     * `party-queue.test.ts` asserts this accessor really sees an outstanding
     * reservation, so a Colyseus upgrade that renames the field fails a test
     * rather than silently letting a party overcommit a room.
     */
    private freeSeats(): number {
      const reserved = (this as unknown as { _reservedSeats?: Record<string, unknown> })
        ._reservedSeats;
      const reservedCount = reserved === undefined ? 0 : Object.keys(reserved).length;
      return MATCH_MAX_CLIENTS - this.clients.length - reservedCount;
    }

    /** Whether the lobby is still waiting on a party it promised seats to. */
    private hasPendingGroupSeats(): boolean {
      const now = Date.now();
      for (const [sessionId, deadline] of this.groupSeatHolds) {
        if (deadline <= now) {
          this.groupSeatHolds.delete(sessionId);
          logger.warn("group seat hold expired; starting without that player", {
            roomId: this.roomId,
            sessionId,
          });
        }
      }
      return this.groupSeatHolds.size > 0;
    }

    /**
     * The other members of this player's party who are in this room right now
     * (M6). Empty for a solo player, and never sent to anyone but the player it
     * describes (`docs/DECISIONS.md` D58).
     */
    private partyMemberIdsFor(sessionId: string): readonly string[] {
      const partyId = this.partyBySession.get(sessionId);
      if (partyId === undefined) {
        return [];
      }
      const ids: string[] = [];
      for (const [otherId, otherParty] of this.partyBySession) {
        if (otherId !== sessionId && otherParty === partyId && this.connections.has(otherId)) {
          ids.push(otherId);
        }
      }
      return ids;
    }

    /** Spawn points are assigned in order, so no two players start stacked. */
    private nextSpawnPoint(): { x: number; y: number } {
      const points = this.arena.playerSpawnPoints;
      const point = points[this.world.players.length % points.length];
      if (point === undefined) {
        throw new Error(`arena ${this.arena.id} declares no player spawn points`);
      }
      return point;
    }

    private removePlayer(sessionId: string, reason: "left" | "abandoned"): void {
      const connection = this.connections.get(sessionId);
      if (connection === undefined || !this.connections.delete(sessionId)) {
        return;
      }
      // A reservation whose item never reached the secure slot is withdrawn
      // rather than left for recovery: the player leaving mid-write did not
      // secure anything, so awarding them for it would be a reward for an action
      // that did not complete.
      if (connection.awaitingSecureConfirmation || connection.inventoryActionInFlight) {
        this.withdrawReservation(sessionId, connection.userId);
      }
      this.world = removePlayerFromWorld(this.world, sessionId);
      // Their teammates' marker lists shrink by one; the signature change in
      // `privateStateSignature` is what makes that actually reach them (M6).
      this.partyBySession.delete(sessionId);
      this.groupSeatHolds.delete(sessionId);
      this.publishState();
      logger.info("player removed from match", { roomId: this.roomId, sessionId, reason });
    }

    /**
     * Every inbound handler takes `unknown` and cannot proceed without a
     * successful `ValidationResult`, so no field is read before it is validated
     * (`docs/DEVELOPMENT_RULES.md`; technical plan §10.2).
     */
    private registerMessageHandlers(): void {
      this.onMessage<unknown>(INPUT_MESSAGE_TYPE, (client, message) => {
        const connection = this.connections.get(client.sessionId);
        if (connection === undefined) {
          return;
        }
        const result = validateInputMessage(message);
        if (!result.ok) {
          this.recordInvalid(client, connection, result.error);
          return;
        }
        const decision = connection.guard.acceptInput(
          result.value.sequence,
          this.acceptsInputFrom(client.sessionId),
          Date.now(),
        );
        if (!decision.accepted) {
          if (decision.reason === "rate_limited") {
            this.recordInvalid(client, connection, "input rate limit exceeded");
          }
          return;
        }
        // Only intent survives: the stored input is rebuilt field by field from
        // the validated message, so nothing else a client attached can ride
        // along into the simulation.
        connection.input = {
          moveX: result.value.moveX,
          moveY: result.value.moveY,
          aimAngle: result.value.aimAngle,
          attackPressed: result.value.attackPressed,
          secondaryAttackPressed: result.value.secondaryAttackPressed,
          dashPressed: result.value.dashPressed,
          interactPressed: result.value.interactPressed,
          discardSlotIndex: null,
          secureSlotIndex: null,
        };
      });

      this.onMessage<unknown>(SECURE_ITEM_MESSAGE_TYPE, (client, message) => {
        const connection = this.connections.get(client.sessionId);
        if (connection === undefined) {
          return;
        }
        const result = validateSecureItemMessage(message, INVENTORY_SIZE);
        if (!result.ok) {
          this.recordInvalid(client, connection, result.error);
          return;
        }
        if (
          !connection.guard.acceptCommand(this.acceptsInputFrom(client.sessionId), Date.now())
            .accepted
        ) {
          return;
        }
        // The client names a slot, never an item. Whether that slot holds
        // anything, and whether the secure slot is free, is the simulation's
        // call (technical plan §14.2) — made below, before anything is written.
        void this.beginSecureAction(client.sessionId, connection, result.value.sourceSlot);
      });

      this.onMessage<unknown>(DISCARD_ITEM_MESSAGE_TYPE, (client, message) => {
        const connection = this.connections.get(client.sessionId);
        if (connection === undefined) {
          return;
        }
        const result = validateDiscardItemMessage(message, INVENTORY_SIZE);
        if (!result.ok) {
          this.recordInvalid(client, connection, result.error);
          return;
        }
        if (
          !connection.guard.acceptCommand(this.acceptsInputFrom(client.sessionId), Date.now())
            .accepted
        ) {
          return;
        }
        connection.pendingDiscardSlot = result.value.sourceSlot;
      });

      // Any message type this room does not implement — including one a client
      // invents to claim an outcome — lands here, is counted, and is discarded.
      this.onMessage<unknown>("*", (client, type) => {
        const connection = this.connections.get(client.sessionId);
        if (connection === undefined) {
          return;
        }
        this.recordInvalid(client, connection, `unknown message type: ${String(type)}`);
      });
    }

    /**
     * The secure-slot action, in the one order technical plan §14.3 permits
     * (`docs/DATA_MODEL.md` §4.2). This is the milestone's load-bearing method,
     * so the ordering is spelled out rather than implied:
     *
     * 1. Validate against **live simulation state** — alive, run not over, slot
     *    holds an item, secure slot empty, no other inventory action in flight.
     * 2. Write the reservation, and *await* it.
     * 3. Only then hand the intent to the simulation, which is what moves the
     *    item and therefore what the owning client observes as success.
     *
     * The guarantee `docs/DEVELOPMENT_RULES.md` demands — "insertion must be
     * persisted before it is reported successful" — is structural here, not a
     * convention: the only channel that tells a client its secure slot is full
     * is the private-state message derived from simulation state, and the
     * simulation is not given the intent until step 2 resolves. **There is no
     * code path that reports success and then writes**, so a crash has no window
     * to fall into.
     *
     * Step 3 re-checks that the slot still holds the reserved item. Ticks
     * continue during the await: the player may have discarded it or died. A
     * stale reservation is cancelled rather than honored, so recovery cannot
     * later award an item that never actually reached the secure slot.
     */
    private async beginSecureAction(
      sessionId: string,
      connection: Connection,
      sourceSlot: number,
    ): Promise<void> {
      if (connection.inventoryActionInFlight) {
        // Technical plan §14.2's fifth check. Without it, a client hammering the
        // key could open several reservations for one secure slot.
        return;
      }

      const player = findPlayer(this.world, sessionId);
      const item = player?.inventory[sourceSlot];
      if (
        player === null ||
        player === undefined ||
        !player.alive ||
        player.runResult !== null ||
        player.secureSlot !== null ||
        item === undefined ||
        item === null
      ) {
        return;
      }

      connection.inventoryActionInFlight = true;
      connection.reservedItemId = item.id;
      const key = reservationKey(this.matchId, connection.userId);

      try {
        await store.reserveSecureItem(key, this.matchId, connection.userId, item.id);
      } catch (error) {
        // The write did not land, so the item stays in normal inventory and the
        // player is told nothing. That is the truthful outcome: they may still
        // try again, and they will lose the item on death — which is exactly
        // what "not secured" means.
        logger.warn("secure reservation failed; item stays in normal inventory", {
          roomId: this.roomId,
          sessionId,
          error: error instanceof Error ? error.message : String(error),
        });
        connection.inventoryActionInFlight = false;
        connection.reservedItemId = null;
        return;
      }

      // The write landed: now, and only now, the simulation may move the item.
      // Whether it *does* is settled by `confirmSecureActions` after the next
      // step — not by re-checking the slot here.
      connection.pendingSecureSlot = sourceSlot;
      connection.awaitingSecureConfirmation = true;
    }

    /**
     * Reconcile each in-flight reservation against what the simulation actually
     * did, once the tick that consumed the intent has run.
     *
     * This exists because an earlier version re-checked the slot *before* handing
     * the intent over, and that was wrong in a way a test caught: a `discard_item`
     * arriving in the same tick is applied first (`stepPlayerAttacks` handles
     * discard before secure), so the item left the inventory, `secureItem`
     * refused, and the reservation stayed `pending` — leaving recovery ready to
     * award points for an item the player had thrown away. Confirming against the
     * outcome closes that off: the reservation survives only if the item is
     * genuinely in the secure slot.
     */
    private confirmSecureActions(): void {
      for (const [sessionId, connection] of this.connections) {
        if (!connection.awaitingSecureConfirmation || connection.pendingSecureSlot !== null) {
          continue;
        }
        const player = findPlayer(this.world, sessionId);
        const secured = player?.secureSlot ?? null;
        const reservedItemId = connection.reservedItemId;

        connection.awaitingSecureConfirmation = false;
        connection.inventoryActionInFlight = false;
        connection.reservedItemId = null;

        if (secured !== null && secured.id === reservedItemId) {
          continue;
        }
        this.withdrawReservation(sessionId, connection.userId);
      }
    }

    /** Move a reservation to `cancelled`, so recovery cannot later honor it. */
    private withdrawReservation(sessionId: string, userId: string): void {
      void store
        .cancelSecureReservation(reservationKey(this.matchId, userId))
        .catch((error: unknown) => {
          // Left `pending`. Recovery would award it, which is the wrong outcome
          // — so it is logged loudly rather than swallowed.
          logger.error("could not withdraw an unconfirmed secure reservation", {
            roomId: this.roomId,
            sessionId,
            userId,
            error: error instanceof Error ? error.message : String(error),
          });
          return false;
        });
    }

    /** Whether this player may act right now: the match is running and their run is not over. */
    private acceptsInputFrom(sessionId: string): boolean {
      if (this.state.phase !== "running") {
        return false;
      }
      const player = findPlayer(this.world, sessionId);
      return player !== null && player.alive && player.runResult === null;
    }

    private recordInvalid(client: Client, connection: Connection, error: string): void {
      const shouldDisconnect = connection.guard.recordInvalid();
      logger.warn("rejected client message", {
        roomId: this.roomId,
        sessionId: client.sessionId,
        error,
        invalidMessages: connection.guard.invalidMessages,
      });
      if (shouldDisconnect) {
        // Technical plan §33: temporary disconnect after repeated invalid
        // behavior.
        client.leave(INVALID_MESSAGE_DISCONNECT_CODE);
      }
    }

    /** One authoritative tick. */
    private tick(): void {
      switch (this.state.phase) {
        case "waiting":
          return;
        case "countdown":
          if (this.hasPendingGroupSeats()) {
            // The room promised a party seats it has not filled yet, so the
            // countdown is held where it stands rather than running out under
            // them (M6, `docs/M6_ISSUES.md` §1.8). Bounded: each hold has a
            // deadline, and `hasPendingGroupSeats` drops the expired ones, so an
            // absent member delays a match rather than preventing it.
            return;
          }
          this.state.countdownRemainingMs = Math.max(
            0,
            this.state.countdownRemainingMs - SIMULATION_DT_MS,
          );
          if (this.state.countdownRemainingMs <= 0) {
            this.startMatch();
          }
          return;
        case "running": {
          // Timed for the metrics report (technical plan §32.2's "average room
          // tick duration"). A step that grows over a session is the signal that
          // something is accumulating.
          const startedAt = performance.now();
          this.stepMatch();
          matchMetrics.recordTick(performance.now() - startedAt);
          return;
        }
        case "ending":
          this.endingElapsedMs += SIMULATION_DT_MS;
          if (this.endingElapsedMs >= endingDurationMs) {
            void this.disconnect();
          }
          return;
        default:
          return;
      }
    }

    /**
     * Start the match together and disable late join (technical plan §8.3). The
     * lock is what keeps `docs/DECISIONS.md` D7 true: a client calling
     * `joinOrCreate` now gets a *new* room, because this one is a match in
     * progress rather than a lobby.
     */
    private startMatch(): void {
      this.state.phase = "running" satisfies MatchPhase;
      void this.lock();
      logger.info("match started", {
        roomId: this.roomId,
        players: this.world.players.length,
        durationMs: matchDurationMs,
      });
    }

    private stepMatch(): void {
      const inputs = new Map<string, InputState>();
      for (const [sessionId, connection] of this.connections) {
        inputs.set(sessionId, {
          ...connection.input,
          // One-shot commands apply on exactly one tick.
          discardSlotIndex: connection.pendingDiscardSlot,
          secureSlotIndex: connection.pendingSecureSlot,
        });
        connection.pendingDiscardSlot = null;
        connection.pendingSecureSlot = null;
      }

      // Hit events are one-shot and are deliberately not stored in synchronized
      // state (technical plan §10.4, `docs/PROTOCOL.md` §8). No client renders
      // them yet, so they are discarded here rather than broadcast into a
      // channel nothing consumes.
      this.world = stepSimulation(this.world, inputs).world;
      this.state.matchRemainingMs = Math.max(0, this.state.matchRemainingMs - SIMULATION_DT_MS);

      // A secure intent handed over above has now either taken effect or not.
      this.confirmSecureActions();

      this.publishState();
      for (const sessionId of this.connections.keys()) {
        this.sendPrivateState(sessionId, false);
      }

      // A run that just ended is settled here, outside the step. `stepSimulation`
      // itself is untouched and still performs no I/O (`docs/DATA_MODEL.md` §1).
      this.settleFinishedRuns();

      if (this.isMatchOver()) {
        this.state.phase = "ending" satisfies MatchPhase;
        logger.info("match ended", {
          roomId: this.roomId,
          tick: this.world.tick,
          remainingMs: this.state.matchRemainingMs,
        });
      }
    }

    /**
     * Settle every run that ended on this tick (technical plan §15.3).
     *
     * Triggered by the server observing `runResult` becoming non-null — never by
     * a client message, because no client → server message can express an
     * outcome or a reward (`docs/DATA_MODEL.md` §6). `settlementStarted` is set
     * *before* the await, so a later tick observing the same finished player
     * cannot start a second settlement; the store's idempotency is the second
     * line of defence, not the first.
     */
    private settleFinishedRuns(): void {
      for (const [sessionId, connection] of this.connections) {
        if (connection.settlementStarted) {
          continue;
        }
        const player = findPlayer(this.world, sessionId);
        if (player === null || player.runResult === null) {
          continue;
        }
        connection.settlementStarted = true;
        void this.settlePlayer(sessionId, connection, player);
      }
    }

    private async settlePlayer(
      sessionId: string,
      connection: Connection,
      player: Player,
    ): Promise<void> {
      const runResult = player.runResult;
      if (runResult === null) {
        return;
      }

      const outcome = await settlement.settle({
        matchId: this.matchId,
        userId: connection.userId,
        runResult,
        account: connection.account,
        startedAt: this.startedAt,
        endedAt: new Date(),
      });

      if (outcome === null) {
        // Retries were exhausted. The reservation (if any) stays `pending` and
        // the next join finishes it under the same key, so nothing is lost and
        // nothing is awarded twice.
        logger.warn("run settlement deferred to recovery", {
          roomId: this.roomId,
          matchId: this.matchId,
          userId: connection.userId,
        });
        return;
      }

      connection.account = {
        userId: connection.userId,
        balances: outcome.balances,
        unlockIds: outcome.unlockIds,
      };

      const message: SettlementMessage = {
        alreadySettled: outcome.alreadySettled,
        balances: outcome.balances,
        unlockIds: outcome.unlockIds,
        newUnlockIds: outcome.newUnlockIds,
        isAnonymous: connection.isAnonymous,
      };
      // Sent after the write, so receiving it means the points are in the
      // account — not that the server intends to put them there.
      this.clients.getById(sessionId)?.send(SETTLEMENT_MESSAGE_TYPE, message);

      logger.info("run settled", {
        roomId: this.roomId,
        matchId: this.matchId,
        userId: connection.userId,
        outcome: runResult.outcome,
        alreadySettled: outcome.alreadySettled,
        newUnlocks: outcome.newUnlockIds.length,
      });
    }

    /** Concept §22.3: a match ends when the time limit expires or everyone has extracted or died. */
    private isMatchOver(): boolean {
      if (this.state.matchRemainingMs <= 0) {
        return true;
      }
      return (
        this.world.players.length > 0 &&
        this.world.players.every((player) => player.runResult !== null)
      );
    }

    private publishState(): void {
      syncMatchState(this.state, this.world, (playerId) => {
        return this.connections.get(playerId)?.connected ?? false;
      });
    }

    /** Send one player their own private state, if it changed (or if `force`). */
    private sendPrivateState(sessionId: string, force: boolean): void {
      const connection = this.connections.get(sessionId);
      const player = findPlayer(this.world, sessionId);
      if (connection === undefined || player === null) {
        return;
      }
      const partyMemberIds = this.partyMemberIdsFor(sessionId);
      const signature = privateStateSignature(player, partyMemberIds);
      if (!force && signature === connection.lastPrivateSignature) {
        return;
      }
      connection.lastPrivateSignature = signature;
      // Addressed to exactly one client. There is no broadcast of this data and
      // no field of it in synchronized state (technical plan §10.3). The party
      // marker list rides here for the same reason (`docs/DECISIONS.md` D58).
      const target = this.clients.getById(sessionId);
      target?.send(PRIVATE_STATE_MESSAGE_TYPE, toLocalPlayerState(player, partyMemberIds));
    }
  }

  gameServer.define(MATCH_ROOM, MatchRoom);
}
