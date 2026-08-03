/**
 * Core world/entity types. M1 shipped movement, map collision, aim, the
 * shared attack pipeline (sword + bow), the chaser enemy, health/death, and
 * dash (`docs/M1_EXECUTION_PLAN.md` §3). M2 adds the inventory, secure slot,
 * ground loot, rotating extraction, and the run result (`docs/M2_ISSUES.md`);
 * M3 adds skills, the wildcard chip, stun, and the shield.
 *
 * M4 makes the world **multi-player** (`docs/M4_ISSUES.md` §1.1). Through M3
 * this file declared the opposite — "`World` holds exactly one `player`, not a
 * collection" — because there was no network and no other players. M4 puts this
 * same simulation behind an authoritative Colyseus room holding two to eight of
 * them, so `World.player` becomes `World.players`, `Player` gains an `id`, the
 * run result moves from the world to the player (extraction ends *that
 * player's* run, concept §17.1), and a `Projectile` records who fired it.
 *
 * Nothing else changed: every rule module (movement, collision, combat,
 * inventory, extraction, loot, skills) was already a pure function over one
 * actor plus world data, so none of them needed to know that there is now more
 * than one player.
 */
import type {
  EnemyDefinition,
  LootDefinition,
  SkillDefinition,
  WeaponDefinition,
} from "@carry-or-fall/game-content";

import type { Inventory, SecureSlot } from "./inventory";
import type { PointTotals } from "./points";
import type { Rng } from "./prng";
import type { SkillLoadout } from "./skill-loadout";

export type { Vec2 } from "./vec2";
import type { Vec2 } from "./vec2";

/**
 * The player's simulated body: a circle, per the collision strategy (technical
 * plan §12.1). Position is the circle's center. `facing` is the aim angle in
 * radians (M1.4), normalized to `(-π, π]`.
 *
 * The player carries both M1 weapons at once (no equip/inventory system
 * exists yet — see the client input-mapping note in `apps/client/src/scenes/
 * PlayScene.ts`), each with its own independent cooldown. `meleeAttack` is the
 * in-flight windup/active/recovery state of the currently-swinging sword, or
 * `null` when no swing is in progress.
 *
 * `alive` gates all further processing once health reaches zero (M1.10): a
 * dead player stops moving, aiming, attacking, and dashing, and the local run
 * is over (see `PlayScene`'s death handling).
 *
 * `inventory`/`secureSlot` (M2, concept §7) are the carried-loot state:
 * `inventory`'s `buildEffects` are aggregated into the player's active build
 * (`build-effects.ts`) and reflected in `maxHealth` each step; `secureSlot`
 * never contributes to the build. `extractionProgressMs` tracks an in-progress
 * extraction channel (`extraction.ts`), reset to `0` whenever it is
 * interrupted.
 *
 * `skillLoadout`/`wildcardSkill` (M3, concept §8.3/§10) are the skill state:
 * `skillLoadout` is the up-to-three permanent skills chosen before the run
 * (validated by `skill-loadout.ts`'s `createSkillLoadout`, never changes
 * in-run); `wildcardSkill` is the single temporary skill found mid-run (`null`
 * until a `SkillChip` is picked up), replaced freely and lost on death.
 * `shieldHp` (concept §9.2 "shield generation") is a capped pool that absorbs
 * damage before `health` (`skill-effects.ts`'s `applyDamageToPlayer`).
 *
 * `id` (M4) identifies this player within the world — on the server it is the
 * Colyseus session id, so it is server-generated and a client cannot choose or
 * spoof it (technical plan §33, "server-generated IDs"). `runResult` (M4, moved
 * off `World`) is `null` while this player's run is in progress; once set, by
 * their death or their extraction, that player is inert while everyone else
 * keeps playing.
 */
export interface Player {
  readonly id: string;
  readonly position: Vec2;
  readonly radius: number;
  readonly facing: number;
  readonly health: number;
  readonly maxHealth: number;
  readonly shieldHp: number;
  readonly alive: boolean;
  readonly meleeWeapon: WeaponDefinition;
  readonly rangedWeapon: WeaponDefinition;
  readonly meleeCooldownMs: number;
  readonly rangedCooldownMs: number;
  readonly meleeAttack: MeleeAttackState | null;
  readonly dashCooldownMs: number;
  readonly inventory: Inventory;
  readonly secureSlot: SecureSlot;
  readonly extractionProgressMs: number;
  readonly skillLoadout: SkillLoadout;
  readonly wildcardSkill: SkillDefinition | null;
  readonly runResult: RunResult | null;
}

