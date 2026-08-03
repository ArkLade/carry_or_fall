/**
 * The party room (M6.3, `docs/M6_ISSUES.md` §4; technical plan §8.4).
 *
 * One room is one party: a leader, up to three members (concept §15.3), a join
 * code, and one button that asks the server to seat everyone into a single
 * match. It runs no simulation, owns no world, and decides no game outcome — it
 * is a grouping, and the whole of its authority is deciding who is in it, which
 * technical plan §5.1 explicitly denies the client.
 *
 * It is **not a lobby** (`docs/DECISIONS.md` D57). There is no room browser, no
 * waiting for strangers, no persisted membership. A party exists while its
 * members' connections do and is gone with the last of them; nothing about it
 * reaches Supabase, and M6 adds no table for it to reach.
 *
 * ## How a member finds the right party
 *
 * The room registers with `.filterBy(["joinCode"])` and publishes its code as
 * matchmaking metadata, so Colyseus routes `join(party_room, { joinCode })` to
 * the party that answers to it. Two independent things keep that from becoming
 * a way into a stranger's party:
 *
 * 1. `validatePartyJoinOptions` **requires the `joinCode` property to be
 *    present**. Colyseus builds its filter from the properties a client
 *    actually sent, so an omitted `joinCode` would mean an empty filter — which
 *    matches any party. A refusal at the boundary means that request never
 *    reaches matchmaking. (An explicit `null` is also safe: it matches no room,
 *    because every party's metadata code is a string.)
 * 2. {@link onJoin} re-checks the presented code against **this room's current
 *    code and its expiry**, and refuses with `PARTY_JOIN_REFUSED_CODE`
 *    otherwise. So even if routing ever changed, landing in the wrong party
 *    would not admit anyone.
 *
 * ## Why the gate is a static `onAuth`
 *
 * Colyseus runs a room class's **static** `onAuth` during matchmaking, *before*
 * it looks for a room, and its instance `onAuth` only when a seat is consumed —
 * and defining both means the instance one is ignored. The party gate wants to
 * run first (defence 1 above must refuse before a room is found), so it is
 * static, and the one check that genuinely needs a room instance — the code —
 * happens in {@link onJoin}, where a throw refuses the join and frees the seat.
 *
 * The gate itself is the same one the match room runs: version handshake (D18,
 * D34), payload shape, Supabase token verification (D45), skill-loadout
 * validity (D38), and account unlocks (D48). A party member's loadout is the
 * loadout they will carry into the match, so refusing it at the party door is
 * refusing it at the earliest honest moment rather than letting a party queue
 * and then have one member bounced at the match.
 */
import { lockedContentIds } from "@carry-or-fall/game-content";
import {
  CANCEL_QUEUE_MESSAGE_TYPE,
  INCOMPATIBLE_CLIENT_HTTP_STATUS,
  INVALID_JOIN_OPTIONS_HTTP_STATUS,
  INVALID_MESSAGE_DISCONNECT_CODE,
  LEAVE_PARTY_MESSAGE_TYPE,
  MATCH_READY_MESSAGE_TYPE,
  MAX_PARTY_SIZE,
  type MatchJoinOptions,
  type MatchReadyMessage,
  PARTY_ERROR_MESSAGE_TYPE,
  PARTY_JOIN_REFUSED_CODE,
  PARTY_JOIN_REFUSED_HTTP_STATUS,
  PARTY_JOIN_REFUSED_MESSAGE,
  PARTY_ROOM,
  type PartyErrorCode,
  type PartyErrorMessage,
  type PartyJoinOptions,
  type PartyStatus,
  QUEUE_MATCH_MESSAGE_TYPE,
  REFRESH_JOIN_CODE_MESSAGE_TYPE,
  validatePartyCommandMessage,
  validatePartyJoinOptions,
} from "@carry-or-fall/protocol";
import { createSkillLoadout, MAX_SKILL_SLOTS } from "@carry-or-fall/simulation-core";
import { randomUUID } from "node:crypto";
import { type Client, CloseCode, matchMaker, Room, type Server, ServerError } from "@colyseus/core";

