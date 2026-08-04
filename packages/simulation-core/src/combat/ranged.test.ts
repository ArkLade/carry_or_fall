import { describe, expect, it } from "vitest";

import { basicBow, type WeaponDefinition } from "@carry-or-fall/game-content";

import { buildWallGrid } from "../collision";
import { NO_SKILL_EFFECTS } from "../skill-effects";
import type { Projectile, Wall } from "../world";
import {
  MAX_BOUNCES,
  MAX_PIERCES,
  MAX_PROJECTILES_PER_ATTACK,
  MAX_RETURNS_PER_PROJECTILE,
  MAX_TARGET_SEARCH_RADIUS_PX,
} from "./caps";
import type { AttackActor, AttackTarget } from "./pipeline";
import {
  HOMING_SEARCH_RADIUS_PX,
  PROJECTILE_LIFESPAN_MS,
  PROJECTILE_RADIUS_PX,
  startRangedAttack,
  stepProjectiles,
} from "./ranged";

const ACTOR: AttackActor = { id: "player-1", position: { x: 0, y: 0 }, facing: 0, radius: 16 };
const NO_WALLS = buildWallGrid([]);

/** A bow with generous bounce/pierce limits, so a skill's effect isn't hidden by the weapon's own ceiling. */
const GENEROUS_BOW: WeaponDefinition = {
  ...basicBow,
  id: "generous_bow",
  limits: { maxProjectilesPerAttack: 8, maxBounces: 3, maxPierces: 3 },
};

describe("startRangedAttack", () => {
  it("refuses to fire while the bow's cooldown has not elapsed", () => {
    const result = startRangedAttack(ACTOR, basicBow, 100, 0, 0);
    expect(result).toEqual({ started: false, reason: "cooldown" });
  });

  it("spawns basic_bow's single straight projectile once cooldown has elapsed", () => {
    const result = startRangedAttack(ACTOR, basicBow, 0, 0, 1);
    expect(result.started).toBe(true);
    if (!result.started) throw new Error("expected started");
    expect(result.projectiles).toHaveLength(1);
    const [projectile] = result.projectiles;
    expect(projectile!.position).toEqual(ACTOR.position);
    expect(projectile!.velocity).toEqual({ x: basicBow.projectileSpeed, y: 0 });
    expect(projectile!.damage).toBe(basicBow.damage);
    expect(projectile!.remainingLifespanMs).toBe(PROJECTILE_LIFESPAN_MS);
  });

  it("is deterministic: identical inputs spawn identical projectiles (no randomness is used)", () => {
    const a = startRangedAttack(ACTOR, basicBow, 0, 0, 7);
    const b = startRangedAttack(ACTOR, basicBow, 0, 0, 7);
    expect(a).toEqual(b);
  });
});

describe("cap 1 (max projectiles per attack) enforced end-to-end through startRangedAttack", () => {
  it("clamps a fabricated weapon definition that tries to exceed the shared cap", () => {
    const overclaimingWeapon: WeaponDefinition = {
      ...basicBow,
      id: "fabricated_overclaiming_bow",
      projectileCount: 999,
      limits: { maxProjectilesPerAttack: 999, maxBounces: 999, maxPierces: 999 },
    };

    const result = startRangedAttack(ACTOR, overclaimingWeapon, 0, 0, 0);
    expect(result.started).toBe(true);
    if (!result.started) throw new Error("expected started");
    expect(result.projectiles.length).toBe(MAX_PROJECTILES_PER_ATTACK);
  });

  it("clamps a skill claiming an enormous projectileCountAdd, driven through the real skill pipeline (M3.3)", () => {
    // multishot alone (+2) wouldn't exceed 8 from basic_bow's base of 1; a
    // fabricated projectileCountAdd proves the cap holds regardless of how
    // large a real (or future) skill's contribution might be.
    const skillEffects = { ...NO_SKILL_EFFECTS, projectileCountAdd: 999 };
    const result = startRangedAttack(ACTOR, GENEROUS_BOW, 0, 0, 0, undefined, skillEffects);
    expect(result.started).toBe(true);
    if (!result.started) throw new Error("expected started");
    expect(result.projectiles.length).toBe(MAX_PROJECTILES_PER_ATTACK);
  });
});

describe("cap 7 (per-player active projectile cap) enforced end-to-end through startRangedAttack", () => {
  it("spawns nothing when the player is already at the active-projectile cap", () => {
    const manyProjectilesWeapon: WeaponDefinition = {
      ...basicBow,
      id: "fabricated_many_projectiles_bow",
      projectileCount: 8,
      limits: { maxProjectilesPerAttack: 8, maxBounces: 0, maxPierces: 0 },
    };

    const result = startRangedAttack(ACTOR, manyProjectilesWeapon, 0, 24, 0);
    expect(result.started).toBe(true);
    if (!result.started) throw new Error("expected started");
    expect(result.projectiles).toHaveLength(0);
  });
});

