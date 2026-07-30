import { basicBow, basicSword } from "@carry-or-fall/game-content";
import { describe, expect, it } from "vitest";

import { PLAYER_SPEED } from "./movement";
import { createSimulation, PLAYER_RADIUS, SIMULATION_DT_MS, stepSimulation } from "./simulation";
import type { AttackTarget } from "./combat/pipeline";
import type { InputState, Wall } from "./world";

const NO_INPUT: InputState = {
  moveX: 0,
  moveY: 0,
  aimAngle: 0,
  attackPressed: false,
  secondaryAttackPressed: false,
};
const MOVE_RIGHT: InputState = { ...NO_INPUT, moveX: 1 };
const ATTACK: InputState = { ...NO_INPUT, attackPressed: true };
const FIRE: InputState = { ...NO_INPUT, secondaryAttackPressed: true };

function newSimulation(walls: readonly Wall[] = [], playerStart = { x: 0, y: 0 }) {
  return createSimulation({ walls, playerStart, meleeWeapon: basicSword, rangedWeapon: basicBow });
}

describe("createSimulation", () => {
  it("places the player at playerStart with the walls and weapons from config", () => {
    const walls: Wall[] = [{ x: 0, y: 0, width: 10, height: 10 }];
    const world = createSimulation({
      walls,
      playerStart: { x: 5, y: 7 },
      meleeWeapon: basicSword,
      rangedWeapon: basicBow,
    });
    expect(world.player.position).toEqual({ x: 5, y: 7 });
    expect(world.player.radius).toBe(PLAYER_RADIUS);
    expect(world.player.facing).toBe(0);
    expect(world.player.meleeWeapon).toBe(basicSword);
    expect(world.player.rangedWeapon).toBe(basicBow);
    expect(world.player.meleeAttack).toBeNull();
    expect(world.walls).toBe(walls);
    expect(world.projectiles).toEqual([]);
  });
});

describe("stepSimulation: movement/collision (fixed step, M1.1/M1.3/M1.5, unchanged this chunk)", () => {
  it("is the fixed 50 ms step per the technical plan §9.3", () => {
    expect(SIMULATION_DT_MS).toBe(50);
  });

  it("advances the player by exactly one fixed step's worth of movement, regardless of any render timing", () => {
    const world = newSimulation();
    const { world: next } = stepSimulation(world, MOVE_RIGHT);
    const expectedDeltaX = PLAYER_SPEED * (SIMULATION_DT_MS / 1000);
    expect(next.player.position.x).toBeCloseTo(expectedDeltaX, 6);
    expect(next.player.position.y).toBe(0);
  });

  it("does not move the player when no input is given", () => {
    const world = newSimulation([], { x: 10, y: 10 });
    const { world: next } = stepSimulation(world, NO_INPUT);
    expect(next.player.position).toEqual({ x: 10, y: 10 });
  });

  it("is deterministic: identical world + input always produce identical output", () => {
    const world = newSimulation([{ x: 40, y: -50, width: 20, height: 200 }]);
    const a = stepSimulation(world, MOVE_RIGHT);
    const b = stepSimulation(world, MOVE_RIGHT);
    expect(a).toEqual(b);
  });

  it("blocks the player at a wall across repeated fixed steps instead of tunneling through it", () => {
    const wall: Wall = { x: 40, y: -50, width: 20, height: 200 };
    let world = newSimulation([wall]);

    for (let i = 0; i < 50; i += 1) {
      ({ world } = stepSimulation(world, MOVE_RIGHT));
    }

    expect(world.player.position.x + world.player.radius).toBeLessThanOrEqual(wall.x);
  });

  it("does not mutate the input world (each step returns a new world)", () => {
    const world = newSimulation();
    const originalPosition = world.player.position;
    stepSimulation(world, MOVE_RIGHT);
    expect(world.player.position).toBe(originalPosition);
  });
});

describe("stepSimulation: aim (M1.4)", () => {
  it("stores a finite aimAngle as the player's facing, normalized", () => {
    const world = newSimulation();
    const { world: next } = stepSimulation(world, { ...NO_INPUT, aimAngle: Math.PI / 2 });
    expect(next.player.facing).toBeCloseTo(Math.PI / 2, 10);
  });

  it("normalizes an aimAngle outside (-π, π] into that range", () => {
    const world = newSimulation();
    const { world: next } = stepSimulation(world, { ...NO_INPUT, aimAngle: 3 * Math.PI });
    expect(next.player.facing).toBeCloseTo(Math.PI, 10);
  });

  it("ignores a non-finite aimAngle instead of corrupting facing", () => {
    const world = newSimulation();
    const { world: afterAim } = stepSimulation(world, { ...NO_INPUT, aimAngle: 1.23 });
    const { world: next } = stepSimulation(afterAim, { ...NO_INPUT, aimAngle: NaN });
    expect(next.player.facing).toBeCloseTo(1.23, 10);
  });
});

