import { describe, expect, it } from "vitest";

import { computeDashDelta, DASH_DISTANCE_PX } from "./dash";

function distanceOf(delta: { x: number; y: number }): number {
  return Math.hypot(delta.x, delta.y);
}

describe("computeDashDelta", () => {
  it("dashes exactly DASH_DISTANCE_PX in the held movement direction", () => {
    const delta = computeDashDelta({ moveX: 1, moveY: 0 }, 0);
    expect(delta.x).toBeCloseTo(DASH_DISTANCE_PX, 6);
    expect(delta.y).toBeCloseTo(0, 6);
  });

  it("does not exceed DASH_DISTANCE_PX when the movement input is diagonal", () => {
    // The naive (un-normalized) diagonal distance would be DASH_DISTANCE_PX * sqrt(2).
    const delta = computeDashDelta({ moveX: 1, moveY: 1 }, 0);
    expect(distanceOf(delta)).toBeCloseTo(DASH_DISTANCE_PX, 6);
  });

  it("dashes toward facing when no movement direction is held", () => {
    const delta = computeDashDelta({ moveX: 0, moveY: 0 }, Math.PI / 2);
    expect(delta.x).toBeCloseTo(0, 6);
    expect(delta.y).toBeCloseTo(DASH_DISTANCE_PX, 6);
  });

  it("prefers the movement direction over facing when both are available", () => {
    // Moving left while facing right (0 rad) should still dash left, not right.
    const delta = computeDashDelta({ moveX: -1, moveY: 0 }, 0);
    expect(delta.x).toBeCloseTo(-DASH_DISTANCE_PX, 6);
  });

  it("is deterministic: identical inputs always produce an identical delta (no randomness)", () => {
    const a = computeDashDelta({ moveX: 1, moveY: -1 }, 1.2);
    const b = computeDashDelta({ moveX: 1, moveY: -1 }, 1.2);
    expect(a).toEqual(b);
  });
});
