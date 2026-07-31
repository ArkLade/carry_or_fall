import { basicBow, basicSword, chaser } from "@carry-or-fall/game-content";
import { describe, expect, it } from "vitest";

import { PLAYER_SPEED } from "./movement";
import {
  createSimulation,
  ENEMY_RADIUS,
  PLAYER_MAX_HEALTH,
  PLAYER_RADIUS,
  SIMULATION_DT_MS,
  stepSimulation,
  type SimulationConfig,
} from "./simulation";
import type { InputState, Wall } from "./world";

const NO_INPUT: InputState = {
  moveX: 0,
  moveY: 0,
  aimAngle: 0,
  attackPressed: false,
  secondaryAttackPressed: false,
  dashPressed: false,
};
const MOVE_RIGHT: InputState = { ...NO_INPUT, moveX: 1 };
const ATTACK: InputState = { ...NO_INPUT, attackPressed: true };
const FIRE: InputState = { ...NO_INPUT, secondaryAttackPressed: true };
const DASH_RIGHT: InputState = { ...NO_INPUT, moveX: 1, dashPressed: true };

const FAR_AWAY_SPAWN = { x: 100_000, y: 100_000 };

function newSimulation(overrides: Partial<SimulationConfig> = {}) {
  return createSimulation({
    walls: [],
    playerStart: { x: 0, y: 0 },
    meleeWeapon: basicSword,
    rangedWeapon: basicBow,
    enemyDefinition: chaser,
    enemySpawnPoints: [FAR_AWAY_SPAWN],
    seed: 1,
    ...overrides,
  });
}

describe("createSimulation", () => {
  it("places the player at playerStart, at full health, alive, with the configured weapons", () => {
    const walls: Wall[] = [{ x: 0, y: 0, width: 10, height: 10 }];
    const world = createSimulation({
      walls,
      playerStart: { x: 5, y: 7 },
      meleeWeapon: basicSword,
      rangedWeapon: basicBow,
      enemyDefinition: chaser,
      enemySpawnPoints: [FAR_AWAY_SPAWN],
      seed: 1,
    });
    expect(world.player.position).toEqual({ x: 5, y: 7 });
    expect(world.player.radius).toBe(PLAYER_RADIUS);
    expect(world.player.facing).toBe(0);
    expect(world.player.health).toBe(PLAYER_MAX_HEALTH);
    expect(world.player.maxHealth).toBe(PLAYER_MAX_HEALTH);
    expect(world.player.alive).toBe(true);
    expect(world.player.meleeWeapon).toBe(basicSword);
    expect(world.player.rangedWeapon).toBe(basicBow);
    expect(world.player.meleeAttack).toBeNull();
    expect(world.player.dashCooldownMs).toBe(0);
    expect(world.walls).toBe(walls);
    expect(world.projectiles).toEqual([]);
  });

  it("spawns exactly one enemy, deriving its runtime stats from the content definition (stat derivation)", () => {
    const world = newSimulation();
    expect(world.enemies).toHaveLength(1);
    const [enemy] = world.enemies;
    expect(enemy!.definitionId).toBe(chaser.id);
    expect(enemy!.behavior).toBe(chaser.behavior);
    expect(enemy!.health).toBe(chaser.health);
    expect(enemy!.maxHealth).toBe(chaser.health);
    expect(enemy!.moveSpeed).toBe(chaser.moveSpeed);
    expect(enemy!.contactDamage).toBe(chaser.contactDamage);
    expect(enemy!.radius).toBe(ENEMY_RADIUS);
  });

  it("chooses the enemy spawn point deterministically from the seed (M1.9 requirement 4)", () => {
    const candidates = [
      { x: 10, y: 10 },
      { x: 500, y: 500 },
      { x: -300, y: 200 },
    ];
    const a = newSimulation({ enemySpawnPoints: candidates, seed: 42 });
    const b = newSimulation({ enemySpawnPoints: candidates, seed: 42 });
    expect(a.enemies[0]!.position).toEqual(b.enemies[0]!.position);
    expect(candidates).toContainEqual(a.enemies[0]!.position);
  });

  it("a different seed can choose a different spawn point", () => {
    const candidates = [
      { x: 10, y: 10 },
      { x: 500, y: 500 },
      { x: -300, y: 200 },
      { x: 9000, y: -400 },
    ];
    const positions = new Set(
      [1, 2, 3, 4, 5, 6, 7, 8].map((seed) =>
        JSON.stringify(newSimulation({ enemySpawnPoints: candidates, seed }).enemies[0]!.position),
      ),
    );
    // Not asserting a specific seed->index mapping (that's an implementation
    // detail of createRng); asserting only that varying the seed is capable
    // of landing on more than one candidate.
    expect(positions.size).toBeGreaterThan(1);
  });
});

