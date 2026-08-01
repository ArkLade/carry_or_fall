/**
 * Synchronized state for the match room (M4.4, `docs/M4_ISSUES.md`). The server
 * is the sole authority over every field here; clients only ever read them.
 *
 * **This schema contains public data only.** Inventory, secure slot, skill
 * loadout, wildcard skill, and run result are deliberately absent: technical
 * plan §10.3 requires private player data to be filtered, and the way this
 * codebase filters it is by never putting it in the document every client
 * receives. Each client gets its own copy of that state as a
 * `player_private` message instead (`private-state.ts`). There is no filtering
 * rule here to misconfigure.
 *
 * Uses the decorator-free `schema()` form from `@colyseus/schema` v4 so the
 * project needs no `experimentalDecorators` compiler setting, matching
 * `FoundationState`. Entities are keyed maps rather than arrays so the
 * reconciler (`match-sync.ts`) can update one entity in place by id and let
 * Colyseus encode a delta, instead of resending a collection every tick.
 */
import { schema, type SchemaType } from "@colyseus/schema";

/**
 * One player, as everyone in the room sees them (technical plan §10.3's list).
 *
 * The melee swing is flattened into `swing*` fields rather than a nullable
 * child schema: it is read every frame by the renderer and changes constantly,
 * so a handful of primitives is cheaper to encode than a child reference whose
 * lifetime tracks a 120 ms window. `swingRangePx`/`swingArcDegrees` are the
 * *effective*, post-skill, post-loot values the server actually resolved hits
 * against, so the arc a player sees drawn is the arc that hit.
 */
export const PlayerState = schema({
  id: "string",
  x: "number",
  y: "number",
  radius: "number",
  facing: "number",
  health: "number",
  maxHealth: "number",
  shieldHp: "number",
  alive: "boolean",
  /** True once this player's run has ended (died or extracted); they are inert. */
  runOver: "boolean",
  /** False while the player is disconnected but still occupying the room (technical plan §34.1). */
  connected: "boolean",
  /** Public so extraction "notifies nearby players" (concept §17.2). */
  extractionProgressMs: "number",
  swingActive: "boolean",
  swingOriginX: "number",
  swingOriginY: "number",
  swingFacing: "number",
  swingRangePx: "number",
  swingArcDegrees: "number",
});
export type PlayerStateType = SchemaType<typeof PlayerState>;

export const EnemyState = schema({
  id: "string",
  x: "number",
  y: "number",
  radius: "number",
  health: "number",
  maxHealth: "number",
  stunnedMs: "number",
});
export type EnemyStateType = SchemaType<typeof EnemyState>;

/**
 * A live projectile. Carries the four skill-behavior fields the renderer turns
 * into its visual cues, because concept §13.3 requires bounce, pierce, return,
 * and homing to stay distinguishable at a glance.
 */
export const ProjectileState = schema({
  id: "string",
  ownerId: "string",
  x: "number",
  y: "number",
  velocityX: "number",
  velocityY: "number",
  radius: "number",
  bouncesRemaining: "number",
  piercesRemaining: "number",
  canReturn: "boolean",
  returnsSoFar: "number",
  homingStrength: "number",
});
export type ProjectileStateType = SchemaType<typeof ProjectileState>;

/** Ground loot. `lootId` is a content id every client resolves locally — a shared definition, not authority. */
export const GroundLootState = schema({
  id: "string",
  x: "number",
  y: "number",
  radius: "number",
  lootId: "string",
});
export type GroundLootStateType = SchemaType<typeof GroundLootState>;

export const SkillChipState = schema({
  id: "string",
  x: "number",
  y: "number",
  radius: "number",
  skillId: "string",
});
export type SkillChipStateType = SchemaType<typeof SkillChipState>;

export const ExtractionPointState = schema({
  id: "string",
  x: "number",
  y: "number",
  radius: "number",
  remainingActiveMs: "number",
});
export type ExtractionPointStateType = SchemaType<typeof ExtractionPointState>;

/**
 * The whole synchronized match. `arenaId` names the `ArenaDefinition` in
 * `@carry-or-fall/game-content` whose walls both ends use, so the static
 * geometry is not re-sent every match. `seed` is published for diagnostics —
 * technical plan §9.4 already records the seed with match results, and it only
 * decides placements the players can see.
 */
export const MatchState = schema({
  /** One of `MatchPhase` (technical plan §8.2's lifecycle). */
  phase: "string",
  arenaId: "string",
  serverBuildVersion: "string",
  seed: "number",
  tick: "number",
  countdownRemainingMs: "number",
  matchRemainingMs: "number",
  players: { map: PlayerState },
  enemies: { map: EnemyState },
  projectiles: { map: ProjectileState },
  groundLoot: { map: GroundLootState },
  skillChips: { map: SkillChipState },
  extractionPoints: { map: ExtractionPointState },
});
export type MatchStateType = SchemaType<typeof MatchState>;
