import { chaser, type EnemyDefinition } from "@carry-or-fall/game-content";
import { describe, expect, it } from "vitest";

import { buildWallGrid } from "./collision";
import { canDealContactDamage, isTouchingPlayer, spawnEnemy, stepEnemyMovement } from "./enemy";
import { createRng } from "./prng";
import type { Enemy, Wall } from "./world";

const NO_WALLS = buildWallGrid([]);

describe("spawnEnemy", () => {
  it("derives runtime stats from the content definition (stat derivation)", () => {
    const enemy = spawnEnemy(chaser, [{ x: 0, y: 0 }], createRng(1), 18, 0);
    expect(enemy.definitionId).toBe(chaser.id);
    expect(enemy.behavior).toBe(chaser.behavior);
    expect(enemy.health).toBe(chaser.health);
    expect(enemy.maxHealth).toBe(chaser.health);
    expect(enemy.moveSpeed).toBe(chaser.moveSpeed);
    expect(enemy.contactDamage).toBe(chaser.contactDamage);
    expect(enemy.contactDamageIntervalMs).toBe(chaser.contactDamageIntervalMs);
    expect(enemy.radius).toBe(18);
    expect(enemy.contactCooldownMs).toBe(0);
  });

  it("chooses a spawn point deterministically from the seed (M1.9 requirement 4)", () => {
    const candidates = [
      { x: 1, y: 1 },
      { x: 2, y: 2 },
      { x: 3, y: 3 },
    ];
    const a = spawnEnemy(chaser, candidates, createRng(99), 18, 0);
    const b = spawnEnemy(chaser, candidates, createRng(99), 18, 0);
    expect(a.position).toEqual(b.position);
    expect(candidates).toContainEqual(a.position);
  });

  it("gives distinct ids to enemies spawned with different spawnIndex values, without hidden module state", () => {
    const a = spawnEnemy(chaser, [{ x: 0, y: 0 }], createRng(1), 18, 0);
    const b = spawnEnemy(chaser, [{ x: 0, y: 0 }], createRng(1), 18, 1);
    expect(a.id).not.toBe(b.id);
  });

  it("throws when given no candidate spawn points", () => {
    expect(() => spawnEnemy(chaser, [], createRng(1), 18, 0)).toThrow(RangeError);
  });
});

function buildEnemy(overrides: Partial<Enemy> = {}): Enemy {
  return {
    id: "e1",
    definitionId: chaser.id,
    behavior: chaser.behavior,
    position: { x: 100, y: 0 },
    radius: 18,
    health: chaser.health,
    maxHealth: chaser.health,
    moveSpeed: chaser.moveSpeed,
    contactDamage: chaser.contactDamage,
    contactDamageIntervalMs: chaser.contactDamageIntervalMs,
    contactCooldownMs: 0,
    ...overrides,
  };
}

describe("stepEnemyMovement (chaser behavior, M1.9)", () => {
  it("moves toward the player when behavior is chaser", () => {
    const enemy = buildEnemy({ position: { x: 100, y: 0 } });
    const moved = stepEnemyMovement(enemy, { x: 0, y: 0 }, 50, 0.05, NO_WALLS);
    expect(moved.position.x).toBeLessThan(enemy.position.x);
  });

  it("does not move an enemy with a non-chaser behavior", () => {
    const enemy = buildEnemy({ behavior: "heavy" as EnemyDefinition["behavior"] });
    const moved = stepEnemyMovement(enemy, { x: 0, y: 0 }, 50, 0.05, NO_WALLS);
    expect(moved.position).toEqual(enemy.position);
  });

  it("is blocked by a wall exactly like the player's own movement", () => {
    // Enemy approaches from the wall's right side (starts at x=1000, chasing
    // the player at x=0), so it should stop at the wall's right edge.
    const wall: Wall = { x: 40, y: -50, width: 300, height: 200 };
    const grid = buildWallGrid([wall]);
    const enemy = buildEnemy({ position: { x: 1000, y: 0 } });
    let current = enemy;
    for (let i = 0; i < 200; i += 1) {
      current = stepEnemyMovement(current, { x: 0, y: 0 }, 50, 0.05, grid);
    }
    expect(current.position.x - current.radius).toBeGreaterThanOrEqual(wall.x + wall.width);
  });

  it("ticks the contact cooldown down regardless of behavior", () => {
    const enemy = buildEnemy({ contactCooldownMs: 100 });
    const moved = stepEnemyMovement(enemy, { x: 0, y: 0 }, 50, 0.05, NO_WALLS);
    expect(moved.contactCooldownMs).toBe(50);
  });

  it("does not divide by zero when already exactly at the player's position", () => {
    const enemy = buildEnemy({ position: { x: 0, y: 0 } });
    const moved = stepEnemyMovement(enemy, { x: 0, y: 0 }, 50, 0.05, NO_WALLS);
    expect(Number.isFinite(moved.position.x)).toBe(true);
    expect(Number.isFinite(moved.position.y)).toBe(true);
  });
});

describe("isTouchingPlayer / canDealContactDamage", () => {
  const player = { position: { x: 0, y: 0 }, radius: 16 };

  it("detects overlap when the enemy is close enough", () => {
    const enemy = buildEnemy({ position: { x: 20, y: 0 }, radius: 18 });
    expect(isTouchingPlayer(enemy, player)).toBe(true);
  });

  it("detects no overlap when the enemy is far away", () => {
    const enemy = buildEnemy({ position: { x: 1000, y: 0 } });
    expect(isTouchingPlayer(enemy, player)).toBe(false);
  });

  it("allows contact damage only when touching and the cooldown has elapsed", () => {
    const touching = buildEnemy({ position: { x: 20, y: 0 }, radius: 18, contactCooldownMs: 0 });
    expect(canDealContactDamage(touching, player)).toBe(true);

    const onCooldown = buildEnemy({
      position: { x: 20, y: 0 },
      radius: 18,
      contactCooldownMs: 200,
    });
    expect(canDealContactDamage(onCooldown, player)).toBe(false);

    const farAway = buildEnemy({ position: { x: 1000, y: 0 }, contactCooldownMs: 0 });
    expect(canDealContactDamage(farAway, player)).toBe(false);
  });
});
