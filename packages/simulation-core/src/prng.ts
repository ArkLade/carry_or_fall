/**
 * Small, fully deterministic pseudo-random number generator (mulberry32).
 *
 * Determinism is the point: authoritative gameplay must produce identical
 * outcomes from identical inputs on the server (and in tests), independent of
 * platform `Math.random`. M0 ships only this primitive; no gameplay uses it yet.
 */
export interface Rng {
  /** Next float in the half-open interval [0, 1). */
  next(): number;
  /** Next integer in [0, maxExclusive). Throws if `maxExclusive` is not a positive integer. */
  nextInt(maxExclusive: number): number;
}

/**
 * Create a deterministic generator seeded by `seed`. The same seed always yields
 * the same sequence. The seed is reduced to an unsigned 32-bit integer.
 */
export function createRng(seed: number): Rng {
  let state = seed >>> 0;

  const next = (): number => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  return {
    next,
    nextInt(maxExclusive: number): number {
      if (!Number.isInteger(maxExclusive) || maxExclusive <= 0) {
        throw new RangeError("maxExclusive must be a positive integer");
      }
      return Math.floor(next() * maxExclusive);
    },
  };
}
