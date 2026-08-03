/**
 * The client's half of the party room (M6.6, `docs/M6_ISSUES.md` §7).
 *
 * **Module-level, deliberately.** A party has to survive the trip
 * `LoadoutScene → PlayScene → LoadoutScene`, and Phaser destroys a scene's
 * objects on every transition — so a party owned by a scene would end with the
 * first run. Owning it here is what makes `docs/DECISIONS.md` D57's claim true:
 * a party persists across runs *within a sitting*, because the socket does. It
 * still persists nothing: reload the page and the connection, and the party,
 * are gone.
 *
 * It decides nothing. Who leads, who may join, whether the party fits in a room,
 * and which room it lands in are all server decisions (technical plan §5.1);
 * this module sends four fieldless commands and renders what comes back.
 *
 * ## Reconnection policy, stated rather than inherited
 *
 * `@colyseus/sdk` enables automatic reconnection by default and starts using it
 * once a room has been up for five seconds (`docs/DECISIONS.md` D54). A party
 * room lives for whole matches, so unlike every earlier room in this project it
 * really will reach that threshold. That is left **on** here, because a party
 * outliving a thirty-second network blip is exactly what a player wants — but it
 * is left on *knowingly*, and the panel shows the connection state, so a party
 * that is quietly retrying does not look like a party that is fine.
 */
import { CONTENT_VERSION } from "@carry-or-fall/game-content";
import {
  CANCEL_QUEUE_MESSAGE_TYPE,
  isPartyStatus,
  LEAVE_PARTY_MESSAGE_TYPE,
  MATCH_READY_MESSAGE_TYPE,
  PARTY_ERROR_MESSAGE_TYPE,
  PARTY_ROOM,
  type PartyJoinOptions,
  type PartyMemberView,
  type PartyRoomState,
  type PartyView,
  PROTOCOL_VERSION,
  QUEUE_MATCH_MESSAGE_TYPE,
  REFRESH_JOIN_CODE_MESSAGE_TYPE,
  type SeatReservationPayload,
  validatePartyErrorMessage,
  validateSeatReservationMessage,
} from "@carry-or-fall/protocol";
import { Client, type Room } from "@colyseus/sdk";

type PartyRoomHandle = Room<unknown, PartyRoomState>;

export type PartyConnectionState = "idle" | "connecting" | "connected" | "error";

export interface PartyJoinRequest {
  readonly serverUrl: string;
  readonly buildVersion: string;
  readonly skillLoadoutIds: readonly string[];
  readonly accessToken: string | null;
  /** `null` creates a party; a code joins one. */
  readonly joinCode: string | null;
}

/** Turn the synchronized party state into a plain snapshot the scene renders. */
export function toPartyView(state: PartyRoomState): PartyView {
  const members: PartyMemberView[] = [];
  state.members.forEach((member) => {
    members.push({ ...member });
  });
  return {
    joinCode: state.joinCode,
    leaderSessionId: state.leaderSessionId,
    status: isPartyStatus(state.status) ? state.status : "forming",
    joinCodeExpiresInMs: state.joinCodeExpiresInMs,
    members,
  };
}

export class PartyConnection {
  private room: PartyRoomHandle | null = null;
  private state: PartyConnectionState = "idle";
  private view: PartyView | null = null;
  private message: string | null = null;
  private seat: SeatReservationPayload | null = null;

  getState(): PartyConnectionState {
    return this.state;
  }

  /** The party as it currently stands, or `null` when not in one. */
  getParty(): PartyView | null {
    return this.view;
  }

  /** This client's own session id inside the party room, or `null`. */
  getSessionId(): string | null {
    return this.room?.sessionId ?? null;
  }

  isLeader(): boolean {
    const sessionId = this.getSessionId();
    return sessionId !== null && this.view?.leaderSessionId === sessionId;
  }

  /** The most recent refusal or status message, for the panel to show. */
  getMessage(): string | null {
    return this.message;
  }

