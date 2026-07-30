/**
 * Angle helpers shared by aim (M1.4) and melee arc math (M1.7). Kept dependency
 * free so both `simulation.ts` and `combat/melee.ts` can use them.
 */

/** Convert degrees to radians. */
export function degToRad(degrees: number): number {
  return (degrees * Math.PI) / 180;
}

/**
 * Normalize an angle (radians) to `(-π, π]`. Used to clamp `aimAngle` to a
 * valid, bounded numeric range (M1.4) regardless of how many full turns the
 * input represents.
 */
export function normalizeAngle(radians: number): number {
  const twoPi = Math.PI * 2;
  let normalized = radians % twoPi;
  if (normalized > Math.PI) {
    normalized -= twoPi;
  } else if (normalized <= -Math.PI) {
    normalized += twoPi;
  }
  return normalized;
}

/** The signed angular difference `a - b`, normalized to `(-π, π]`. */
export function angleDifference(a: number, b: number): number {
  return normalizeAngle(a - b);
}