describe("stepSimulation: melee attack (M1.6/M1.7)", () => {
  it("does not start a second swing while one is already in flight", () => {
    const world = newSimulation();
    const { world: afterFirst } = stepSimulation(world, ATTACK);
    expect(afterFirst.player.meleeAttack).not.toBeNull();
    // Holding attack mid-swing (still in windup/active/recovery) must advance
    // the existing swing, not reset a fresh one back to elapsedMs 0.
    const { world: afterSecond } = stepSimulation(afterFirst, ATTACK);
    expect(afterSecond.player.meleeAttack?.elapsedMs).toBe(SIMULATION_DT_MS);
  });

  it("respects the attack interval: cannot swing again until the cooldown fully elapses", () => {
    let world = newSimulation();
    ({ world } = stepSimulation(world, ATTACK)); // starts swing 1, sets cooldown to attackIntervalMs

    const totalSwingSteps = Math.ceil(
      (basicSword.windupMs! + basicSword.activeMs! + basicSword.recoveryMs!) / SIMULATION_DT_MS,
    );
    for (let i = 0; i < totalSwingSteps; i += 1) {
      ({ world } = stepSimulation(world, NO_INPUT));
    }
    expect(world.player.meleeAttack).toBeNull(); // swing 1 finished

    // Cooldown (500ms) is longer than the swing duration here, so pressing
    // attack again right away must still be refused (still on cooldown).
    ({ world } = stepSimulation(world, ATTACK));
    expect(world.player.meleeAttack).toBeNull();
  });

  it("damages a target once it enters the active window, and only once per swing", () => {
    const target: AttackTarget = { id: "t1", position: { x: 40, y: 0 }, radius: 8, health: 20 };
    let world = newSimulation();
    let targets: readonly AttackTarget[] = [target];

    ({ world, targets } = stepSimulation(world, ATTACK, targets));
    expect(targets[0]!.health).toBe(20); // still in windup, not yet resolved

    const stepsToActive = Math.ceil(basicSword.windupMs! / SIMULATION_DT_MS);
    for (let i = 0; i < stepsToActive; i += 1) {
      ({ world, targets } = stepSimulation(world, NO_INPUT, targets));
    }
    expect(targets[0]!.health).toBe(20 - basicSword.damage);

    // Continuing through the rest of the active window must not re-apply damage.
    const stepsRemainingActive = Math.ceil(basicSword.activeMs! / SIMULATION_DT_MS);
    for (let i = 0; i < stepsRemainingActive; i += 1) {
      ({ world, targets } = stepSimulation(world, NO_INPUT, targets));
    }
    expect(targets[0]!.health).toBe(20 - basicSword.damage);
  });
});

describe("stepSimulation: ranged attack (M1.6/M1.8)", () => {
  it("spawns a projectile into world.projectiles on secondaryAttackPressed", () => {
    const world = newSimulation();
    const { world: next } = stepSimulation(world, FIRE);
    expect(next.projectiles).toHaveLength(1);
    expect(next.projectiles[0]!.damage).toBe(basicBow.damage);
  });

  it("respects the bow's attack interval before firing again", () => {
    let world = newSimulation();
    ({ world } = stepSimulation(world, FIRE));
    expect(world.projectiles).toHaveLength(1);
    ({ world } = stepSimulation(world, FIRE)); // still on cooldown
    expect(world.projectiles).toHaveLength(1);
  });

  it("moves a spawned projectile on subsequent steps", () => {
    let world = newSimulation();
    ({ world } = stepSimulation(world, FIRE));
    const firstPosition = world.projectiles[0]!.position;
    ({ world } = stepSimulation(world, NO_INPUT));
    expect(world.projectiles[0]!.position.x).toBeGreaterThan(firstPosition.x);
  });

  it("damages a target the projectile reaches", () => {
    const target: AttackTarget = { id: "t1", position: { x: 30, y: 0 }, radius: 8, health: 20 };
    let world = newSimulation();
    let targets: readonly AttackTarget[] = [target];
    ({ world, targets } = stepSimulation(world, FIRE, targets));
    ({ world, targets } = stepSimulation(world, NO_INPUT, targets));
    expect(targets[0]!.health).toBe(20 - basicBow.damage);
    expect(world.projectiles).toHaveLength(0);
  });
});