describe("stepSimulation: movement/collision (M1.1/M1.3/M1.5, unchanged this chunk)", () => {
  it("is the fixed 50 ms step per the technical plan §9.3", () => {
    expect(SIMULATION_DT_MS).toBe(50);
  });

  it("advances the player by exactly one fixed step's worth of movement", () => {
    const world = newSimulation();
    const { world: next } = stepSimulation(world, MOVE_RIGHT);
    const expectedDeltaX = PLAYER_SPEED * (SIMULATION_DT_MS / 1000);
    expect(next.player.position.x).toBeCloseTo(expectedDeltaX, 6);
  });

  it("is deterministic: identical world + input always produce identical output", () => {
    const world = newSimulation({ walls: [{ x: 40, y: -50, width: 20, height: 200 }] });
    const a = stepSimulation(world, MOVE_RIGHT);
    const b = stepSimulation(world, MOVE_RIGHT);
    expect(a).toEqual(b);
  });

  it("blocks the player at a wall across repeated fixed steps instead of tunneling through it", () => {
    const wall: Wall = { x: 40, y: -50, width: 20, height: 200 };
    let world = newSimulation({ walls: [wall] });
    for (let i = 0; i < 50; i += 1) {
      ({ world } = stepSimulation(world, MOVE_RIGHT));
    }
    expect(world.player.position.x + world.player.radius).toBeLessThanOrEqual(wall.x);
  });
});

describe("stepSimulation: aim (M1.4, unchanged this chunk)", () => {
  it("stores a finite aimAngle as the player's facing, normalized", () => {
    const world = newSimulation();
    const { world: next } = stepSimulation(world, { ...NO_INPUT, aimAngle: Math.PI / 2 });
    expect(next.player.facing).toBeCloseTo(Math.PI / 2, 10);
  });
});

describe("stepSimulation: dash (M1.S1)", () => {
  it("moves the player further than an ordinary step in the held movement direction", () => {
    const world = newSimulation();
    const { world: dashed } = stepSimulation(world, DASH_RIGHT);
    const { world: walked } = stepSimulation(world, MOVE_RIGHT);
    expect(dashed.player.position.x).toBeGreaterThan(walked.player.position.x);
  });

  it("sets a cooldown that blocks a second dash immediately after", () => {
    let world = newSimulation();
    ({ world } = stepSimulation(world, DASH_RIGHT));
    const xAfterFirstDash = world.player.position.x;
    ({ world } = stepSimulation(world, DASH_RIGHT));
    // Only the ordinary movement step applies now; position gain should be
    // much smaller than another full dash would add.
    const xAfterSecondAttempt = world.player.position.x;
    const ordinaryStepDistance = PLAYER_SPEED * (SIMULATION_DT_MS / 1000);
    expect(xAfterSecondAttempt - xAfterFirstDash).toBeCloseTo(ordinaryStepDistance, 6);
  });

  it("dashes toward facing when no movement direction is held", () => {
    const world = newSimulation();
    const { world: aimed } = stepSimulation(world, { ...NO_INPUT, aimAngle: Math.PI });
    const { world: dashed } = stepSimulation(aimed, {
      ...NO_INPUT,
      aimAngle: Math.PI,
      dashPressed: true,
    });
    expect(dashed.player.position.x).toBeLessThan(aimed.player.position.x);
  });

  it("is blocked by a wall exactly like ordinary movement", () => {
    const wall: Wall = { x: 30, y: -200, width: 300, height: 400 };
    const world = newSimulation({ walls: [wall] });
    const { world: next } = stepSimulation(world, DASH_RIGHT);
    expect(next.player.position.x + next.player.radius).toBeLessThanOrEqual(wall.x);
  });

  it("[D-2 regression] does not tunnel through a wall thinner than DASH_DISTANCE_PX (140px)", () => {
    // This is the exact scenario docs/M1_ISSUES.md's D-2 describes: a 20px
    // wall — the compact test map's actual wall thickness — is far thinner
    // than one dash, so the discrete (landing-position-only) check used to
    // let the dash land clean on the other side, undetected. Run against the
    // pre-fix code, this test fails (player ends up past the wall).
    const wall: Wall = { x: 30, y: -200, width: 20, height: 400 };
    const world = newSimulation({ walls: [wall] });
    const { world: next } = stepSimulation(world, DASH_RIGHT);
    expect(next.player.position.x + next.player.radius).toBeLessThanOrEqual(wall.x);
  });
});