  /**
   * The seat this member has been given in a match, if one has arrived.
   *
   * Consumed with {@link takeSeat} rather than read repeatedly: the reservation
   * is single-use on the server, so handing the same one to two scene starts
   * would put the second in a state Colyseus has already retired.
   */
  hasSeat(): boolean {
    return this.seat !== null;
  }

  takeSeat(): SeatReservationPayload | null {
    const seat = this.seat;
    this.seat = null;
    return seat;
  }

  /** Create a party (no code) or join one (a code). Replaces any current party. */
  async open(request: PartyJoinRequest): Promise<void> {
    await this.leave();
    this.state = "connecting";
    this.message = null;

    const client = new Client(request.serverUrl);
    const options: PartyJoinOptions = {
      protocolVersion: PROTOCOL_VERSION,
      contentVersion: CONTENT_VERSION,
      buildVersion: request.buildVersion,
      skillLoadoutIds: [...request.skillLoadoutIds],
      accessToken: request.accessToken,
      // Always present, never omitted: an absent `joinCode` is an empty
      // matchmaking filter, which would match a stranger's party. The server
      // refuses that payload, and this is the client half of not sending it.
      joinCode: request.joinCode,
    };

    try {
      const room =
        request.joinCode === null
          ? await client.create<PartyRoomState>(PARTY_ROOM, { ...options })
          : await client.join<PartyRoomState>(PARTY_ROOM, { ...options });
      this.bind(room);
      this.state = "connected";
    } catch (error) {
      this.state = "error";
      // The server's own refusal text, which says what to do rather than what
      // went wrong (`docs/DECISIONS.md` D56).
      this.message = error instanceof Error ? error.message : String(error);
      throw error;
    }
  }

  private bind(room: PartyRoomHandle): void {
    this.room = room;

    room.onStateChange((state) => {
      this.view = toPartyView(state);
    });

    room.onMessage(MATCH_READY_MESSAGE_TYPE, (message: unknown) => {
      // The server built it, but the client *acts* on it — it opens a socket to
      // the room id inside — so it is validated before it is used.
      const result = validateSeatReservationMessage(message);
      if (result.ok) {
        this.seat = result.value;
        this.message = null;
      } else {
        this.message = "The server sent a match invitation this build cannot read.";
      }
    });

    room.onMessage(PARTY_ERROR_MESSAGE_TYPE, (message: unknown) => {
      const result = validatePartyErrorMessage(message);
      this.message = result.ok ? result.value.message : "Your party action was refused.";
    });

    room.onLeave(() => {
      // Either a deliberate leave, or the SDK's automatic reconnection has run
      // out of attempts. Either way the party is over as far as this client is
      // concerned, and the panel says so rather than showing a stale roster.
      this.room = null;
      this.view = null;
      this.seat = null;
      this.state = "idle";
    });

    room.onError((code, text) => {
      this.state = "error";
      this.message = text ?? `party error ${String(code)}`;
    });
  }

  /** Ask the server to seat the whole party into one match. Leader only; the server checks. */
  queueMatch(): void {
    this.room?.send(QUEUE_MATCH_MESSAGE_TYPE, {});
  }

  cancelQueue(): void {
    this.room?.send(CANCEL_QUEUE_MESSAGE_TYPE, {});
  }

  refreshJoinCode(): void {
    this.room?.send(REFRESH_JOIN_CODE_MESSAGE_TYPE, {});
  }

  async leave(): Promise<void> {
    const room = this.room;
    this.room = null;
    this.view = null;
    this.seat = null;
    this.state = "idle";
    this.message = null;
    if (room === null) {
      return;
    }
    room.send(LEAVE_PARTY_MESSAGE_TYPE, {});
    await room.leave(true).catch(() => undefined);
  }
}

/**
 * The one party connection this tab has.
 *
 * A module-level singleton rather than a scene field, for the reason in the
 * module doc: a party must outlive the scene that created it.
 */
export const partyConnection = new PartyConnection();
