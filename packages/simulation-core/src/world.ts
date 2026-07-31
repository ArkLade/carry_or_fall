/**
 * Core world/entity types. M1 now ships movement, map collision, aim, the
 * shared attack pipeline (sword + bow), the chaser enemy, health/death, and
 * dash (`docs/M1_EXECUTION_PLAN.md` §3).
 *
 * M1 is local and single-player (no network, no other players), so `World`
 * holds exactly one `player`, not a collection.
 */
import type { EnemyDefinition, WeaponDefinition } from "@carry-or-fall/game-content";

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
 * Normalized input intent consumed by the simulation. This is intentionally a
 * variant of `@carry-or-fall/protocol`'s `InputMessage`, not an identical copy:
 * `moveX`/`moveY` (M1.3), `aimAngle`/`attackPressed` (M1.4/M1.6), and
 * `dashPressed` (M1.S1) match it directly, but `secondaryAttackPressed` has no
 * protocol counterpart — it is a **local-only, M1 convenience** for triggering
 * the bow from the second mouse button while no real weapon-equip/switching
 * system exists (that is M2's ground-weapon-swap work). `interactPressed` is
 * still absent; M2 adds it.
 */
export interface InputState {
  readonly moveX: -1 | 0 | 1;
  readonly moveY: -1 | 0 | 1;
  readonly aimAngle: number;
  readonly attackPressed: boolean;
  readonly secondaryAttackPressed: boolean;
  readonly dashPressed: boolean;
}

/**
 * The full simulation world: the single local player, the static map
 * geometry, any live projectiles, and any live enemies. The renderer reads
 * this; it never mutates it or derives outcomes from it (technical plan
 * §5.1). `tick` is the fixed-step counter, used to seed deterministic
 * projectile ids (`combat/ranged.ts`) — not networked, not a game rule.
 */
export interface World {
  readonly player: Player;
  readonly walls: readonly Wall[];
  readonly projectiles: readonly Projectile[];
  readonly enemies: readonly Enemy[];
  readonly tick: number;
}
