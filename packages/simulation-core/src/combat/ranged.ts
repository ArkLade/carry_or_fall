/**
 * Ranged attack resolution (M1.8, `docs/M1_EXECUTION_PLAN.md` §9; bounce,
 * pierce, return, and homing added M3.4, `docs/M3_ISSUES.md` M3.4). Spawns
 * projectiles from a `WeaponDefinition` through the shared pipeline
 * (`pipeline.ts`), enforcing the per-attack and per-player hard caps
 * (`caps.ts`). The base weapon still has no bounce/pierce/return/homing
 * behavior (`docs/M1_EXECUTION_PLAN.md` §7; concept §29.2: those are skill
 * effects, not base-weapon behavior): a projectile only bounces/pierces/
 * returns/homes when the attacker's aggregated `SkillEffects` (M3.3) grants
 * it. With no such skill equipped, a projectile travels in a straight line
 * until it hits one target (and is removed), is stopped by a wall (and is
 * removed — D-1, no bounce), or its lifespan expires — exactly M1's
 * behavior, unchanged.
 */
import type { WeaponDefinition } from "@carry-or-fall/game-content";

import { angleDifference } from "../angles";
import { circleIntersectsCircle, resolveAxisMovement } from "../collision";
import type { SpatialGrid } from "../collision";
import { type BuildEffects, NO_BUILD_EFFECTS } from "../build-effects";
import { NO_SKILL_EFFECTS, type SkillEffects } from "../skill-effects";
import type { Projectile, Vec2, Wall } from "../world";
import {
  canProjectileReturn,
  clampBounceCount,
  clampPierceCount,
  clampProjectilesPerAttack,
  clampSearchRadius,
  clampSpawnForActiveCap,
} from "./caps";
import type { HitEvent } from "./events";
import type { AttackActor, AttackDenialReason, AttackTarget } from "./pipeline";
import { applyDamage, prepareAttack } from "./pipeline";

/** Proposed, balance-deferred (no numeric source in either authoritative document). */
export const PROJECTILE_RADIUS_PX = 6;
export const PROJECTILE_LIFESPAN_MS = 2000;

/**
 * The "requested" homing search radius (M3.4) — deliberately above
 * `caps.ts`'s `MAX_TARGET_SEARCH_RADIUS_PX` so `clampSearchRadius` visibly
 * bounds it every step a homing projectile searches, exercising cap 8 from
 * real gameplay rather than a value that happens to already be under the cap.
 */
export const HOMING_SEARCH_RADIUS_PX = 900;

export type RangedStartResult =
  | {
      readonly started: true;
      readonly projectiles: readonly Projectile[];
      /** The effective (post-carried-loot, post-skill) attack interval; use this to set the next cooldown. */
      readonly attackIntervalMs: number;
    }
  | { readonly started: false; readonly reason: AttackDenialReason };

/**
 * Attempt to fire: refused if the actor is invalid or the weapon's cooldown
 * has not elapsed (stages 1-2, shared with melee via `prepareAttack`).
 * Otherwise spawns `weapon.projectileCount` projectiles (already including
 * any skill-granted `projectileCountAdd`, applied by stage 4) evenly
 * distributed across `weapon.spreadDegrees`, clamped by both the weapon's own
 * `limits` and the shared hard caps (stage 6, `caps.ts`) — the count can
 * never exceed {@link import("./caps").MAX_PROJECTILES_PER_ATTACK}, and
 * spawning stops early if it would exceed the per-player active-projectile
 * cap. Each spawned projectile's bounce/pierce/return/homing runtime state
 * is seeded once here from the aggregated `SkillEffects` (M3.3), clamped by
 * the same shared caps.
 *
 * `spawnSequence` seeds deterministic projectile ids (e.g. the world's step
 * counter) — no `Math.random`/PRNG is needed since the spread distribution
 * below is a fixed, deterministic formula, not a random draw. `carriedEffects`
 * (M2, `docs/M2_ISSUES.md` M2.4) defaults to {@link NO_BUILD_EFFECTS};
 * `skillEffects` (M3) defaults to {@link NO_SKILL_EFFECTS}.
 */
