/**
 * Shared client/server payload shapes.
 *
 * At join time the only thing a client tells the server is who it is and what
 * it chose before the match: the version handshake plus its pre-run skill
 * loadout, supplied as Colyseus *join options* so the server can refuse an
 * incompatible or illegal client before it ever occupies a seat (technical plan
 * §35; `docs/M4_ISSUES.md` §1.5).
 *
 * After joining, a client sends only intent (§2 below). The read models at the
 * bottom of this file describe what flows the other way: a **public**
 * {@link MatchView}, synchronized to every client, and a **private**
 * {@link LocalPlayerState}, sent only to its owner. They are separate types on
 * purpose — technical plan §10.3 requires filtering private data, and keeping
 * inventory out of the public type makes "a remote player has no inventory" a
 * fact the compiler knows rather than a rule a renderer has to remember.
 */

/**
 * Version handshake the client supplies as Colyseus join options. It reports only
 * information the client legitimately owns; the server never trusts a client for
 * anything beyond identifying its version. The server validates this at the join
 * boundary and rejects a malformed or incompatible client.
 *
 * `contentVersion` activated in M4 (`docs/DECISIONS.md` D34) — it was reserved
 * while there was no content whose disagreement could matter.
 */
export interface ClientHandshake {
  readonly protocolVersion: number;
  readonly contentVersion: number;
  readonly buildVersion: string;
}

/**
 * The full join-options payload for the match room: the handshake plus the
 * player's pre-run permanent skill selection (concept §8.3, chosen "before
 * entering the match").
 *
 * The loadout arrives at join rather than as a post-join message because the
 * match starts together and late join is disabled (technical plan §8.3), so
 * there is exactly one moment at which it can be chosen. The ids are untrusted
 * strings: the server re-validates them through the same `createSkillLoadout`
 * the client's picker uses, and refuses the join if they are illegal.
 */
export interface MatchJoinOptions extends ClientHandshake {
  readonly skillLoadoutIds: readonly string[];
  /**
   * The Supabase access token from the client's anonymous (or linked) session
   * (M5, technical plan §17.1). **This is the only thing the server accepts as
   * identity** — a client never sends a user id, because an id it could send is
   * an id it could choose.
   *
   * `null` when the client has no session, which happens only where no Supabase
   * project is configured (a fresh clone, CI, the browser suite). A server that
   * *is* configured refuses a null or unverifiable token at the join boundary
   * (`docs/DECISIONS.md` D45).
   *
   * Validation splits in two by necessity: this package bounds the *shape* (a
   * non-empty string under a length cap), and only Supabase Auth can judge
   * *authenticity*. Neither check is sufficient alone, and the server runs both.
   */
  readonly accessToken: string | null;
}

/**
 * Read model of the synchronized foundation-room state. This mirrors the fields
 * of the server-side Colyseus schema so the client can type `room.state` without
 * depending on `@colyseus/schema`. The server remains the sole authority over
 * these values; the client only ever reads them.
 */
export interface FoundationRoomState {
  readonly serverBuildVersion: string;
  readonly connectedPlayers: number;
}

/* ------------------------------------------------------------------ *
 * 1. Client → server message types
 * ------------------------------------------------------------------ */

/**
 * Message-type identifier for {@link InputMessage} (docs/PROTOCOL.md §6). M1
 * consumed it in-process; M4 makes it the authoritative wire message, validated
 * by `validateInputMessage` before any field is read.
 */
export const INPUT_MESSAGE_TYPE = "input";

/** Message-type identifier for {@link SecureItemMessage} (technical plan §14.2). */
export const SECURE_ITEM_MESSAGE_TYPE = "secure_item";

/** Message-type identifier for {@link DiscardItemMessage}. */
export const DISCARD_ITEM_MESSAGE_TYPE = "discard_item";

/**
 * Player input intent, matching docs/PROTOCOL.md §6 and the technical plan
 * §10.2 shape. The client reports only intent — which keys are held, where the
 * player aims, which actions were requested — never an outcome (see
 * `docs/DEVELOPMENT_RULES.md`, "Architecture and authority"). There is
 * deliberately no field on this type, or on any other, capable of expressing a
 * position, a damage number, a pickup, an extraction, or a reward.
 *
 * `secondaryAttackPressed` (the bow trigger) is folded in here rather than sent
 * as its own message, which `docs/PROTOCOL.md` §6's message table already
 * permits for discrete attack intents: it is a held-button state sampled every
 * tick, exactly like `attackPressed`.
 *
 * `sequence` is a per-client monotonic counter. The server drops any input
 * whose sequence does not strictly increase, which makes a replayed or
 * reordered packet inert (technical plan §10.2, "sequence order").
 */
export interface InputMessage {
  readonly sequence: number;
  readonly moveX: -1 | 0 | 1;
  readonly moveY: -1 | 0 | 1;
  readonly aimAngle: number;
  readonly attackPressed: boolean;
  readonly secondaryAttackPressed: boolean;
  readonly dashPressed: boolean;
  readonly interactPressed: boolean;
}

