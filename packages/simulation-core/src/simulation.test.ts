import { describe, expect, it } from "vitest";

import { PLAYER_SPEED } from "./movement";
import { createSimulation, PLAYER_RADIUS, SIMULATION_DT_MS, stepSimulation } from "./simulation";
import type { InputState, Wall } from "./world";

const NO_INPUT: InputState = { moveX: 0, moveY: 0 };
const MOVE_RIGHT: InputState = { moveX: 1, moveY: 0 };

describe("createSimulation", () => {
  it("places the player at playerStart with the walls from config", () => {
    const walls: Wall[] = [{ x: 0, y: 0, width: 10, height: 10 }];
    const world = createSimulation({ walls, playerStart: { x: 5, y: 7 } });
    expect(world.player.position).toEqual({ x: 5, y: 7 });
    expect(world.player.radius).toBe(PLAYER_RADIUS);
    expect(world.walls).toBe(walls);
  });
});

describe("stepSimulation (fixed step, M1.1/M1.3)", () => {
  it("is the fixed 50 ms step per the technical plan §9.3", () => {
    expect(SIMULATION_DT_MS).toBe(50);
  });

  it("advances the player by exactly one fixed step's worth of movement, regardless of any render timing", () => {
    const world = createSimulation({ walls: [], playerStart: { x: 0, y: 0 } });
    const next = stepSimulation(world, MOVE_RIGHT);
    const expectedDeltaX = PLAYER_SPEED * (SIMULATION_DT_MS / 1000);
    expect(next.player.position.x).toBeCloseTo(expectedDeltaX, 6);
    expect(next.player.position.y).toBe(0);
  });

  it("does not move the player when no input is given", () => {
    const world = createSimulation({ walls: [], playerStart: { x: 10, y: 10 } });
    const next = stepSimulation(world, NO_INPUT);
    expect(next.player.position).toEqual({ x: 10, y: 10 });
  });

  it("is deterministic: identical world + input always produce identical output", () => {
    const world = createSimulation({
      walls: [{ x: 40, y: -50, width: 20, height: 200 }],
      playerStart: { x: 0, y: 0 },
    });
    const a = stepSimulation(world, MOVE_RIGHT);
    const b = stepSimulation(world, MOVE_RIGHT);
    expect(a).toEqual(b);
  });

  it("blocks the player at a wall across repeated fixed steps instead of tunneling through it", () => {
    const wall: Wall = { x: 40, y: -50, width: 20, height: 200 };
    let world = createSimulation({ walls: [wall], playerStart: { x: 0, y: 0 } });

    for (let i = 0; i < 50; i += 1) {
      world = stepSimulation(world, MOVE_RIGHT);
    }

    // The player's circle must never overlap the wall: its right edge stays
    // at or left of the wall's left edge.
    expect(world.player.position.x + world.player.radius).toBeLessThanOrEqual(wall.x);
  });

  it("does not mutate the input world (each step returns a new world)", () => {
    const world = createSimulation({ walls: [], playerStart: { x: 0, y: 0 } });
    const originalPosition = world.player.position;
    stepSimulation(world, MOVE_RIGHT);
    expect(world.player.position).toBe(originalPosition);
  });
});