describe("stepSimulation: swept wall collision fixes D-1 and D-2 (docs/M1_ISSUES.md)", () => {
  it("[D-1] stops a fast projectile that would otherwise cross a thin interior wall in one step", () => {
    // basic_bow travels 600 * 0.05 = 30px per step — already wider than this
    // 15px wall, so the old discrete endpoint-only check for projectiles
    // (there wasn't one at all) let it land clean on the far side. Run
    // against the pre-fix code, this test fails (the projectile survives,
    // positioned past the wall).
    const wall: Wall = { x: 10, y: -50, width: 15, height: 100 };
    let world = newSimulation({ walls: [wall] });
    ({ world } = stepSimulation(world, FIRE));
    expect(world.projectiles).toHaveLength(0);
  });

  it("[D-1] a wall between the player and the enemy stops the projectile before it can hit the enemy", () => {
    // Enemy sits far enough past the wall that reaching it takes a second
    // step; run against the pre-fix code, the projectile is not stopped by
    // the wall and damages the enemy on the second step, failing this test.
    const wall: Wall = { x: 10, y: -50, width: 15, height: 100 };
    let world = newSimulation({ walls: [wall], enemySpawnPoints: [{ x: 60, y: 0 }] });
    ({ world } = stepSimulation(world, FIRE));
    ({ world } = stepSimulation(world, NO_INPUT));
    expect(world.enemies[0]!.health).toBe(chaser.health);
    expect(world.projectiles).toHaveLength(0);
  });
});

describe("stepSimulation: melee/ranged attacks now target the real enemy (M1.6-M1.9 integration)", () => {
  it("damages the enemy once a melee swing reaches its active window", () => {
    let world = newSimulation({ enemySpawnPoints: [{ x: 40, y: 0 }] });
    ({ world } = stepSimulation(world, ATTACK));
    const stepsToActive = Math.ceil(basicSword.windupMs! / SIMULATION_DT_MS);
    for (let i = 0; i < stepsToActive; i += 1) {
      ({ world } = stepSimulation(world, NO_INPUT));
    }
    expect(world.enemies[0]!.health).toBe(chaser.health - basicSword.damage);
  });

  it("removes the enemy once its health reaches zero", () => {
    // chaser.health (20) needs two basic_sword swings (12 damage each) to kill.
    let world = newSimulation({ enemySpawnPoints: [{ x: 40, y: 0 }] });
    const stepsToActive = Math.ceil(basicSword.windupMs! / SIMULATION_DT_MS);
    const attackIntervalSteps = Math.ceil(basicSword.attackIntervalMs / SIMULATION_DT_MS);

    ({ world } = stepSimulation(world, ATTACK));
    for (let i = 0; i < stepsToActive; i += 1) {
      ({ world } = stepSimulation(world, NO_INPUT));
    }
    expect(world.enemies[0]!.health).toBe(chaser.health - basicSword.damage);

    const remainingCooldownSteps = attackIntervalSteps - (1 + stepsToActive);
    for (let i = 0; i < remainingCooldownSteps; i += 1) {
      ({ world } = stepSimulation(world, NO_INPUT));
    }

    ({ world } = stepSimulation(world, ATTACK));
    for (let i = 0; i < stepsToActive; i += 1) {
      ({ world } = stepSimulation(world, NO_INPUT));
    }
    expect(world.enemies).toHaveLength(0);
  });

  it("damages the enemy with a bow projectile", () => {
    let world = newSimulation({ enemySpawnPoints: [{ x: 30, y: 0 }] });
    ({ world } = stepSimulation(world, FIRE));
    expect(world.enemies[0]!.health).toBe(chaser.health - basicBow.damage);
    expect(world.projectiles).toHaveLength(0); // consumed on hit
  });
});