/**
 * Request to move the item in `sourceSlot` into the secure slot — the technical
 * plan §14.2 shape exactly. A one-shot command, sent on the keypress rather
 * than folded into the 20-per-second input message, so it is not resent every
 * tick while the key is held.
 *
 * The client names a *slot index*, never an item: it does not own the inventory
 * and cannot assert what is in it. The server checks the player is alive, the
 * slot holds something, and the secure slot is empty (§14.2), and refuses
 * otherwise.
 */
export interface SecureItemMessage {
  readonly sourceSlot: number;
}

/** Request to discard the item in `sourceSlot` (concept §7.1, "can be discarded"). */
export interface DiscardItemMessage {
  readonly sourceSlot: number;
}

/* ------------------------------------------------------------------ *
 * 2. Server → client: the public synchronized read model
 * ------------------------------------------------------------------ */

/**
 * Message-type identifier for the per-owner private-state message. Sent only to
 * the client it describes, and only when that state changes.
 */
export const PRIVATE_STATE_MESSAGE_TYPE = "player_private";

/** Room lifecycle phase (technical plan §8.2), surfaced so the client can show what the match is doing. */
export type MatchPhase = "waiting" | "countdown" | "running" | "ending";

const MATCH_PHASES: readonly string[] = ["waiting", "countdown", "running", "ending"];

/**
 * Narrow a phase string read out of synchronized state. The value crosses a
 * network boundary, so it is checked before it is trusted — even though the
 * server is the one that wrote it.
 */
export function isMatchPhase(value: unknown): value is MatchPhase {
  return typeof value === "string" && MATCH_PHASES.includes(value);
}

/**
 * The public view of one player — technical plan §10.3's list, minus everything
 * private. Every client receives one of these per player in the room.
 * `extractionProgressMs` is public because concept §17.2 wants extraction to
 * "notify nearby players".
 *
 * The in-flight melee swing is flattened into `swing*` fields rather than a
 * nested object, so this interface is exactly the shape of the synchronized
 * schema and no lossy conversion sits between the two.
 * `swingRangePx`/`swingArcDegrees` are the *effective*, post-skill, post-loot
 * values the server actually resolved hits against, so the arc a player sees
 * drawn is the arc that hit (technical plan §13.2).
 */
export interface PlayerView {
  readonly id: string;
  readonly x: number;
  readonly y: number;
  readonly radius: number;
  readonly facing: number;
  readonly health: number;
  readonly maxHealth: number;
  readonly shieldHp: number;
  readonly alive: boolean;
  /** True once this player's run has ended (died or extracted); they are inert. */
  readonly runOver: boolean;
  /** False while the player is disconnected but still occupying the room (technical plan §34.1). */
  readonly connected: boolean;
  readonly extractionProgressMs: number;
  /** Whether a melee swing is in its active (hit-resolving, drawn) window right now. */
  readonly swingActive: boolean;
  readonly swingOriginX: number;
  readonly swingOriginY: number;
  readonly swingFacing: number;
  readonly swingRangePx: number;
  readonly swingArcDegrees: number;
}

export interface EnemyView {
  readonly id: string;
  readonly x: number;
  readonly y: number;
  readonly radius: number;
  readonly health: number;
  readonly maxHealth: number;
  readonly stunnedMs: number;
}

/**
 * A live projectile. Carries the four skill-behavior fields the renderer turns
 * into its visual cues (`apps/client/src/render/world-view.ts`), because
 * concept §13.3 requires those behaviors to stay distinguishable.
 */
export interface ProjectileView {
  readonly id: string;
  readonly ownerId: string;
  readonly x: number;
  readonly y: number;
  readonly velocityX: number;
  readonly velocityY: number;
  readonly radius: number;
  readonly bouncesRemaining: number;
  readonly piercesRemaining: number;
  readonly canReturn: boolean;
  readonly returnsSoFar: number;
  readonly homingStrength: number;
}

/** Ground loot. `lootId` is a content id the client looks up locally — a definition, not authority. */
export interface GroundLootView {
  readonly id: string;
  readonly x: number;
  readonly y: number;
  readonly radius: number;
  readonly lootId: string;
}

/** A wildcard skill chip. `skillId` is a content id, like {@link GroundLootView.lootId}. */
export interface SkillChipView {
  readonly id: string;
  readonly x: number;
  readonly y: number;
  readonly radius: number;
  readonly skillId: string;
}

export interface ExtractionPointView {
  readonly id: string;
  readonly x: number;
  readonly y: number;
  readonly radius: number;
  readonly remainingActiveMs: number;
}

/**
 * A synchronized keyed collection, as the Colyseus client SDK decodes it. This
 * is the read side of the server's `MapSchema`, described structurally so the
 * browser client can type `room.state` without importing `@colyseus/schema`
 * (the same approach {@link FoundationRoomState} already takes for scalars).
 */
export interface SyncedCollection<T> {
  readonly size: number;
  forEach(callback: (value: T, key: string) => void): void;
  get(key: string): T | undefined;
  has(key: string): boolean;
  keys(): IterableIterator<string>;
  values(): IterableIterator<T>;
}

