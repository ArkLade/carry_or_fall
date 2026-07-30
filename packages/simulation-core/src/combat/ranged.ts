/**
 * Ranged attack resolution (M1.8, `docs/M1_EXECUTION_PLAN.md` §9). Spawns
 * projectiles from a `WeaponDefinition` through the shared pipeline
 * (`pipeline.ts`), enforcing the per-attack and per-player hard caps
 * (`caps.ts`). M1's bow has no bounce/pierce/return/split behavior
 * (`docs/M1_EXECUTION_PLAN.md` §7): a projectile travels in a straight line
 * until it hits one target (and is removed) or its lifespan expires.
 */
import type { WeaponDefinition } from "@carry-or-fall/game-content";

import { circleIntersectsCircle } from "../collision";
import type { Projectile, Vec2 } from "../world";
import { clampProjectilesPerAttack, clampSpawnForActiveCap } from "./caps";
import type { HitEvent } from "./events";
import type { AttackActor, AttackDenialReason, AttackTarget } from "./pipeline";
import { applyDamage, prepareAttack } from "./pipeline";

/** Proposed, balance-deferred (no numeric source in either authoritative document). */
export const PROJECTILE_RADIUS_PX = 6;
export const PROJECTILE_LIFESPAN_MS = 2000;

export type RangedStartResult =
  | { readonly started: true; readonly projectiles: readonly Projectile[] }
  | { readonly started: false; readonly reason: AttackDenialReason };

/**
 * Attempt to fire: refused if the actor is invalid or the weapon's cooldown
 * has not elapsed (stages 1-2, shared with melee via `prepareAttack`).
 * Otherwise spawns `weapon.projectileCount` projectiles evenly distributed
 * across `weapon.spreadDegrees`, clamped by both the weapon's own `limits`
 * and the shared hard caps (stage 6, `caps.ts`) — the count can never exceed
 * {@link import("./caps").MAX_PROJECTILES_PER_ATTACK}, and spawning stops
 * early if it would exceed the per-player active-projectile cap.
 *
 * `spawnSequence` seeds deterministic projectile ids (e.g. the world's step
 * counter) — no `Math.random`/PRNG is needed since the spread distribution
 * below is a fixed, deterministic formula, not a random draw.
 */
export function startRangedAttack(
  actor: AttackActor,
  weapon: WeaponDefinition,
  cooldownRemainingMs: number,
  activeProjectileCount: number,
  spawnSequence: number,
): RangedStartResult {
  const preparation = prepareAttack(actor, weapon, cooldownRemainingMs);
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
    });
  }

  return { started: true, projectiles };
}

/**
 * Advance all projectiles by one step: move, age, resolve a hit against the
 * first overlapping target (stage 8, damage applied via the shared
 * `applyDamage`, stage 9), and drop any projectile that hit or expired.
 */
export function stepProjectiles(
  projectiles: readonly Projectile[],
  dtMs: number,
  dtSeconds: number,
  targets: readonly AttackTarget[],
): {
  readonly projectiles: readonly Projectile[];
  readonly updatedTargets: readonly AttackTarget[];
  readonly hitEvents: readonly HitEvent[];
} {
  let workingTargets = targets;
  const hitEvents: HitEvent[] = [];
  const survivors: Projectile[] = [];

  for (const projectile of projectiles) {
    const movedPosition: Vec2 = {
      x: projectile.position.x + projectile.velocity.x * dtSeconds,
      y: projectile.position.y + projectile.velocity.y * dtSeconds,
    };
    const remainingLifespanMs = projectile.remainingLifespanMs - dtMs;

    const hitIndex = workingTargets.findIndex((target) =>
      circleIntersectsCircle({ position: movedPosition, radius: projectile.radius }, target),
    );

    if (hitIndex !== -1) {
      const target = workingTargets[hitIndex]!;
      hitEvents.push({ targetId: target.id, damage: projectile.damage, position: movedPosition });
      workingTargets = workingTargets.map((candidate, index) =>
        index === hitIndex ? applyDamage(candidate, projectile.damage) : candidate,
      );
      continue; // Consumed on hit: M1 has no pierce behavior yet (§7).
    }

    if (remainingLifespanMs <= 0) {
      continue; // Expired.
    }

    survivors.push({ ...projectile, position: movedPosition, remainingLifespanMs });
  }

  return { projectiles: survivors, updatedTargets: workingTargets, hitEvents };
}
