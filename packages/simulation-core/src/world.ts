/**
 * Core world/entity types. M1 shipped movement, map collision, aim, the
 * shared attack pipeline (sword + bow), the chaser enemy, health/death, and
 * dash (`docs/M1_EXECUTION_PLAN.md` §3). M2 adds the inventory, secure slot,
 * ground loot, rotating extraction, and the local run result (`docs/
 * M2_ISSUES.md`).
 *
 * M2 is still local and single-player (no network, no other players), so
 * `World` holds exactly one `player`, not a collection.
 */
import type {
  EnemyDefinition,
  LootDefinition,
  WeaponDefinition,
} from "@carry-or-fall/game-content";

import type { Inventory, SecureSlot } from "./inventory";
import type { PointTotals } from "./points";
import type { Rng } from "./prng";

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
 */
export interface Player {
  readonly position: Vec2;
  readonly radius: number;
  readonly facing: number;
  readonly health: number;
  readonly maxHealth: number;
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
}

/**
 * The in-flight state of one melee swing, tracked across simulation steps so
 * hit resolution happens only during the weapon's "active" window
 * (`combat/melee.ts`, M1.7).
 */
export interface MeleeAttackState {
  readonly weapon: WeaponDefinition;
  readonly origin: Vec2;
  readonly facing: number;
  readonly elapsedMs: number;
  readonly hasResolvedHits: boolean;
}

/**
 * A live ranged projectile (M1.8). Runtime shape is intentionally minimal:
 * M1's bow has no bounce/pierce/return/split behavior (`docs/
 * M1_EXECUTION_PLAN.md` §7), so a projectile simply travels until it hits one
 * target, is stopped by a wall (swept collision, `combat/ranged.ts` —
 * `docs/M1_ISSUES.md` D-1, resolved), or its lifespan expires — removed in
 * every case, never bounced.
 */
export interface Projectile {
  readonly id: string;
  readonly position: Vec2;
  readonly velocity: Vec2;
  readonly radius: number;
  readonly damage: number;
  readonly remainingLifespanMs: number;
}

/**
 * A live enemy (M1.9): a circle, per the collision strategy, carrying the
 * stats copied from its `EnemyDefinition` (`@carry-or-fall/game-content`) at
 * spawn time. `contactCooldownMs` paces contact damage so touching the player
 * deals `contactDamage` periodically, not every single fixed step.
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
 * The outcome of a finished local run (M2.8, `docs/M2_ISSUES.md`): death
 * converts only the secure slot and drops the inventory; a successful
 * extraction converts both. Displayed once by the client HUD; never
 * persisted (`docs/DECISIONS.md` D27).
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
 * The full simulation world: the single local player, the static map
 * geometry, any live projectiles, enemies, ground loot, and extraction
 * points. The renderer reads this; it never mutates it or derives outcomes
 * from it (technical plan §5.1). `tick` is the fixed-step counter, used to
 * seed deterministic projectile ids (`combat/ranged.ts`) — not networked, not
 * a game rule. `runResult` is `null` while the run is in progress; once set
 * (M2.8), `stepSimulation` becomes a full no-op. `rng` is the same seeded
 * generator created at `createSimulation` (technical plan §9.4), carried
 * across steps and reused (not re-seeded) so ground-loot choice and
 * extraction-point rotation stay part of one deterministic sequence for the
 * whole run. `extractionCandidatePoints` is the fixed candidate list
 * extraction points rotate among; it never changes after creation, like
 * `walls`.
 */
export interface World {
  readonly player: Player;
  readonly walls: readonly Wall[];
  readonly projectiles: readonly Projectile[];
  readonly enemies: readonly Enemy[];
  readonly groundLoot: readonly GroundLoot[];
  readonly extractionPoints: readonly ExtractionPoint[];
  readonly extractionCandidatePoints: readonly Vec2[];
  readonly runResult: RunResult | null;
  readonly rng: Rng;
  readonly tick: number;
}