describe("stepProjectiles", () => {
  it("moves a projectile along its velocity by dtSeconds", () => {
    const result = startRangedAttack(ACTOR, basicBow, 0, 0, 0);
    if (!result.started) throw new Error("expected started");

    const { projectiles } = stepProjectiles(result.projectiles, 50, 0.05, [], NO_WALLS);
    expect(projectiles).toHaveLength(1);
    expect(projectiles[0]!.position.x).toBeCloseTo(basicBow.projectileSpeed! * 0.05, 6);
  });

  it("expires a projectile once its lifespan reaches zero", () => {
    const result = startRangedAttack(ACTOR, basicBow, 0, 0, 0);
    if (!result.started) throw new Error("expected started");

    let projectiles = result.projectiles;
    const stepsToExpire = Math.ceil(PROJECTILE_LIFESPAN_MS / 50) + 1;
    for (let i = 0; i < stepsToExpire; i += 1) {
      ({ projectiles } = stepProjectiles(projectiles, 50, 0.05, [], NO_WALLS));
    }
    expect(projectiles).toHaveLength(0);
  });

  it("damages and removes a projectile that overlaps a target, and does not pierce through it", () => {
    const target: AttackTarget = {
      id: "enemy-1",
      position: { x: 30, y: 0 },
      radius: 8,
      health: 20,
    };
    const result = startRangedAttack(ACTOR, basicBow, 0, 0, 0);
    if (!result.started) throw new Error("expected started");

    // One step at basic_bow's speed (600px/s) * 0.05s = 30px covers the gap to the target.
    const { projectiles, updatedTargets, hitEvents } = stepProjectiles(
      result.projectiles,
      50,
      0.05,
      [target],
      NO_WALLS,
    );

    expect(projectiles).toHaveLength(0); // consumed on hit, no pierce behavior in M1
    expect(updatedTargets[0]!.health).toBe(20 - basicBow.damage);
    expect(hitEvents).toHaveLength(1);
    expect(hitEvents[0]!.targetId).toBe("enemy-1");
  });

  it("leaves a target untouched when no projectile overlaps it", () => {
    const target: AttackTarget = {
      id: "enemy-1",
      position: { x: 5000, y: 5000 },
      radius: 8,
      health: 20,
    };
    const result = startRangedAttack(ACTOR, basicBow, 0, 0, 0);
    if (!result.started) throw new Error("expected started");

    const { updatedTargets, hitEvents } = stepProjectiles(
      result.projectiles,
      50,
      0.05,
      [target],
      NO_WALLS,
    );
    expect(updatedTargets).toEqual([target]);
    expect(hitEvents).toEqual([]);
  });
});

describe("stepProjectiles: wall collision (D-1, resolved)", () => {
  it("[D-1] stops and removes a fast projectile that would otherwise cross a thin wall in one step", () => {
    // basic_bow covers 30px/step (600px/s * 0.05s), wider than this 15px wall.
    const wall: Wall = { x: 10, y: -50, width: 15, height: 100 };
    const grid = buildWallGrid([wall]);
    const result = startRangedAttack(ACTOR, basicBow, 0, 0, 0);
    if (!result.started) throw new Error("expected started");

    const { projectiles } = stepProjectiles(result.projectiles, 50, 0.05, [], grid);
    expect(projectiles).toHaveLength(0);
  });

  it("[D-1] a wall stops the projectile before it can hit a target on the far side", () => {
    const wall: Wall = { x: 10, y: -50, width: 15, height: 100 };
    const grid = buildWallGrid([wall]);
    const target: AttackTarget = {
      id: "enemy-1",
      position: { x: 60, y: 0 },
      radius: 8,
      health: 20,
    };
    const result = startRangedAttack(ACTOR, basicBow, 0, 0, 0);
    if (!result.started) throw new Error("expected started");

    const { projectiles, updatedTargets, hitEvents } = stepProjectiles(
      result.projectiles,
      50,
      0.05,
      [target],
      grid,
    );
    expect(projectiles).toHaveLength(0);
    expect(updatedTargets).toEqual([target]); // undamaged — the wall protected it
    expect(hitEvents).toEqual([]);
  });

  it("does not stop a projectile whose path has no wall in it", () => {
    const wall: Wall = { x: 10_000, y: 10_000, width: 15, height: 100 }; // far away
    const grid = buildWallGrid([wall]);
    const result = startRangedAttack(ACTOR, basicBow, 0, 0, 0);
    if (!result.started) throw new Error("expected started");

    const { projectiles } = stepProjectiles(result.projectiles, 50, 0.05, [], grid);
    expect(projectiles).toHaveLength(1);
  });
});

