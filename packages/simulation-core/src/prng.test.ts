import { describe, expect, it } from "vitest";

import { createRng, pickDistinct } from "./prng";

describe("createRng", () => {
  it("produces an identical sequence for the same seed", () => {
    const a = createRng(12345);
    const b = createRng(12345);
    const seqA = Array.from({ length: 16 }, () => a.next());
    const seqB = Array.from({ length: 16 }, () => b.next());
    expect(seqA).toEqual(seqB);
  });

  it("produces different sequences for different seeds", () => {
    const a = createRng(1);
    const b = createRng(2);
    const seqA = Array.from({ length: 16 }, () => a.next());
    const seqB = Array.from({ length: 16 }, () => b.next());
    expect(seqA).not.toEqual(seqB);
  });

  it("returns floats within [0, 1)", () => {
    const rng = createRng(99);
    for (let i = 0; i < 1000; i++) {
      const value = rng.next();
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
    }
  });

  it("returns integers within [0, maxExclusive)", () => {
    const rng = createRng(7);
    for (let i = 0; i < 1000; i++) {
      const value = rng.nextInt(6);
      expect(Number.isInteger(value)).toBe(true);
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(6);
    }
  });

  it("rejects a non-positive or non-integer bound", () => {
    const rng = createRng(7);
    expect(() => rng.nextInt(0)).toThrow(RangeError);
    expect(() => rng.nextInt(-3)).toThrow(RangeError);
    expect(() => rng.nextInt(2.5)).toThrow(RangeError);
  });
});

describe("pickDistinct", () => {
  const candidates = ["a", "b", "c", "d", "e"];

  it("picks without replacement — every result is unique", () => {
    const picked = pickDistinct(candidates, 4, createRng(1));
    expect(picked).toHaveLength(4);
    expect(new Set(picked).size).toBe(4);
    for (const item of picked) {
      expect(candidates).toContain(item);
    }
  });

  it("is reproducible for a seed, and can differ across seeds", () => {
    expect(pickDistinct(candidates, 3, createRng(99))).toEqual(
      pickDistinct(candidates, 3, createRng(99)),
    );
    const acrossSeeds = new Set(
      [1, 2, 3, 4, 5, 6, 7, 8].map((seed) => pickDistinct(candidates, 2, createRng(seed)).join()),
    );
    expect(acrossSeeds.size).toBeGreaterThan(1);
  });

  it("can pick the whole pool, and picking none consumes no randomness", () => {
    expect(new Set(pickDistinct(candidates, candidates.length, createRng(3))).size).toBe(
      candidates.length,
    );

    const rng = createRng(3);
    expect(pickDistinct(candidates, 0, rng)).toEqual([]);
    // The generator is untouched, so the next draw matches a fresh generator's.
    expect(rng.nextInt(1000)).toBe(createRng(3).nextInt(1000));
  });

  it("refuses to pick more items than the pool holds", () => {
    expect(() => pickDistinct(candidates, candidates.length + 1, createRng(1))).toThrow(RangeError);
  });
});
