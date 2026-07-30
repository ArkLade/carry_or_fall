import { describe, expect, it } from "vitest";

import {
  canChildCreateParentEffect,
  canProjectileReturn,
  canProjectileSplit,
  clampBounceCount,
  clampPierceCount,
  clampProjectilesPerAttack,
  clampSearchRadius,
  clampSpawnForActiveCap,
  MAX_ACTIVE_PROJECTILES_PER_PLAYER,
  MAX_BOUNCES,
  MAX_PIERCES,
  MAX_PROJECTILES_PER_ATTACK,
  MAX_TARGET_SEARCH_RADIUS_PX,
} from "./caps";

describe("cap 1: max projectiles per attack", () => {
  it("clamps a request that tries to exceed the cap via a huge weapon-declared limit", () => {
    // Simulates a (fabricated) content definition/skill combination that
    // claims a limit far above the shared cap; the engine must still refuse
    // to exceed MAX_PROJECTILES_PER_ATTACK regardless of what content claims.
    expect(clampProjectilesPerAttack(999, 999)).toBe(MAX_PROJECTILES_PER_ATTACK);
  });

  it("still respects a weapon's own lower ceiling", () => {
    expect(clampProjectilesPerAttack(999, 2)).toBe(2);
  });

  it("never returns a negative count for negative input", () => {
    expect(clampProjectilesPerAttack(-5, 8)).toBe(0);
  });
});

describe("cap 2: max bounces", () => {
  it("clamps a request that tries to exceed the cap", () => {
    expect(clampBounceCount(999, 999)).toBe(MAX_BOUNCES);
  });

  it("still respects a weapon's own lower ceiling", () => {
    expect(clampBounceCount(999, 1)).toBe(1);
  });
});

describe("cap 3: max pierces", () => {
  it("clamps a request that tries to exceed the cap", () => {
    expect(clampPierceCount(999, 999)).toBe(MAX_PIERCES);
  });

  it("still respects a weapon's own lower ceiling", () => {
    expect(clampPierceCount(999, 1)).toBe(1);
  });
});

describe("cap 4: no more than one return per projectile", () => {
  it("rejects a second return attempt after the projectile has already returned once", () => {
    expect(canProjectileReturn(1)).toBe(false);
  });

  it("rejects further attempts even if a buggy caller claims many prior returns", () => {
    expect(canProjectileReturn(50)).toBe(false);
  });

  it("allows the first return", () => {
    expect(canProjectileReturn(0)).toBe(true);
  });
});

describe("cap 5: a split projectile cannot split again", () => {
  it("rejects a second split attempt on an already-split projectile", () => {
    expect(canProjectileSplit(true)).toBe(false);
  });

  it("allows a split on a projectile that has not split yet", () => {
    expect(canProjectileSplit(false)).toBe(true);
  });
});

describe("cap 6: no recursive child-projectile effects", () => {
  it("rejects a child projectile trying to create another parent effect", () => {
    expect(canChildCreateParentEffect(true)).toBe(false);
  });

  it("allows a non-child (root) projectile to create its effect", () => {
    expect(canChildCreateParentEffect(false)).toBe(true);
  });
});

describe("cap 7: per-player active projectile cap", () => {
  it("clamps a spawn request that would push the player over the cap", () => {
    // Already at the cap: a request for more projectiles must be fully denied.
    expect(clampSpawnForActiveCap(MAX_ACTIVE_PROJECTILES_PER_PLAYER, 10)).toBe(0);
  });

  it("clamps a spawn request that would exceed the cap only partially, to the remaining room", () => {
    const currentActive = MAX_ACTIVE_PROJECTILES_PER_PLAYER - 3;
    expect(clampSpawnForActiveCap(currentActive, 10)).toBe(3);
  });

  it("allows the full request when well under the cap", () => {
    expect(clampSpawnForActiveCap(0, 5)).toBe(5);
  });
});

describe("cap 8: bounded target-search radius", () => {
  it("clamps a search radius request that tries to exceed the bound", () => {
    expect(clampSearchRadius(999_999)).toBe(MAX_TARGET_SEARCH_RADIUS_PX);
  });

  it("leaves a radius under the bound unchanged", () => {
    expect(clampSearchRadius(100)).toBe(100);
  });

  it("never returns a negative radius", () => {
    expect(clampSearchRadius(-100)).toBe(0);
  });
});