describe("cap 2 (bounces): ricochet-style skill behavior end-to-end (M3.4)", () => {
  it("reflects off a wall instead of being removed when a skill grants bounces", () => {
    const wall: Wall = { x: 10, y: -50, width: 15, height: 100 };
    const grid = buildWallGrid([wall]);
    const skillEffects = { ...NO_SKILL_EFFECTS, bounceCountAdd: 1 };
    const result = startRangedAttack(ACTOR, GENEROUS_BOW, 0, 0, 0, undefined, skillEffects);
    if (!result.started) throw new Error("expected started");
    expect(result.projectiles[0]!.bouncesRemaining).toBe(1);

    const { projectiles } = stepProjectiles(result.projectiles, 50, 0.05, [], grid);
    expect(projectiles).toHaveLength(1); // survives — bounced, not removed
    expect(projectiles[0]!.velocity.x).toBeLessThan(0); // reflected away from the wall
    expect(projectiles[0]!.bouncesRemaining).toBe(0);
  });

  it("is removed once its bounces are exhausted, exactly like the M1 no-bounce case", () => {
    const wall: Wall = { x: 10, y: -50, width: 15, height: 100 };
    const grid = buildWallGrid([wall]);
    const exhausted: Projectile = {
      id: "p-exhausted",
      ownerId: "player-1",
      position: { x: 0, y: 0 },
      velocity: { x: 600, y: 0 },
      radius: PROJECTILE_RADIUS_PX,
      damage: 10,
      remainingLifespanMs: PROJECTILE_LIFESPAN_MS,
      bouncesRemaining: 0,
      piercesRemaining: 0,
      canReturn: false,
      returnsSoFar: 0,
      homingStrength: 0,
      postBounceDamageMultiplier: 1,
      hitTargetIds: [],
      splitCount: 0,
      isSplitChild: false,
    };
    const { projectiles } = stepProjectiles([exhausted], 50, 0.05, [], grid);
    expect(projectiles).toHaveLength(0);
  });

  it("clamps a skill claiming an enormous bounceCountAdd to MAX_BOUNCES (cap 2 holds under real skill load)", () => {
    const skillEffects = { ...NO_SKILL_EFFECTS, bounceCountAdd: 999 };
    const result = startRangedAttack(ACTOR, GENEROUS_BOW, 0, 0, 0, undefined, skillEffects);
    if (!result.started) throw new Error("expected started");
    expect(result.projectiles[0]!.bouncesRemaining).toBe(MAX_BOUNCES);
  });
});

describe("cap 3 (pierces): piercing-rounds-style skill behavior end-to-end (M3.4)", () => {
  it("damages two targets in sequence without being consumed after the first, and does not double-hit one", () => {
    const targetA: AttackTarget = { id: "a", position: { x: 30, y: 0 }, radius: 8, health: 20 };
    const targetB: AttackTarget = { id: "b", position: { x: 60, y: 0 }, radius: 8, health: 20 };
    const skillEffects = { ...NO_SKILL_EFFECTS, pierceCountAdd: 1 };
    const result = startRangedAttack(ACTOR, GENEROUS_BOW, 0, 0, 0, undefined, skillEffects);
    if (!result.started) throw new Error("expected started");
    expect(result.projectiles[0]!.piercesRemaining).toBe(1);

    // Step 1: 30px covers the gap to targetA (600px/s * 0.05s).
    const step1 = stepProjectiles(result.projectiles, 50, 0.05, [targetA, targetB], NO_WALLS);
    expect(step1.projectiles).toHaveLength(1); // pierced through, not consumed
    expect(step1.updatedTargets.find((t) => t.id === "a")!.health).toBe(20 - GENEROUS_BOW.damage);
    expect(step1.projectiles[0]!.piercesRemaining).toBe(0);
    expect(step1.projectiles[0]!.hitTargetIds).toEqual(["a"]);

    // Step 2: another 30px covers the gap to targetB; no pierces left, so consumed after this hit.
    const step2 = stepProjectiles(step1.projectiles, 50, 0.05, step1.updatedTargets, NO_WALLS);
    expect(step2.projectiles).toHaveLength(0);
    expect(step2.updatedTargets.find((t) => t.id === "b")!.health).toBe(20 - GENEROUS_BOW.damage);
    // targetA was not hit again even though the projectile passed through its former position.
    expect(step2.updatedTargets.find((t) => t.id === "a")!.health).toBe(20 - GENEROUS_BOW.damage);
  });

  it("clamps a skill claiming an enormous pierceCountAdd to MAX_PIERCES (cap 3 holds under real skill load)", () => {
    const skillEffects = { ...NO_SKILL_EFFECTS, pierceCountAdd: 999 };
    const result = startRangedAttack(ACTOR, GENEROUS_BOW, 0, 0, 0, undefined, skillEffects);
    if (!result.started) throw new Error("expected started");
    expect(result.projectiles[0]!.piercesRemaining).toBe(MAX_PIERCES);
  });
});