import type { Logger } from "../logger";
import {
  generateJoinCode,
  isJoinCodeExpired,
  joinCodeRemainingMs,
  PARTY_CODE_TTL_MS,
} from "../party/join-code";
import type { MatchQueue } from "../party/match-queue";
import type { TokenVerifier } from "../progression/auth";
import { DEFAULT_UNLOCK_GRANTS } from "../progression/settlement-service";
import type { ProgressionStore, UnlockGrant } from "../progression/store";
import { authorizeHandshake } from "./authorize";
import { InputGuard } from "./input-guard";
import { PartyMemberState, PartyState, type PartyStateType } from "./PartyState";

/** How often the room refreshes the code's countdown in synchronized state. */
const CODE_TICK_MS = 1_000;

/**
 * Technical plan §34.1's shape, applied to a room with no simulation to hold a
 * body in: a dropped member's seat is held briefly so a network blip does not
 * cost them their party.
 */
export const DEFAULT_PARTY_RECONNECT_MS = 20_000;

export interface PartyRoomDeps {
  readonly logger: Logger;
  readonly store: ProgressionStore;
  readonly tokenVerifier: TokenVerifier;
  readonly queue: MatchQueue;
  readonly unlockGrants?: readonly UnlockGrant[];
  /** Overridable so a test does not wait ten real minutes for a code to expire. */
  readonly joinCodeTtlMs?: number;
  readonly reconnectWindowMs?: number;
}

/** What `server.ts` owns rather than a caller configuring a party. */
export type PartyRoomTuning = Pick<PartyRoomDeps, "joinCodeTtlMs" | "reconnectWindowMs">;

/**
 * What the static gate establishes and hands to `onJoin`.
 *
 * Deliberately has **no `sessionId` field**: Colyseus reads `authData.sessionId`
 * as the session id to reserve, so a field of that name here would silently let
 * the gate's return value choose session ids.
 */
interface PartyAuth {
  readonly options: PartyJoinOptions;
  readonly userId: string;
  readonly displayName: string;
}

/**
 * Narrow a Colyseus seat reservation into the payload the client validates.
 *
 * Colyseus types every field of `ISeatReservation` as optional because the same
 * shape serves several code paths; `buildSeatReservation` fills all four. This
 * turns that into a checked fact rather than an assertion, so a future Colyseus
 * change surfaces as one server log line instead of a client that opens a
 * socket to `undefined`.
 */
function toMatchReadyMessage(
  reservation: matchMaker.ISeatReservation | undefined,
): MatchReadyMessage | null {
  if (reservation === undefined) {
    return null;
  }
  const { name, sessionId, roomId, processId, publicAddress } = reservation;
  if (
    typeof name !== "string" ||
    typeof sessionId !== "string" ||
    typeof roomId !== "string" ||
    typeof processId !== "string"
  ) {
    return null;
  }
  return {
    seatReservation: {
      name,
      sessionId,
      roomId,
      processId,
      ...(typeof publicAddress === "string" ? { publicAddress } : {}),
    },
  };
}

/** Per-member bookkeeping the synchronized state deliberately does not carry. */
interface PartyConnection {
  readonly guard: InputGuard;
  /** The member's own match join options, forwarded verbatim when the party queues. */
  readonly matchOptions: MatchJoinOptions;
  readonly joinedAt: number;
}