/**
 * The in-flight state of one melee swing, tracked across simulation steps so
 * hit resolution happens only during the weapon's "active" window
 * (`combat/melee.ts`, M1.7). `ownerId` (M4) is the player whose swing it is, so
 * a landed hit can credit the right player's shield-on-hit skill when several
 * players are swinging in the same world.
 */
export interface MeleeAttackState {
  readonly ownerId: string;
  readonly weapon: WeaponDefinition;
  readonly origin: Vec2;
  readonly facing: number;
  readonly elapsedMs: number;
  readonly hasResolvedHits: boolean;
}

/**
 * A live ranged projectile (M1.8; bounce/pierce/return/homing added M3.4,
 * `docs/M3_ISSUES.md` M3.4). The base weapon still fires a plain
 * straight-line projectile (concept §29.2: bounce/pierce/return/homing are
 * skill effects, not base-weapon behavior) — these fields default to "no
 * effect" and are only ever seeded to something else by
 * `combat/ranged.ts`'s `startRangedAttack` from the attacker's aggregated
 * `SkillEffects`. `hitTargetIds` prevents a piercing projectile from hitting
 * the same target twice while still overlapping it. `canReturn`/
 * `returnsSoFar` are checked against `combat/caps.ts`'s
 * `canProjectileReturn` each time the projectile would otherwise expire, so
 * cap 4 (no more than one return) is exercised from real gameplay, not just
 * as a standalone function test. Split is not implemented
 * (`docs/M3_ISSUES.md` §1): no field or behavior for it exists.
 */
export interface Projectile {
  readonly id: string;
  /**
   * The player who fired it (M4). Two things depend on it: §13.4's cap 7 (the
   * active-projectile ceiling) is counted per owner, so eight players sharing
   * one world cannot collectively exceed a cap that was written per player; and
   * a landed hit credits that player's shield-on-hit skill rather than whoever
   * happens to be stepping.
   */
  readonly ownerId: string;
  readonly position: Vec2;
  readonly velocity: Vec2;
  readonly radius: number;
  readonly damage: number;
  readonly remainingLifespanMs: number;
  readonly bouncesRemaining: number;
  readonly piercesRemaining: number;
  readonly canReturn: boolean;
  readonly returnsSoFar: number;
  readonly homingStrength: number;
  readonly postBounceDamageMultiplier: number;
  readonly hitTargetIds: readonly string[];
  /**
   * How many children this projectile bursts into when a target consumes it
   * (M7, the `split_return` boss skill). Zero for every projectile fired
   * without it, which is every projectile in the game before a boss core is
   * activated or its unlock equipped.
   */
  readonly splitCount: number;
  /**
   * Whether this projectile *is* one of those children.
   *
   * The field technical plan §13.4's caps 5 and 6 were written for, and the
   * reason they sat unreachable from M1 to M6: a split child may not split
   * again, and may not return — return being the parent effect concept §9.5
   * forbids a child from creating. `combat/ranged.ts` gates both on this flag
   * through `combat/caps.ts`, so a hostile or mistaken projectile that claimed
   * `canReturn: true` while being a child is still refused.
   */
  readonly isSplitChild: boolean;
}

/**
 * A live enemy (M1.9): a circle, per the collision strategy, carrying the
 * stats copied from its `EnemyDefinition` (`@carry-or-fall/game-content`) at
 * spawn time. `contactCooldownMs` paces contact damage so touching the player
 * deals `contactDamage` periodically, not every single fixed step.
 * `stunnedMs` (M3.5, `stunning_blows`) counts down a stun applied by a melee
 * hit; while positive, `enemy.ts`'s `stepEnemyMovement` skips the chaser's
 * move-toward-player step (contact damage is unaffected by stun — a
 * deliberate scope choice, `docs/M3_ISSUES.md` M3.5).
 */
export interface Enemy {
  readonly id: string;
  readonly definitionId: string;
  readonly behavior: EnemyDefinition["behavior"];
  readonly position: Vec2;
  readonly radius: number;
  readonly health: number;
  readonly maxHealth: number;
  readonly moveSpeed: number;
  readonly contactDamage: number;
  readonly contactDamageIntervalMs: number;
  readonly contactCooldownMs: number;
  readonly stunnedMs: number;
}

/**
 * A static wall: an axis-aligned bounding box, per the collision strategy
 * (technical plan §12.1). `x`/`y` is the top-left corner.
 */
