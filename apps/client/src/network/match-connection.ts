/**
 * The client's half of the room boundary (M4.7, `docs/M4_ISSUES.md`).
 *
 * Through M3 the client called `stepSimulation` directly; this module replaces
 * that call. It joins the authoritative match room, converts each synchronized
 * patch into a plain {@link MatchView} snapshot, keeps the two most recent so
 * the renderer can interpolate between them (technical plan §11.1), forwards
 * input intent at no more than 20 messages per second (§9.1), and receives this
 * player's own private state.
 *
 * It decides nothing. Every value it exposes was computed by the server; the
 * only things travelling the other way are which keys are held, where the
 * pointer is, and which inventory slot the player asked about.
 */
import {
  CONTENT_VERSION,
  type LootDefinition,
  type SkillDefinition,
  ALL_LOOT,
  ALL_SKILLS,
} from "@carry-or-fall/game-content";
import {
  DISCARD_ITEM_MESSAGE_TYPE,
  INPUT_MESSAGE_TYPE,
  isMatchPhase,
  type LocalPlayerState,
  MATCH_ROOM,
  type MatchJoinOptions,
  type MatchRoomState,
  type MatchView,
  type InputMessage,
  PRIVATE_STATE_MESSAGE_TYPE,
  PROTOCOL_VERSION,
  SECURE_ITEM_MESSAGE_TYPE,
  type SyncedCollection,
} from "@carry-or-fall/protocol";
import { Client, type Room } from "@colyseus/sdk";

/**
 * The SDK types a room by its server-room type first and its state second; this
 * client has no compile-time handle on the server class, so the room type is
 * left open and only the state — the half the client actually reads — is fixed.
 */
type MatchRoomHandle = Room<unknown, MatchRoomState>;

/**
 * What the player is currently doing, as far as the connection knows.
 * `reconnecting` is the technical plan §34.1 window during which the server is
 * still holding this player's body in the match.
 */
export type MatchStatus = "connecting" | "connected" | "reconnecting" | "disconnected" | "failed";

export interface MatchConnectionOptions {
  readonly serverUrl: string;
  readonly buildVersion: string;
  /** The pre-run skill selection, validated locally and re-validated by the server at join. */
  readonly skillLoadoutIds: readonly string[];
}

export interface MatchConnectionCallbacks {
  onStatusChange(status: MatchStatus, detail?: string): void;
}

/** Technical plan §9.1: "client input messages: capped at 20 per second". */
const MIN_INPUT_INTERVAL_MS = 50;

/** Colyseus's default patch rate, and this server's tick — how far apart snapshots arrive. */
const EXPECTED_SNAPSHOT_INTERVAL_MS = 50;

/** One reconnection attempt, matching the server's short window (technical plan §34.1). */
const RECONNECT_ATTEMPTS = 1;

function collect<T>(collection: SyncedCollection<T>, map: (entry: T) => T): T[] {
  const items: T[] = [];
  collection.forEach((entry) => {
    items.push(map(entry));
  });
  return items;
}

/**
 * Copy the synchronized state into a plain, frozen-in-time snapshot. Colyseus
 * mutates its own state objects in place as patches arrive, so rendering
 * directly from them would mean the "previous" snapshot silently becomes the
 * current one — and interpolation would have nothing to interpolate between.
 */
export function toMatchView(state: MatchRoomState): MatchView {
  return {
    phase: isMatchPhase(state.phase) ? state.phase : "waiting",
    arenaId: state.arenaId,
    serverBuildVersion: state.serverBuildVersion,
    seed: state.seed,
    tick: state.tick,
    countdownRemainingMs: state.countdownRemainingMs,
    matchRemainingMs: state.matchRemainingMs,
    players: collect(state.players, (player) => ({ ...player })),
    enemies: collect(state.enemies, (enemy) => ({ ...enemy })),
    projectiles: collect(state.projectiles, (projectile) => ({ ...projectile })),
    groundLoot: collect(state.groundLoot, (loot) => ({ ...loot })),
    skillChips: collect(state.skillChips, (chip) => ({ ...chip })),
    extractionPoints: collect(state.extractionPoints, (point) => ({ ...point })),
  };
}

/** Resolve a loot content id the server sent. Returns `undefined` for an id this build does not know. */
export function findLoot(lootId: string): LootDefinition | undefined {
  return ALL_LOOT.find((loot) => loot.id === lootId);
}

/** Resolve a skill content id the server sent. */
export function findSkill(skillId: string): SkillDefinition | undefined {
  return ALL_SKILLS.find((skill) => skill.id === skillId);
}

export class MatchConnection {
  private room: MatchRoomHandle | null = null;
  private status: MatchStatus = "connecting";
  private latest: MatchView | null = null;
  private previous: MatchView | null = null;
  private latestReceivedAt = 0;
  private privateState: LocalPlayerState | null = null;
  private lastInputSentAt = 0;
  private lastInputSent: string | null = null;
  private sequence = 0;
  private leaving = false;

  private constructor(private readonly callbacks: MatchConnectionCallbacks) {}

  /**
   * Join the match room. Rejects if the server refuses the join — an
   * incompatible protocol or content version, or an illegal skill loadout — and
   * the caller surfaces the server's message (technical plan §35).
   */
  static async join(
    options: MatchConnectionOptions,
    callbacks: MatchConnectionCallbacks,
  ): Promise<MatchConnection> {
    const connection = new MatchConnection(callbacks);
    await connection.open(options);
    return connection;
  }