export function definePartyRoom(gameServer: Server, deps: PartyRoomDeps): void {
  const { logger, store, tokenVerifier, queue } = deps;
  const unlockGrants = deps.unlockGrants ?? DEFAULT_UNLOCK_GRANTS;
  const joinCodeTtlMs = deps.joinCodeTtlMs ?? PARTY_CODE_TTL_MS;
  const reconnectWindowMs = deps.reconnectWindowMs ?? DEFAULT_PARTY_RECONNECT_MS;

  class PartyRoom extends Room<{ state: PartyStateType; auth: PartyAuth }> {
    override maxClients = MAX_PARTY_SIZE;
    override autoDispose = true;

    /** Opaque and server-generated; meaningful only inside a match room. */
    private readonly partyId = randomUUID();
    private readonly connections = new Map<string, PartyConnection>();
    private codeMintedAt = Date.now();
    /** True while an allocation is in flight, so a leader cannot queue twice. */
    private allocating = false;

    /**
     * The join gate, run during matchmaking — before a room is chosen, and
     * therefore before an omitted `joinCode` could become a filter that matches
     * any party (see the module doc).
     */
    static override async onAuth(token: string | null, options: unknown): Promise<PartyAuth> {
      // No session id exists yet — this runs before a room is even chosen — so
      // the log context names the gate rather than a client.
      authorizeHandshake(options, "party-join", logger, INCOMPATIBLE_CLIENT_HTTP_STATUS);

      const joinOptions = validatePartyJoinOptions(options, MAX_SKILL_SLOTS);
      if (!joinOptions.ok) {
        logger.warn("refused malformed party join options", { error: joinOptions.error });
        throw new ServerError(INVALID_JOIN_OPTIONS_HTTP_STATUS, "Invalid party join options.");
      }

      // Identity comes out of the token, on the server, exactly as it does at
      // the match door (`docs/DECISIONS.md` D45). A party member is an account,
      // not a nickname.
      // `?? null` is not decoration: Colyseus passes `undefined` for `token`
      // when no Authorization header is present, and a verifier handed
      // `undefined` where it expects `string | null` reads `.length` off
      // nothing. The join option is the documented channel (D45); the bearer
      // token is only a fallback for a client that uses Colyseus's own auth.
      const verification = await tokenVerifier.verify(
        joinOptions.value.accessToken ?? token ?? null,
      );
      if (!verification.ok) {
        logger.warn("refused party join with an unverifiable access token", {
          reason: verification.reason,
        });
        throw new ServerError(
          PARTY_JOIN_REFUSED_HTTP_STATUS,
          "Your session could not be verified. Please reload the page to sign in again.",
        );
      }
      const { identity } = verification;

      const loadout = createSkillLoadout(joinOptions.value.skillLoadoutIds);
      if (!loadout.ok) {
        throw new ServerError(
          INVALID_JOIN_OPTIONS_HTTP_STATUS,
          `Your skill loadout was rejected (${loadout.reason}).`,
        );
      }

      const account = await store.ensureAccount(
        identity.userId,
        identity.displayName,
        unlockGrants,
      );
      const locked = lockedContentIds(joinOptions.value.skillLoadoutIds, account.unlockIds);
      if (locked.length > 0) {
        throw new ServerError(
          PARTY_JOIN_REFUSED_HTTP_STATUS,
          `Your account has not unlocked: ${locked.join(", ")}.`,
        );
      }

      return {
        options: joinOptions.value,
        userId: identity.userId,
        displayName: identity.displayName,
      };
    }

    override onCreate(): void {
      const joinCode = generateJoinCode();
      this.codeMintedAt = Date.now();
      this.state = new PartyState({
        joinCode,
        leaderSessionId: "",
        status: "forming" satisfies PartyStatus,
        joinCodeExpiresInMs: joinCodeTtlMs,
      });
      // Published as matchmaking metadata so `filterBy(["joinCode"])` can route
      // a member here. Metadata is not listable: `@colyseus/core@0.17.45`
      // exposes only `POST /matchmake/:method/:roomName` and no room-listing
      // route (`docs/DECISIONS.md` D56), which `party-room.test.ts` asserts
      // against the installed package rather than trusting.
      void this.setMetadata({ joinCode });

      this.registerMessageHandlers();
      this.setSimulationInterval(() => {
        this.publishCodeCountdown();
      }, CODE_TICK_MS);

      // The code itself is deliberately absent from this line and every other.
      logger.info("party created", { roomId: this.roomId, partyId: this.partyId });
    }

    /**
     * The one check that needs a room instance: does the code this member
     * presented actually address *this* party, and is it still live?
     *
     * Throwing here refuses the join — Colyseus frees the seat and reports the
     * error to the client — which is why the transient seat a wrongly routed
     * join would occupy is released rather than held.
     */
    override onJoin(client: Client, _options: unknown, auth: PartyAuth): void {
      const presented = auth.options.joinCode;
      const expired = isJoinCodeExpired(this.codeMintedAt, Date.now(), joinCodeTtlMs);
      const creating = presented === null && this.connections.size === 0;

      if (!creating && (presented !== this.state.joinCode || expired)) {
        // One refusal for "wrong code", "old code", and "expired code": telling
        // them apart would answer questions for whoever is guessing
        // (`docs/DECISIONS.md` D56).
        logger.warn("refused a party join", {
          roomId: this.roomId,
          partyId: this.partyId,
          expired,
        });
        throw new ServerError(PARTY_JOIN_REFUSED_CODE, PARTY_JOIN_REFUSED_MESSAGE);
      }

      const isLeader = this.state.members.size === 0;
      this.connections.set(client.sessionId, {
        guard: new InputGuard(),
        matchOptions: {
          protocolVersion: auth.options.protocolVersion,
          contentVersion: auth.options.contentVersion,
          buildVersion: auth.options.buildVersion,
          skillLoadoutIds: auth.options.skillLoadoutIds,
          accessToken: auth.options.accessToken,
        },
        joinedAt: Date.now(),
      });
      this.state.members.set(
        client.sessionId,
        new PartyMemberState({
          sessionId: client.sessionId,
          displayName: auth.displayName,
          isLeader,
          connected: true,
        }),
      );
      if (isLeader) {
        this.state.leaderSessionId = client.sessionId;
      }

      logger.info("player joined party", {
        roomId: this.roomId,
        partyId: this.partyId,
        sessionId: client.sessionId,
        members: this.state.members.size,
        isLeader,
      });
    }

    /**
     * Technical plan §34.1's shape without a body to keep standing: a dropped
     * member is marked disconnected and held briefly, so a blip does not cost
     * them their party; a deliberate leave, or a lapsed window, removes them.
     */
    override async onLeave(client: Client, code?: number): Promise<void> {
      const consented = code === CloseCode.CONSENTED;
      if (consented) {
        this.removeMember(client.sessionId);
        return;
      }

      const member = this.state.members.get(client.sessionId);
      if (member === undefined) {
        return;
      }
      member.connected = false;

      try {
        await this.allowReconnection(client, Math.ceil(reconnectWindowMs / 1000));
        const rejoined = this.state.members.get(client.sessionId);
        if (rejoined !== undefined) {
          rejoined.connected = true;
        }
      } catch {
        this.removeMember(client.sessionId);
      }
    }

    override onDispose(): void {
      // The code dies with the party; there is nowhere else it exists.
      logger.info("party disposed", { roomId: this.roomId, partyId: this.partyId });
    }

    private removeMember(sessionId: string): void {
      if (!this.state.members.has(sessionId)) {
        return;
      }
      this.state.members.delete(sessionId);
      this.connections.delete(sessionId);

      if (this.state.leaderSessionId === sessionId) {
        this.promoteLeader();
      }
      logger.info("player left party", {
        roomId: this.roomId,
        partyId: this.partyId,
        sessionId,
        members: this.state.members.size,
      });
    }

    /** The earliest-joined remaining member leads. A party without a leader could never queue. */
    private promoteLeader(): void {
      let next: string | null = null;
      let earliest = Number.POSITIVE_INFINITY;
      for (const [sessionId, connection] of this.connections) {
        if (connection.joinedAt < earliest) {
          earliest = connection.joinedAt;
          next = sessionId;
        }
      }
      this.state.leaderSessionId = next ?? "";
      for (const [sessionId, member] of this.state.members) {
        member.isLeader = sessionId === next;
      }
    }

    private registerMessageHandlers(): void {
      this.onMessage<unknown>(QUEUE_MATCH_MESSAGE_TYPE, (client, message) => {
        if (!this.acceptCommand(client, message)) {
          return;
        }
        void this.queueParty(client);
      });

      this.onMessage<unknown>(CANCEL_QUEUE_MESSAGE_TYPE, (client, message) => {
        if (!this.acceptCommand(client, message)) {
          return;
        }
        if (this.state.leaderSessionId !== client.sessionId || this.allocating) {
          return;
        }
        this.state.status = "forming" satisfies PartyStatus;
      });

      this.onMessage<unknown>(REFRESH_JOIN_CODE_MESSAGE_TYPE, (client, message) => {
        if (!this.acceptCommand(client, message)) {
          return;
        }
        if (this.state.leaderSessionId !== client.sessionId) {
          this.sendError(client, "not_leader", "Only the party leader can change the code.");
          return;
        }
        // The previous code stops working the instant this lands, which is what
        // makes a bounded lifetime usable rather than merely restrictive.
        const joinCode = generateJoinCode();
        this.codeMintedAt = Date.now();
        this.state.joinCode = joinCode;
        this.state.joinCodeExpiresInMs = joinCodeTtlMs;
        void this.setMetadata({ joinCode });
      });

      this.onMessage<unknown>(LEAVE_PARTY_MESSAGE_TYPE, (client, message) => {
        if (!this.acceptCommand(client, message)) {
          return;
        }
        this.removeMember(client.sessionId);
        client.leave(CloseCode.CONSENTED);
      });

      // Anything else — including a message invented to claim membership or to
      // act on another member — is counted and discarded, as in the match room.
      this.onMessage<unknown>("*", (client, type) => {
        this.recordInvalid(client, `unknown message type: ${String(type)}`);
      });
    }

    /** Shape check plus rate limit, shared by all four commands. */
    private acceptCommand(client: Client, message: unknown): boolean {
      const connection = this.connections.get(client.sessionId);
      if (connection === undefined) {
        return false;
      }
      if (!validatePartyCommandMessage(message).ok) {
        this.recordInvalid(client, "malformed party command");
        return false;
      }
      return connection.guard.acceptCommand(true, Date.now()).accepted;
    }

    private recordInvalid(client: Client, error: string): void {
      const connection = this.connections.get(client.sessionId);
      if (connection === undefined) {
        return;
      }
      const shouldDisconnect = connection.guard.recordInvalid();
      logger.warn("rejected party message", {
        roomId: this.roomId,
        sessionId: client.sessionId,
        error,
        invalidMessages: connection.guard.invalidMessages,
      });
      if (shouldDisconnect) {
        client.leave(INVALID_MESSAGE_DISCONNECT_CODE);
      }
    }

    /**
     * Technical plan §8.4 step 4: the party enters matchmaking together.
     *
     * The party is handed to {@link MatchQueue}, which either seats every
     * connected member in one room or seats none of them. Each member then
     * receives **its own** reservation — the seat is already held, so the
     * 620-930 ms a browser takes to arrive (`docs/DECISIONS.md` D43) is spent
     * against a seat nobody else can take, rather than racing for one.
     */
    private async queueParty(client: Client): Promise<void> {
      if (this.state.leaderSessionId !== client.sessionId) {
        this.sendError(client, "not_leader", "Only the party leader can start the match.");
        return;
      }
      if (this.allocating) {
        this.sendError(client, "already_queued", "Your party is already looking for a match.");
        return;
      }

      // Only connected members are seated. A member who dropped mid-queue is
      // simply not in the group; the party is never split across two rooms
      // (`docs/M6_ISSUES.md` §1.8).
      const seated = [...this.state.members.entries()]
        .filter(([, member]) => member.connected)
        .map(([sessionId]) => sessionId)
        .filter((sessionId) => this.connections.has(sessionId));

      if (seated.length === 0) {
        this.sendError(client, "party_empty", "Nobody in your party is connected.");
        return;
      }

      this.allocating = true;
      this.state.status = "queued" satisfies PartyStatus;
      try {
        const result = await queue.enqueue({
          partyId: this.partyId,
          members: seated.map((sessionId) => ({
            options: this.connections.get(sessionId)!.matchOptions,
          })),
        });

        if (!result.ok) {
          this.state.status = "forming" satisfies PartyStatus;
          this.broadcastError(
            "no_room_available",
            "No match could take your whole party. Try again in a moment.",
          );
          return;
        }

        this.state.status = "in_match" satisfies PartyStatus;
        seated.forEach((sessionId, index) => {
          const message = toMatchReadyMessage(result.reservations[index]);
          if (message === null) {
            // Colyseus always fills these in, so this is unreachable — but a
            // half-built reservation would fail the client's own validator with
            // a much less useful message than this log line.
            logger.error("built an incomplete seat reservation", {
              roomId: this.roomId,
              partyId: this.partyId,
            });
            return;
          }
          this.clients.getById(sessionId)?.send(MATCH_READY_MESSAGE_TYPE, message);
        });

        logger.info("party seated into one match", {
          roomId: this.roomId,
          partyId: this.partyId,
          matchRoomId: result.roomId,
          seats: seated.length,
        });
      } finally {
        this.allocating = false;
      }
    }

    private sendError(client: Client, code: PartyErrorCode, message: string): void {
      const payload: PartyErrorMessage = { code, message };
      client.send(PARTY_ERROR_MESSAGE_TYPE, payload);
    }

    private broadcastError(code: PartyErrorCode, message: string): void {
      const payload: PartyErrorMessage = { code, message };
      this.broadcast(PARTY_ERROR_MESSAGE_TYPE, payload);
    }

    private publishCodeCountdown(): void {
      this.state.joinCodeExpiresInMs = joinCodeRemainingMs(
        this.codeMintedAt,
        Date.now(),
        joinCodeTtlMs,
      );
    }
  }

  gameServer.define(PARTY_ROOM, PartyRoom).filterBy(["joinCode"]);
}