export function startRangedAttack(
  actor: AttackActor,
  weapon: WeaponDefinition,
  cooldownRemainingMs: number,
  activeProjectileCount: number,
  spawnSequence: number,
  carriedEffects: BuildEffects = NO_BUILD_EFFECTS,
  skillEffects: SkillEffects = NO_SKILL_EFFECTS,
): RangedStartResult {
  const preparation = prepareAttack(
    actor,
    weapon,
    cooldownRemainingMs,
    carriedEffects,
    skillEffects,
  );
  if (!preparation.ready) {
    return { started: false, reason: preparation.reason };
  }

  const { definition } = preparation;
  const requestedCount = definition.weapon.projectileCount ?? 0;
  const cappedByWeapon = clampProjectilesPerAttack(
    requestedCount,
    definition.weapon.limits.maxProjectilesPerAttack,
  );
  const count = clampSpawnForActiveCap(activeProjectileCount, cappedByWeapon);
  const spreadDegrees = definition.weapon.spreadDegrees ?? 0;
  const speed = definition.weapon.projectileSpeed ?? 0;

  const bouncesRemaining = clampBounceCount(
    definition.skillEffects.bounceCountAdd,
    definition.weapon.limits.maxBounces,
  );
  const piercesRemaining = clampPierceCount(
    definition.skillEffects.pierceCountAdd,
    definition.weapon.limits.maxPierces,
  );
  const canReturn = definition.skillEffects.returnEnabled;
  const homingStrength = definition.skillEffects.homingStrengthAdd;
  const postBounceDamageMultiplier = definition.skillEffects.damageAfterBounceMultiplier;

  const projectiles: Projectile[] = [];
  for (let i = 0; i < count; i += 1) {
    const spreadFraction = count === 1 ? 0 : i / (count - 1) - 0.5;
    const angle = definition.facing + (spreadFraction * spreadDegrees * Math.PI) / 180;
    projectiles.push({
      id: `projectile-${String(spawnSequence)}-${String(i)}`,
      position: definition.origin,
      velocity: { x: Math.cos(angle) * speed, y: Math.sin(angle) * speed },
      radius: PROJECTILE_RADIUS_PX,
      damage: definition.weapon.damage,
      remainingLifespanMs: PROJECTILE_LIFESPAN_MS,
      bouncesRemaining,
      piercesRemaining,
      canReturn,
      returnsSoFar: 0,
      homingStrength,
      postBounceDamageMultiplier,
      hitTargetIds: [],
    });
  }

  return { started: true, projectiles, attackIntervalMs: definition.weapon.attackIntervalMs };
}

/** The nearest live target to `position` within `radiusPx`, excluding any id in `excludeIds`. Null if none. */
function findNearestTarget(
  position: Vec2,
  targets: readonly AttackTarget[],
  excludeIds: readonly string[],
  radiusPx: number,
): AttackTarget | null {
  let nearest: AttackTarget | null = null;
  let nearestDistanceSquared = radiusPx * radiusPx;
  for (const target of targets) {
    if (excludeIds.includes(target.id)) {
      continue;
    }
    const dx = target.position.x - position.x;
    const dy = target.position.y - position.y;
    const distanceSquared = dx * dx + dy * dy;
    if (distanceSquared <= nearestDistanceSquared) {
      nearest = target;
      nearestDistanceSquared = distanceSquared;
    }
  }
  return nearest;
}

/** Steer `velocity`'s direction toward `targetPosition` by `strength` (0-1), preserving speed. */
function steerVelocityToward(
  velocity: Vec2,
  position: Vec2,
  targetPosition: Vec2,
  strength: number,
): Vec2 {
  const speed = Math.hypot(velocity.x, velocity.y);
  if (speed === 0) {
    return velocity;
  }
  const currentAngle = Math.atan2(velocity.y, velocity.x);
  const desiredAngle = Math.atan2(targetPosition.y - position.y, targetPosition.x - position.x);
  const steeredAngle = currentAngle + angleDifference(desiredAngle, currentAngle) * strength;
  return { x: Math.cos(steeredAngle) * speed, y: Math.sin(steeredAngle) * speed };
}

/** The outcome of resolving one axis of a projectile's movement this step. */
interface AxisResolution {
  readonly value: number;
  readonly velocityComponent: number;
  readonly bouncesRemaining: number;
  readonly damage: number;
  readonly destroyed: boolean;
}

/**
 * Resolve one axis of a projectile's movement, reusing `collision.ts`'s
 * `resolveAxisMovement` exactly as the player's own two-axis movement
 * resolution already does (`docs/M3_EXECUTION_PLAN.md` §2.4): the returned
 * value equals the input when the swept move was blocked. A blocked axis
 * with `bouncesRemaining > 0` reflects that axis's velocity component and
 * applies `postBounceDamageMultiplier`; with none remaining, the projectile
 * is destroyed (M1's original "stopped by a wall, no bounce" behavior).
 */
function resolveProjectileAxis(
  position: Vec2,
  axis: "x" | "y",
  delta: number,
  velocityComponent: number,
  radius: number,
  grid: SpatialGrid<Wall>,
  bouncesRemaining: number,
  damage: number,
  postBounceDamageMultiplier: number,
): AxisResolution {
  const current = axis === "x" ? position.x : position.y;
  if (delta === 0) {
    return { value: current, velocityComponent, bouncesRemaining, damage, destroyed: false };
  }

  const resolved = resolveAxisMovement(position, axis, delta, radius, grid);
  const blocked = resolved === current;
  if (!blocked) {
    return { value: resolved, velocityComponent, bouncesRemaining, damage, destroyed: false };
  }
  if (bouncesRemaining <= 0) {
    return { value: current, velocityComponent, bouncesRemaining, damage, destroyed: true };
  }
  return {
    value: current,
    velocityComponent: -velocityComponent,
    bouncesRemaining: bouncesRemaining - 1,
    damage: damage * postBounceDamageMultiplier,
    destroyed: false,
  };
}

