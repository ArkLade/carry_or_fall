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
import { pickDistinct, type Rng } from "./prng";
import type { Enemy, RunResult, Vec2, Wall } from "./world";

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
    stunnedMs: 0,
  };
}

/**
 * Build `count` live enemies, each at a **distinct** candidate spawn point
 * chosen via the seeded PRNG (`pickDistinct`) — two enemies never start
 * stacked on the same position, which would otherwise read as one enemy and
 * deal doubled contact damage from a single apparent body.
 *
 * `count` defaults to 1, so a caller that wants M1's original single-chaser
 * behavior gets exactly that, consuming exactly one `rng.nextInt` call just
 * as {@link spawnEnemy} does — the seeded sequence for everything spawned
 * afterwards is therefore unchanged for existing single-enemy callers.
 * Throws if there are fewer candidates than enemies to place, a
 * caller/content error rather than a runtime condition.
 */
export function spawnEnemies(
  definition: EnemyDefinition,
  candidateSpawnPoints: readonly Vec2[],
  rng: Rng,
  radius: number,
  count = 1,
): Enemy[] {
  if (candidateSpawnPoints.length < count) {
    throw new RangeError("spawnEnemies requires at least `count` candidate spawn points");
  }
  return pickDistinct(candidateSpawnPoints, count, rng).map((position, index) => ({
    id: `enemy-${String(index)}`,
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
    stunnedMs: 0,
  }));
}

/**
 * Advance one enemy by one fixed step: move toward the player if its
 * behavior is `"chaser"` (nearest player — trivially the only player in M1's
 * single-player local run), blocked/sliding on walls exactly like the
 * player's own movement. Ticks down `contactCooldownMs` regardless of
 * behavior. While `stunnedMs > 0` (M3.5, a melee `stunning_blows`-style skill
 * hit), the chase step is skipped, but `stunnedMs` still counts down every
 * step so the stun eventually elapses (contact damage is unaffected by stun
 * — a deliberate scope choice, `docs/M3_ISSUES.md` M3.5).
 */
export function stepEnemyMovement(
  enemy: Enemy,
  playerPosition: Vec2,
  dtMs: number,
  dtSeconds: number,
  wallGrid: SpatialGrid<Wall>,
): Enemy {
  const contactCooldownMs = Math.max(0, enemy.contactCooldownMs - dtMs);
  const stunnedMs = Math.max(0, enemy.stunnedMs - dtMs);

  if (enemy.behavior !== "chaser" || enemy.stunnedMs > 0) {
    return { ...enemy, contactCooldownMs, stunnedMs };
  }

  const dx = playerPosition.x - enemy.position.x;
  const dy = playerPosition.y - enemy.position.y;
  const distance = Math.hypot(dx, dy);
  if (distance === 0) {
    return { ...enemy, contactCooldownMs, stunnedMs };
  }

  const step = enemy.moveSpeed * dtSeconds;
  const deltaX = (dx / distance) * step;
  const deltaY = (dy / distance) * step;

  const x = resolveAxisMovement(enemy.position, "x", deltaX, enemy.radius, wallGrid);
  const afterX: Vec2 = { x, y: enemy.position.y };
  const y = resolveAxisMovement(afterX, "y", deltaY, enemy.radius, wallGrid);

  return { ...enemy, position: { x, y }, contactCooldownMs, stunnedMs };
}

/**
 * The live player nearest to `from`, or `null` if none are left (M4). Concept
 * §14.2 defines the chaser as moving "directly toward the **nearest** player";
 * through M3 that was trivially the only player, so `simulation.ts` passed the
 * one player's position directly. With two to eight in a world it is a real
 * choice, and it is re-made every step — a chaser whose target dies or extracts
 * immediately turns on whoever is now closest.
 *
 * A player whose run has ended (`runResult` set) is not a target: they are inert
 * and no longer present in the fight, even though they remain in the array.
 */
export function nearestLivePlayer<
  T extends {
    readonly position: Vec2;
    readonly alive: boolean;
    readonly runResult: RunResult | null;
  },
>(from: Vec2, players: readonly T[]): T | null {
  let nearest: T | null = null;
  let nearestDistanceSquared = Number.POSITIVE_INFINITY;
  for (const player of players) {
    if (!player.alive || player.runResult !== null) {
      continue;
    }
    const dx = player.position.x - from.x;
    const dy = player.position.y - from.y;
    const distanceSquared = dx * dx + dy * dy;
    if (distanceSquared < nearestDistanceSquared) {
      nearest = player;
      nearestDistanceSquared = distanceSquared;
    }
  }
  return nearest;
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
