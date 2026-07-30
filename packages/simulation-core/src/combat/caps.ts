/**
 * The eight hard caps (technical plan §13.4, `docs/M1_EXECUTION_PLAN.md` §7,
 * concept §9.5). These live in shared engine code, not content data
 * (`docs/DEVELOPMENT_RULES.md`, "Preserve projectile and effect safety caps"):
 * a weapon's own `limits` (`@carry-or-fall/game-content`) are a ceiling this
 * code can clamp further, but no content definition — however it is
 * authored — can ever raise a cap past what is enforced here.
 *
 * M1's two weapons don't exercise bounce/pierce/return/split behavior at all
 * (the bow fires straight; `docs/M1_EXECUTION_PLAN.md` §7), and no enemy
 * targeting AI exists yet to use the search-radius cap. The constants and
 * enforcement functions exist now anyway, exactly as the plan requires, so a
 * later skill (M3) or the chaser's targeting (M1.9+) cannot uncap the engine
 * by construction.
 */

/** 1. No more than 8 primary projectiles per attack. */
export const MAX_PROJECTILES_PER_ATTACK = 8;

/** 2. No more than 3 bounces. */
export const MAX_BOUNCES = 3;

/** 3. No more than 3 pierces. */
export const MAX_PIERCES = 3;

/** 4. No projectile returns more than once. */
export const MAX_RETURNS_PER_PROJECTILE = 1;

/** 7. A per-player active projectile cap. */
export const MAX_ACTIVE_PROJECTILES_PER_PLAYER = 24;

/** 8. A bounded target-search radius (pixels). */
export const MAX_TARGET_SEARCH_RADIUS_PX = 640;

function nonNegativeInt(value: number): number {
  return Math.max(0, Math.trunc(value));
}

/**
 * 1. Clamp a requested per-attack projectile count against both the weapon's
 * own ceiling and the shared hard cap — whichever is lower wins, and the
 * shared cap always wins if the weapon (or a future skill) claims a higher
 * ceiling than the engine allows.
 */
export function clampProjectilesPerAttack(requestedCount: number, weaponLimit: number): number {
  return Math.min(
    nonNegativeInt(requestedCount),
    nonNegativeInt(weaponLimit),
    MAX_PROJECTILES_PER_ATTACK,
  );
}

/** 2. Clamp a requested bounce count the same way. */
export function clampBounceCount(requestedCount: number, weaponLimit: number): number {
  return Math.min(nonNegativeInt(requestedCount), nonNegativeInt(weaponLimit), MAX_BOUNCES);
}

/** 3. Clamp a requested pierce count the same way. */
export function clampPierceCount(requestedCount: number, weaponLimit: number): number {
  return Math.min(nonNegativeInt(requestedCount), nonNegativeInt(weaponLimit), MAX_PIERCES);
}

/** 4. Whether a projectile that has already returned `returnsSoFar` times may return again. */
export function canProjectileReturn(returnsSoFar: number): boolean {
  return nonNegativeInt(returnsSoFar) < MAX_RETURNS_PER_PROJECTILE;
}

/** 5. Split projectiles cannot split again. */
export function canProjectileSplit(hasAlreadySplit: boolean): boolean {
  return !hasAlreadySplit;
}

/** 6. Child projectiles cannot create parent effects recursively (no recursive child effects). */
export function canChildCreateParentEffect(isChildProjectile: boolean): boolean {
  return !isChildProjectile;
}

/**
 * 7. Clamp how many new projectiles may spawn given `currentActiveCount`
 * already live for this player, never exceeding `cap` in total.
 */
export function clampSpawnForActiveCap(
  currentActiveCount: number,
  requestedSpawnCount: number,
  cap: number = MAX_ACTIVE_PROJECTILES_PER_PLAYER,
): number {
  const room = nonNegativeInt(cap) - nonNegativeInt(currentActiveCount);
  return Math.max(0, Math.min(nonNegativeInt(requestedSpawnCount), Math.max(0, room)));
}

/** 8. Clamp a requested target-search radius to the bounded maximum. */
export function clampSearchRadius(requestedRadiusPx: number): number {
  return Math.max(0, Math.min(requestedRadiusPx, MAX_TARGET_SEARCH_RADIUS_PX));
}