  private async open(options: MatchConnectionOptions): Promise<void> {
    this.setStatus("connecting");
    const client = new Client(options.serverUrl);
    const joinOptions: MatchJoinOptions = {
      protocolVersion: PROTOCOL_VERSION,
      contentVersion: CONTENT_VERSION,
      buildVersion: options.buildVersion,
      skillLoadoutIds: [...options.skillLoadoutIds],
    };

    try {
      const room: MatchRoomHandle = await client.joinOrCreate<MatchRoomState>(MATCH_ROOM, {
        ...joinOptions,
      });
      this.bind(client, room);
      this.setStatus("connected");
    } catch (error) {
      this.setStatus("failed", toDetail(error));
      throw error;
    }
  }

  private bind(client: Client, room: MatchRoomHandle): void {
    this.room = room;

    room.onStateChange((state) => {
      this.previous = this.latest;
      this.latest = toMatchView(state);
      this.latestReceivedAt = performance.now();
    });

    room.onMessage(PRIVATE_STATE_MESSAGE_TYPE, (message: LocalPlayerState) => {
      // Addressed to this client alone; no other player's inventory is ever in
      // the synchronized state to begin with (technical plan §10.3).
      this.privateState = message;
    });

    room.onError((code, message) => {
      this.setStatus("failed", `server error ${String(code)}${message ? `: ${message}` : ""}`);
    });

    room.onLeave((code) => {
      if (this.leaving) {
        this.setStatus("disconnected", `left (code ${String(code)})`);
        return;
      }
      // The server holds this player in the match for a short window
      // (technical plan §34.1) — during which they are stationary and still
      // vulnerable — so one reconnection attempt is worth making.
      void this.attemptReconnect(client, room.reconnectionToken);
    });
  }

  private async attemptReconnect(client: Client, token: string): Promise<void> {
    this.setStatus("reconnecting");
    for (let attempt = 0; attempt < RECONNECT_ATTEMPTS; attempt += 1) {
      try {
        const room: MatchRoomHandle = await client.reconnect<MatchRoomState>(token);
        this.bind(client, room);
        this.setStatus("connected");
        return;
      } catch (error) {
        this.setStatus("disconnected", toDetail(error));
      }
    }
  }

  private setStatus(status: MatchStatus, detail?: string): void {
    this.status = status;
    this.callbacks.onStatusChange(status, detail);
  }

  getStatus(): MatchStatus {
    return this.status;
  }

  /** This client's own player id, or `null` before the room has assigned one. */
  getLocalPlayerId(): string | null {
    return this.room?.sessionId ?? null;
  }

  /** The most recent authoritative snapshot, or `null` before the first patch arrives. */
  getSnapshot(): MatchView | null {
    return this.latest;
  }

  /** The snapshot before {@link getSnapshot}, for interpolation. `null` until two have arrived. */
  getPreviousSnapshot(): MatchView | null {
    return this.previous;
  }

  /**
   * How far between {@link getPreviousSnapshot} and {@link getSnapshot} the
   * renderer should currently be, in `[0, 1]`. Clamped at 1 so a late patch
   * holds the last authoritative position rather than extrapolating past it —
   * the client never invents a position the server has not sent (technical plan
   * §11.1: interpolation, not prediction).
   */
  getInterpolationAlpha(now: number): number {
    if (this.latest === null) {
      return 1;
    }
    return Math.min(1, Math.max(0, (now - this.latestReceivedAt) / EXPECTED_SNAPSHOT_INTERVAL_MS));
  }

  /** This player's private state (inventory, secure slot, skills, run result), or `null` before it arrives. */
  getPrivateState(): LocalPlayerState | null {
    return this.privateState;
  }

  /**
   * Send input intent, at most 20 times a second (technical plan §9.1). An
   * unchanged payload is skipped: the server holds the latest valid input and
   * re-applies it every tick until a newer one arrives (§9.3), so resending an
   * identical one changes nothing.
   */
  sendInput(input: Omit<InputMessage, "sequence">, now: number): void {
    if (this.room === null || now - this.lastInputSentAt < MIN_INPUT_INTERVAL_MS) {
      return;
    }
    const fingerprint = JSON.stringify(input);
    if (fingerprint === this.lastInputSent) {
      return;
    }
    this.lastInputSentAt = now;
    this.lastInputSent = fingerprint;
    this.sequence += 1;
    const message: InputMessage = { ...input, sequence: this.sequence };
    this.room.send(INPUT_MESSAGE_TYPE, message);
  }

  /** Ask the server to move an inventory slot into the secure slot (technical plan §14.2). */
  sendSecureItem(sourceSlot: number): void {
    this.room?.send(SECURE_ITEM_MESSAGE_TYPE, { sourceSlot });
  }

  /** Ask the server to discard an inventory slot. */
  sendDiscardItem(sourceSlot: number): void {
    this.room?.send(DISCARD_ITEM_MESSAGE_TYPE, { sourceSlot });
  }

  /** Leave deliberately: the server frees the seat immediately instead of holding a reconnect window. */
  async leave(): Promise<void> {
    this.leaving = true;
    await this.room?.leave(true);
    this.room = null;
  }
}

function toDetail(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
