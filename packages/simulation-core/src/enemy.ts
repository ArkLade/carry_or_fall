/**
 * Chaser enemy behavior (M1.9, `docs/M1_EXECUTION_PLAN.md` §9). Behavior is
 * selected by `EnemyDefinition.behavior` (`@carry-or-fall/game-content`), not
 * hard-coded per enemy id — adding a second `"chaser"`-behavior enemy later
 * needs only a new content definition, not an engine change. Only `"chaser"`
 * is implemented; `"ranged"`/`"heavy"` are non-goals this milestone (an enemy
 * with an unimplemented behavior simply does not move).
 *
 * The chaser is a circular actor and uses the same wall collision as the
 * player (`resolveAxisMovement`) — this is the ordinary collision strategy
 * for any circular actor (technical plan §12.1), not a workaround for the
 * projectile/wall defect (`docs/M1_ISSUES.md`, "Known deferred defects" D-1),
 * which is specific to `combat/ranged.ts` and is left exactly as-is.
 */
import type { EnemyDefinition } from "@carry-or-fall/game-content";

import { circleIntersectsCircle } from "./collision";
import type { SpatialGrid } from "./collision";
import { resolveAxisMovement } from "./collision";
import type { Rng } from "./prng";
import type { Enemy, Vec2, Wall } from "./world";

/**
 * Build a live `Enemy` from its content definition, spawned at one of
 * `candidateSpawnPoints` chosen via the seeded PRNG (`createRng`) for
 * reproducibility (M1.9 requirement 4). `spawnIndex` seeds a deterministic id
 * (no hidden module-level counter, so identical inputs always produce an
 * identical `Enemy` — invariant 7). Throws if given no candidates — a caller
 * error, not a runtime/content condition.
 */
export function spawnEnemy(
  definition: EnemyDefinition,
  candidateSpawnPoints: readonly Vec2[],
  rng: Rng,
  radius: number,
  spawnIndex: number,
): Enemy {
  if (candidateSpawnPoints.length === 0) {
    throw new RangeError("spawnEnemy requires at least one candidate spawn point");
  }
  const index = rng.nextInt(candidateSpawnPoints.length);
  const position = candidateSpawnPoints[index]!;

  return {
    id: `enemy-${String(spawnIndex)}`,
    definitionId: definition.id,
    behavior: definition.behavior,
    position,
    radius,
    health: definition.health,
    maxHealth: definition.health,
    moveSpeed: definition.moveSpeed,
    contactDamage: definition.contactDamage,
    contactDamageIntervalMs: definition.contactDamageIntervalMs,
    contactCooldownMs: 0,
  };
}

/**
 * Advance one enemy by one fixed step: move toward the player if its
 * behavior is `"chaser"` (nearest player — trivially the only player in M1's
 * single-player local run), blocked/sliding on walls exactly like the
 * player's own movement. Ticks down `contactCooldownMs` regardless of
 * behavior.
 */
export function stepEnemyMovement(
  enemy: Enemy,
  playerPosition: Vec2,
  dtMs: number,
  dtSeconds: number,
  wallGrid: SpatialGrid<Wall>,
): Enemy {
  const contactCooldownMs = Math.max(0, enemy.contactCooldownMs - dtMs);

  if (enemy.behavior !== "chaser") {
    return { ...enemy, contactCooldownMs };
  }

  const dx = playerPosition.x - enemy.position.x;
  const dy = playerPosition.y - enemy.position.y;
  const distance = Math.hypot(dx, dy);
  if (distance === 0) {
    return { ...enemy, contactCooldownMs };
  }

  const step = enemy.moveSpeed * dtSeconds;
  const deltaX = (dx / distance) * step;
  const deltaY = (dy / distance) * step;

  const x = resolveAxisMovement(enemy.position, "x", deltaX, enemy.radius, wallGrid);
  const afterX: Vec2 = { x, y: enemy.position.y };
  const y = resolveAxisMovement(afterX, "y", deltaY, enemy.radius, wallGrid);

  return { ...enemy, position: { x, y }, contactCooldownMs };
}

/** Whether `enemy` currently overlaps the player's circle. */
export function isTouchingPlayer(
  enemy: Enemy,
  player: { readonly position: Vec2; readonly radius: number },
): boolean {
  return circleIntersectsCircle(
    { position: enemy.position, radius: enemy.radius },
    { position: player.position, radius: player.radius },
  );
}

/**
 * Whether `enemy` may deal contact damage right now: touching the player and
 * its contact cooldown has elapsed. Does not mutate anything — the caller
 * (`simulation.ts`) applies the damage and resets the cooldown.
 */
export function canDealContactDamage(
  enemy: Enemy,
  player: { readonly position: Vec2; readonly radius: number },
): boolean {
  return enemy.contactCooldownMs <= 0 && isTouchingPlayer(enemy, player);
}