export interface Wall {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/**
 * A pickup-able loot item lying on the ground (M2.6, `docs/M2_ISSUES.md`):
 * either dropped by a dying enemy or scattered on the local test map at run
 * start. `radius` is the pickup radius, not a rendered collision body — loot
 * does not block movement.
 */
export interface GroundLoot {
  readonly id: string;
  readonly definition: LootDefinition;
  readonly position: Vec2;
  readonly radius: number;
}

/**
 * A pickup-able wildcard skill chip lying on the ground (M3.7, concept §10,
 * `docs/M3_ISSUES.md` M3.7): scattered on the local test map at run start,
 * exactly like M2.6's `GroundLoot`. Picking one up always replaces the
 * player's current `wildcardSkill` (concept §10: "a new chip may replace the
 * current one") — unlike loot pickup, there is no refusal case.
 */
export interface SkillChip {
  readonly id: string;
  readonly definition: SkillDefinition;
  readonly position: Vec2;
  readonly radius: number;
}

/**
 * One of the rotating extraction points (M2.7, concept §17). `id` is stable
 * across a rotation; only `position` changes when the point relocates, which
 * models "disappears...reopens elsewhere" as one point moving rather than a
 * separate open/closed state. `remainingActiveMs` counts down to the next
 * rotation.
 */
export interface ExtractionPoint {
  readonly id: string;
  readonly position: Vec2;
  readonly radius: number;
  readonly remainingActiveMs: number;
}

/**
 * The outcome of one player's finished run (M2.8, `docs/M2_ISSUES.md`): death
 * converts only the secure slot and drops the inventory; a successful
 * extraction converts both. Displayed once by that player's HUD; never
 * persisted (`docs/DECISIONS.md` D27 — still true in M4, which adds no
 * storage).
 */
export interface RunResult {
  readonly outcome: "extracted" | "died";
  readonly pointsGained: PointTotals;
  readonly itemsConverted: number;
  readonly itemsLost: number;
}

/**
 * Normalized input intent consumed by the simulation. This is intentionally a
 * variant of `@carry-or-fall/protocol`'s `InputMessage`, not an identical copy:
 * `moveX`/`moveY` (M1.3), `aimAngle`/`attackPressed` (M1.4/M1.6), and
 * `dashPressed` (M1.S1) match it directly (`interactPressed` also matches the
 * protocol shape, added there in M1 but unused until M2).
 * `secondaryAttackPressed`, `discardSlotIndex`, and `secureSlotIndex` have no
 * protocol counterpart — they are **local-only conveniences** (the same
 * treatment M1 gave `secondaryAttackPressed`): triggering the bow from the
 * second mouse button, and the discard/secure inventory controls
 * (`docs/M2_ISSUES.md` §1), while no real weapon-equip/inventory-network
 * system exists yet (that is later networked work, not M2's scope).
 * `discardSlotIndex`/`secureSlotIndex` are one-shot: `null` means "no request
 * this step", matching an edge-triggered keypress, not a held key.
 */
export interface InputState {
  readonly moveX: -1 | 0 | 1;
  readonly moveY: -1 | 0 | 1;
  readonly aimAngle: number;
  readonly attackPressed: boolean;
  readonly secondaryAttackPressed: boolean;
  readonly dashPressed: boolean;
  readonly interactPressed: boolean;
  readonly discardSlotIndex: number | null;
  readonly secureSlotIndex: number | null;
}

/**
 * The full simulation world: every player in the match, the static map
 * geometry, any live projectiles, enemies, ground loot, and extraction
 * points. The renderer reads this; it never mutates it or derives outcomes
 * from it (technical plan §5.1). `tick` is the fixed-step counter, used to
 * seed deterministic projectile ids (`combat/ranged.ts`) — not a game rule.
 * `rng` is the same seeded generator created at `createSimulation` (technical
 * plan §9.4), carried across steps and reused (not re-seeded) so ground-loot
 * choice and extraction-point rotation stay part of one deterministic sequence
 * for the whole match. `extractionCandidatePoints` is the fixed candidate list
 * extraction points rotate among; it never changes after creation, like
 * `walls`. `skillChips` (M3.7) are wildcard-skill pickups scattered on the
 * map, the skill counterpart of `groundLoot`.
 *
 * `players` (M4) holds two to eight of them, in a stable order: `stepSimulation`
 * processes them in array order, which is what makes a contested outcome (two
 * players reaching the same item on the same tick) resolve identically on every
 * machine replaying the same inputs. A player whose `runResult` is set is inert
 * but stays in the array, because the other players' matches continue.
 */
export interface World {
  readonly players: readonly Player[];
  readonly walls: readonly Wall[];
  readonly projectiles: readonly Projectile[];
  readonly enemies: readonly Enemy[];
  readonly groundLoot: readonly GroundLoot[];
  readonly skillChips: readonly SkillChip[];
  readonly extractionPoints: readonly ExtractionPoint[];
  readonly extractionCandidatePoints: readonly Vec2[];
  readonly rng: Rng;
  readonly tick: number;
}