describe("stepSimulation: chaser movement and contact damage (M1.9/M1.10)", () => {
  it("moves the enemy toward the player over successive steps", () => {
    let world = newSimulation({ enemySpawnPoints: [{ x: 500, y: 0 }] });
    const startDistance = world.enemies[0]!.position.x - world.player.position.x;
    for (let i = 0; i < 10; i += 1) {
      ({ world } = stepSimulation(world, NO_INPUT));
    }
    const endDistance = world.enemies[0]!.position.x - world.player.position.x;
    expect(endDistance).toBeLessThan(startDistance);
  });

  it("does not move an enemy whose behavior is not chaser (data-driven dispatch)", () => {
    const world = newSimulation({
      enemyDefinition: { ...chaser, behavior: "heavy" },
      enemySpawnPoints: [{ x: 500, y: 0 }],
    });
    const { world: next } = stepSimulation(world, NO_INPUT);
    expect(next.enemies[0]!.position).toEqual(world.enemies[0]!.position);
  });

  it("damages the player on contact, then gates further contact damage by a cooldown", () => {
    const touchingDistance = PLAYER_RADIUS + ENEMY_RADIUS - 1;
    let world = newSimulation({ enemySpawnPoints: [{ x: touchingDistance, y: 0 }] });
    ({ world } = stepSimulation(world, NO_INPUT));
    expect(world.player.health).toBe(PLAYER_MAX_HEALTH - chaser.contactDamage);

    // Immediately stepping again (well within the contact cooldown) must not re-damage.
    ({ world } = stepSimulation(world, NO_INPUT));
    expect(world.player.health).toBe(PLAYER_MAX_HEALTH - chaser.contactDamage);

    // After the contact cooldown fully elapses, contact damage can apply again.
    const stepsToCooldown = Math.ceil(chaser.contactDamageIntervalMs / SIMULATION_DT_MS);
    for (let i = 0; i < stepsToCooldown; i += 1) {
      ({ world } = stepSimulation(world, NO_INPUT));
    }
    expect(world.player.health).toBe(PLAYER_MAX_HEALTH - 2 * chaser.contactDamage);
  });
});

describe("stepSimulation: player health and death (M1.10)", () => {
  it("kills the player once health reaches zero and ends the run", () => {
    const touchingDistance = PLAYER_RADIUS + ENEMY_RADIUS - 1;
    const highContactDamageEnemy = { ...chaser, contactDamage: PLAYER_MAX_HEALTH };
    let world = newSimulation({
      enemyDefinition: highContactDamageEnemy,
      enemySpawnPoints: [{ x: touchingDistance, y: 0 }],
    });
    ({ world } = stepSimulation(world, NO_INPUT));
    expect(world.player.health).toBe(0);
    expect(world.player.alive).toBe(false);
  });

  it("stops all processing once the player is dead (movement, cooldowns, everything freezes)", () => {
    const touchingDistance = PLAYER_RADIUS + ENEMY_RADIUS - 1;
    const highContactDamageEnemy = { ...chaser, contactDamage: PLAYER_MAX_HEALTH };
    let world = newSimulation({
      enemyDefinition: highContactDamageEnemy,
      enemySpawnPoints: [{ x: touchingDistance, y: 0 }],
    });
    ({ world } = stepSimulation(world, NO_INPUT));
    expect(world.player.alive).toBe(false);

    const { world: next, hitEvents } = stepSimulation(world, MOVE_RIGHT);
    expect(next).toEqual(world); // fully frozen: not even movement applies
    expect(hitEvents).toEqual([]);
  });
});
