import { describe, expect, it } from "vitest";

import { computeMovementDelta, PLAYER_SPEED } from "./movement";
import type { InputState } from "./world";

const DT_SECONDS = 0.05;

/** `moveX`/`moveY` plus the rest of `InputState` at inert defaults — movement never reads the rest. */
function input(moveX: -1 | 0 | 1, moveY: -1 | 0 | 1): InputState {
  return {
    moveX,
    moveY,
    aimAngle: 0,
    attackPressed: false,
    secondaryAttackPressed: false,
    dashPressed: false,
    interactPressed: false,
    discardSlotIndex: null,
    secureSlotIndex: null,
    activateCoreSlotIndex: null,
  };
}

function speedOf(moveX: -1 | 0 | 1, moveY: -1 | 0 | 1): number {
  const delta = computeMovementDelta(input(moveX, moveY), DT_SECONDS);
  return Math.hypot(delta.x, delta.y) / DT_SECONDS;
}

describe("computeMovementDelta", () => {
  it("produces no movement when no direction is held", () => {
    const delta = computeMovementDelta(input(0, 0), DT_SECONDS);
    expect(delta).toEqual({ x: 0, y: 0 });
  });

  it("moves at exactly PLAYER_SPEED on a single axis", () => {
    expect(speedOf(1, 0)).toBeCloseTo(PLAYER_SPEED, 6);
    expect(speedOf(-1, 0)).toBeCloseTo(PLAYER_SPEED, 6);
    expect(speedOf(0, 1)).toBeCloseTo(PLAYER_SPEED, 6);
    expect(speedOf(0, -1)).toBeCloseTo(PLAYER_SPEED, 6);
  });

  it("does not exceed PLAYER_SPEED when moving diagonally", () => {
    // The naive (un-normalized) diagonal speed would be PLAYER_SPEED * sqrt(2);
    // this asserts the cap actually holds, not just that a constant equals itself.
    expect(speedOf(1, 1)).toBeCloseTo(PLAYER_SPEED, 6);
    expect(speedOf(-1, 1)).toBeCloseTo(PLAYER_SPEED, 6);
    expect(speedOf(1, -1)).toBeCloseTo(PLAYER_SPEED, 6);
    expect(speedOf(-1, -1)).toBeCloseTo(PLAYER_SPEED, 6);
  });

  it("scales linearly with the step duration", () => {
    const delta = computeMovementDelta(input(1, 0), DT_SECONDS * 2);
    expect(delta.x).toBeCloseTo(PLAYER_SPEED * DT_SECONDS * 2, 6);
  });
});