describe("cap 4 (returns): returning-shot-style skill behavior end-to-end (M3.4)", () => {
  it("reverses direction on lifespan expiry instead of being removed, when a skill grants a return", () => {
    const skillEffects = { ...NO_SKILL_EFFECTS, returnEnabled: true };
    const result = startRangedAttack(ACTOR, GENEROUS_BOW, 0, 0, 0, undefined, skillEffects);
    if (!result.started) throw new Error("expected started");
    expect(result.projectiles[0]!.canReturn).toBe(true);

    let projectiles = result.projectiles;
    const stepsToExpire = Math.ceil(PROJECTILE_LIFESPAN_MS / 50) + 1;
    for (let i = 0; i < stepsToExpire; i += 1) {
      ({ projectiles } = stepProjectiles(projectiles, 50, 0.05, [], NO_WALLS));
    }
    expect(projectiles).toHaveLength(1); // returned instead of expiring
    expect(projectiles[0]!.velocity.x).toBeLessThan(0); // reversed
    expect(projectiles[0]!.returnsSoFar).toBe(1);
  });

  it("is removed on its second lifespan expiry (no more than MAX_RETURNS_PER_PROJECTILE returns)", () => {
    const alreadyReturned: Projectile = {
      id: "p-returned",
      ownerId: "player-1",
      position: { x: 0, y: 0 },
      velocity: { x: -600, y: 0 },
      radius: PROJECTILE_RADIUS_PX,
      damage: 10,
      remainingLifespanMs: 10,
      bouncesRemaining: 0,
      piercesRemaining: 0,
      canReturn: true,
      returnsSoFar: MAX_RETURNS_PER_PROJECTILE,
      homingStrength: 0,
      postBounceDamageMultiplier: 1,
      hitTargetIds: [],
      splitCount: 0,
      isSplitChild: false,
    };
    const { projectiles } = stepProjectiles([alreadyReturned], 50, 0.05, [], NO_WALLS);
    expect(projectiles).toHaveLength(0);
  });
});

describe("cap 8 (bounded target search radius): homing-arrows-style skill behavior end-to-end (M3.4)", () => {
  it("bends trajectory toward an off-axis target within the bounded search radius", () => {
    const skillEffects = { ...NO_SKILL_EFFECTS, homingStrengthAdd: 1 };
    const result = startRangedAttack(ACTOR, GENEROUS_BOW, 0, 0, 0, undefined, skillEffects);
    if (!result.started) throw new Error("expected started");

    const target: AttackTarget = { id: "t", position: { x: 100, y: 100 }, radius: 8, health: 20 };
    const { projectiles } = stepProjectiles(result.projectiles, 50, 0.05, [target], NO_WALLS);
    expect(projectiles).toHaveLength(1);
    // Steered toward the target (below the x-axis it started on).
    expect(projectiles[0]!.velocity.y).toBeGreaterThan(0);
  });

  it("does not steer toward a target beyond MAX_TARGET_SEARCH_RADIUS_PX, even though HOMING_SEARCH_RADIUS_PX would reach it (cap 8 holds under real skill load)", () => {
    expect(HOMING_SEARCH_RADIUS_PX).toBeGreaterThan(MAX_TARGET_SEARCH_RADIUS_PX);
    const skillEffects = { ...NO_SKILL_EFFECTS, homingStrengthAdd: 1 };
    const result = startRangedAttack(ACTOR, GENEROUS_BOW, 0, 0, 0, undefined, skillEffects);
    if (!result.started) throw new Error("expected started");

    // Placed beyond the shared cap but within HOMING_SEARCH_RADIUS_PX.
    const farTarget: AttackTarget = {
      id: "far",
      position: { x: 0, y: MAX_TARGET_SEARCH_RADIUS_PX + 50 },
      radius: 8,
      health: 20,
    };
    const { projectiles } = stepProjectiles(result.projectiles, 50, 0.05, [farTarget], NO_WALLS);
    expect(projectiles).toHaveLength(1);
    // Not steered: still traveling straight along the original facing (y stays 0).
    expect(projectiles[0]!.velocity.y).toBe(0);
  });
});