/**
 * Read model of the synchronized match-room state — the mirror of the server's
 * `MatchState` schema. `phase` is typed `string` rather than {@link MatchPhase}
 * because that is genuinely what the wire carries; narrow it with
 * {@link isMatchPhase} at the boundary.
 */
export interface MatchRoomState {
  readonly phase: string;
  readonly arenaId: string;
  readonly serverBuildVersion: string;
  readonly seed: number;
  readonly tick: number;
  readonly countdownRemainingMs: number;
  readonly matchRemainingMs: number;
  readonly players: SyncedCollection<PlayerView>;
  readonly enemies: SyncedCollection<EnemyView>;
  readonly projectiles: SyncedCollection<ProjectileView>;
  readonly groundLoot: SyncedCollection<GroundLootView>;
  readonly skillChips: SyncedCollection<SkillChipView>;
  readonly extractionPoints: SyncedCollection<ExtractionPointView>;
}

/**
 * One authoritative snapshot of the match, as the client sees it. Built from
 * {@link MatchRoomState}; the client renders it and never steps it.
 *
 * `arenaId` names the `ArenaDefinition` in `@carry-or-fall/game-content` whose
 * walls both ends draw and collide against — shared *definitions*, with
 * authority staying on the server (technical plan §7.1). `seed` is published
 * for diagnostics; §9.4 already records the seed with match results, and it only
 * determines placements the players can see.
 */
export interface MatchView {
  readonly phase: MatchPhase;
  readonly arenaId: string;
  readonly serverBuildVersion: string;
  readonly seed: number;
  readonly tick: number;
  /** Milliseconds left in the lobby countdown; 0 outside the `countdown` phase. */
  readonly countdownRemainingMs: number;
  /** Milliseconds left in the match (concept §22.3's maximum duration). */
  readonly matchRemainingMs: number;
  readonly players: readonly PlayerView[];
  readonly enemies: readonly EnemyView[];
  readonly projectiles: readonly ProjectileView[];
  readonly groundLoot: readonly GroundLootView[];
  readonly skillChips: readonly SkillChipView[];
  readonly extractionPoints: readonly ExtractionPointView[];
}

/* ------------------------------------------------------------------ *
 * 3. Server → client: the private, per-owner read model
 * ------------------------------------------------------------------ */

/** The five progression point categories (concept §6), as they cross the wire. */
export interface PointTotalsPayload {
  readonly force: number;
  readonly precision: number;
  readonly motion: number;
  readonly guard: number;
  readonly signal: number;
}

/**
 * The outcome of one player's finished run. Computed once by the server when
 * the run ends and never recomputed. Not persisted anywhere in M4 — there is no
 * storage until M5 (`docs/DECISIONS.md` D9, D22, D27).
 */
export interface RunResultPayload {
  readonly outcome: "extracted" | "died";
  readonly pointsGained: PointTotalsPayload;
  readonly itemsConverted: number;
  readonly itemsLost: number;
}

/**
 * Message-type identifier for the per-owner settlement result (M5). Sent to one
 * client after their finished run has been **written**, so receiving it means
 * the points are in the account, not that the server intends to put them there.
 */
export const SETTLEMENT_MESSAGE_TYPE = "settlement";

/**
 * What a player's account looks like after their run was settled (M5,
 * `docs/DATA_MODEL.md` §4.3). Server → client only; there is no client → server
 * counterpart, and that absence is the point — no message a client can send
 * carries a point value, an unlock, or an outcome, so there is no reward claim
 * for the server to check (`docs/DATA_MODEL.md` §6).
 *
 * `alreadySettled` is honest rather than cosmetic: a retry or a recovery that
 * found the run already settled awards nothing, and the client says "already
 * recorded" instead of animating a second payout for points it did not just
 * earn.
 */
export interface SettlementMessage {
  readonly alreadySettled: boolean;
  readonly balances: PointTotalsPayload;
  /** Every unlock id the account holds after this settlement. */
  readonly unlockIds: readonly string[];
  /** Only the ids this settlement newly granted; empty on a repeat. */
  readonly newUnlockIds: readonly string[];
  /** Whether this account is anonymous, and therefore unrecoverable (technical plan §17.3). */
  readonly isAnonymous: boolean;
}

/**
 * Everything about a player that only that player may see (technical plan
 * §10.3: "other clients do not need to receive another player's complete
 * inventory"). Delivered as a {@link PRIVATE_STATE_MESSAGE_TYPE} message to one
 * client, and deliberately **absent from the synchronized schema entirely**, so
 * there is no filtering rule to get wrong — the data is never in the document
 * other clients receive.
 *
 * Items and skills are content ids, resolved locally against
 * `@carry-or-fall/game-content` for display. `inventory` is a fixed-length
 * array whose `null` entries are empty slots.
 */
export interface LocalPlayerState {
  readonly playerId: string;
  readonly inventory: readonly (string | null)[];
  readonly secureSlotItemId: string | null;
  readonly skillIds: readonly string[];
  readonly wildcardSkillId: string | null;
  readonly runResult: RunResultPayload | null;
}
