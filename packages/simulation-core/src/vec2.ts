/**
 * A 2D point or vector in world space (pixels). Split out from `world.ts` so
 * combat modules (`combat/melee.ts`, `combat/ranged.ts`) can depend on it
 * without importing `world.ts` — `world.ts` itself depends on combat types
 * (`MeleeAttackState`) for `Player`, so combat modules importing `Vec2` from
 * `world.ts` would create an import cycle.
 */
export interface Vec2 {
  readonly x: number;
  readonly y: number;
}
