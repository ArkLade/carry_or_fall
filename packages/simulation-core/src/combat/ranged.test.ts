import { describe, expect, it } from "vitest";

import { basicBow, type WeaponDefinition } from "@carry-or-fall/game-content";

import { buildWallGrid } from "../collision";
import type { Wall } from "../world";
import { MAX_PROJECTILES_PER_ATTACK } from "./caps";
import type { AttackActor, AttackTarget } from "./pipeline";
import { PROJECTILE_LIFESPAN_MS, startRangedAttack, stepProjectiles } from "./ranged";

const ACTOR: AttackActor = { position: { x: 0, y: 0 }, facing: 0, radius: 16 };
const NO_WALLS = buildWallGrid([]);

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