/**
 * Advance all projectiles by one step: steer (homing), move, resolve against
 * a wall (bounce or, with none remaining, stop — swept per axis, D-1/M3.4) or
 * a target (pierce or consume), age, and expire (or return once, M3.4).
 *
 * Wall collision is **swept** along the whole step's travel, per axis
 * (`wallGrid`, `docs/M1_ISSUES.md` D-1; per-axis bounce, `docs/M3_ISSUES.md`
 * M3.4), through the same `resolveAxisMovement` path actor movement uses
 * (`collision.ts`), per technical plan §12.1 (projectiles share the actor
 * collision system). A projectile blocked by a wall with no bounces left is
 * removed and is not checked against targets this step: a wall between the
 * shooter and a target must protect that target, not just cosmetically stop
 * the projectile after it has already been credited with the hit.
 */
export function stepProjectiles(
  projectiles: readonly Projectile[],
  dtMs: number,
  dtSeconds: number,
  targets: readonly AttackTarget[],
  wallGrid: SpatialGrid<Wall>,
): {
  readonly projectiles: readonly Projectile[];
  readonly updatedTargets: readonly AttackTarget[];
  readonly hitEvents: readonly HitEvent[];
} {
  let workingTargets = targets;
  const hitEvents: HitEvent[] = [];
  const survivors: Projectile[] = [];

  for (const projectile of projectiles) {
    let velocity = projectile.velocity;
    if (projectile.homingStrength > 0) {
      const searchRadius = clampSearchRadius(HOMING_SEARCH_RADIUS_PX);
      const nearest = findNearestTarget(
        projectile.position,
        workingTargets,
        projectile.hitTargetIds,
        searchRadius,
      );
      if (nearest !== null) {
        velocity = steerVelocityToward(
          velocity,
          projectile.position,
          nearest.position,
          projectile.homingStrength,
        );
      }
    }

    const dx = velocity.x * dtSeconds;
    const dy = velocity.y * dtSeconds;

    const xResult = resolveProjectileAxis(
      projectile.position,
      "x",
      dx,
      velocity.x,
      projectile.radius,
      wallGrid,
      projectile.bouncesRemaining,
      projectile.damage,
      projectile.postBounceDamageMultiplier,
    );
    const afterX: Vec2 = { x: xResult.value, y: projectile.position.y };

    if (xResult.destroyed) {
      continue; // Stopped by a wall this step, no bounce remaining: removed (D-1/M3.4).
    }

    const yResult = resolveProjectileAxis(
      afterX,
      "y",
      dy,
      velocity.y,
      projectile.radius,
      wallGrid,
      xResult.bouncesRemaining,
      xResult.damage,
      projectile.postBounceDamageMultiplier,
    );

    if (yResult.destroyed) {
      continue;
    }

    const movedPosition: Vec2 = { x: afterX.x, y: yResult.value };
    const movedVelocity: Vec2 = { x: xResult.velocityComponent, y: yResult.velocityComponent };
    const bouncesRemaining = yResult.bouncesRemaining;
    const damage = yResult.damage;

    const remainingLifespanMs = projectile.remainingLifespanMs - dtMs;

    const hitIndex = workingTargets.findIndex(
      (target) =>
        !projectile.hitTargetIds.includes(target.id) &&
        circleIntersectsCircle({ position: movedPosition, radius: projectile.radius }, target),
    );

    if (hitIndex !== -1) {
      const target = workingTargets[hitIndex]!;
      hitEvents.push({ targetId: target.id, damage, position: movedPosition });
      workingTargets = workingTargets.map((candidate, index) =>
        index === hitIndex ? applyDamage(candidate, damage) : candidate,
      );
      if (projectile.piercesRemaining > 0) {
        survivors.push({
          ...projectile,
          position: movedPosition,
          velocity: movedVelocity,
          damage,
          bouncesRemaining,
          piercesRemaining: projectile.piercesRemaining - 1,
          remainingLifespanMs,
          hitTargetIds: [...projectile.hitTargetIds, target.id],
        });
      }
      continue; // Consumed on hit (or continued as a piercing survivor, pushed above).
    }

    if (remainingLifespanMs <= 0) {
      if (projectile.canReturn && canProjectileReturn(projectile.returnsSoFar)) {
        survivors.push({
          ...projectile,
          position: movedPosition,
          velocity: { x: -movedVelocity.x, y: -movedVelocity.y },
          damage,
          bouncesRemaining,
          returnsSoFar: projectile.returnsSoFar + 1,
          remainingLifespanMs: PROJECTILE_LIFESPAN_MS,
        });
      }
      continue; // Expired (or returned once, pushed above).
    }

    survivors.push({
      ...projectile,
      position: movedPosition,
      velocity: movedVelocity,
      damage,
      bouncesRemaining,
      remainingLifespanMs,
    });
  }

  return { projectiles: survivors, updatedTargets: workingTargets, hitEvents };
}
