import { describe, expect, it } from "vitest";

import {
  buildWallGrid,
  circleIntersectsWall,
  closestPointOnWall,
  resolveAxisMovement,
  SpatialGrid,
} from "./collision";
import type { Wall } from "./world";

const WALL: Wall = { x: 100, y: 100, width: 50, height: 50 };

describe("closestPointOnWall / circleIntersectsWall", () => {
  it("clamps to the wall boundary for a point outside it", () => {
    expect(closestPointOnWall(WALL, { x: 0, y: 0 })).toEqual({ x: 100, y: 100 });
    expect(closestPointOnWall(WALL, { x: 1000, y: 1000 })).toEqual({ x: 150, y: 150 });
  });

  it("returns the point itself when already inside the wall", () => {
    expect(closestPointOnWall(WALL, { x: 120, y: 130 })).toEqual({ x: 120, y: 130 });
  });

  it("detects overlap when a circle touches a wall edge", () => {
    const circle = { position: { x: 90, y: 125 }, radius: 11 };
    expect(circleIntersectsWall(circle, WALL)).toBe(true);
  });

  it("detects no overlap when a circle is clearly outside a wall", () => {
    const circle = { position: { x: 0, y: 0 }, radius: 5 };
    expect(circleIntersectsWall(circle, WALL)).toBe(false);
  });

  it("detects overlap for a circle centered inside a wall", () => {
    const circle = { position: { x: 120, y: 120 }, radius: 5 };
    expect(circleIntersectsWall(circle, WALL)).toBe(true);
  });
});

describe("SpatialGrid", () => {
  it("returns an item whose cell overlaps the query bounds", () => {
    const grid = new SpatialGrid<Wall>(64);
    grid.insert(WALL, WALL);
    const results = grid.query({ x: 110, y: 110, width: 1, height: 1 });
    expect(results).toContain(WALL);
  });

  it("does not return an item far outside the query bounds", () => {
    const grid = new SpatialGrid<Wall>(64);
    grid.insert(WALL, WALL);
    const results = grid.query({ x: 5000, y: 5000, width: 1, height: 1 });
    expect(results).not.toContain(WALL);
  });

  it("does not return the same item twice when it spans multiple cells", () => {
    const grid = new SpatialGrid<Wall>(32);
    const wideWall: Wall = { x: 0, y: 0, width: 200, height: 10 };
    grid.insert(wideWall, wideWall);
    const results = grid.query({ x: 0, y: 0, width: 200, height: 10 });
    expect(results.filter((item) => item === wideWall)).toHaveLength(1);
  });

  it("rejects a non-positive cell size", () => {
    expect(() => new SpatialGrid(0)).toThrow(RangeError);
    expect(() => new SpatialGrid(-10)).toThrow(RangeError);
  });
});

describe("resolveAxisMovement (map collision, M1.5)", () => {
  const radius = 16;

  it("blocks movement into a wall", () => {
    const grid = buildWallGrid([WALL]);
    // Player approaches the wall's left edge (x=100) from the left.
    const position = { x: 100 - radius - 5, y: 120 };
    const resolvedX = resolveAxisMovement(position, "x", 20, radius, grid);
    // Moving the full 20px would push the circle into the wall; it must stop
    // at (or before) its current position rather than overlap.
    expect(resolvedX).toBe(position.x);
  });

  it("allows movement when no wall is in the way", () => {
    const grid = buildWallGrid([WALL]);
    const position = { x: 0, y: 0 };
    const resolvedX = resolveAxisMovement(position, "x", 20, radius, grid);
    expect(resolvedX).toBe(20);
  });

  it("slides along a wall: blocks the axis into the wall but allows the perpendicular axis", () => {
    const grid = buildWallGrid([WALL]);
    // Positioned just left of the wall, aligned within its y-span (100-150),
    // moving diagonally down-right: x should be blocked (wall is directly to
    // the right) while y is free.
    const position = { x: 100 - radius - 1, y: 120 };
    const blockedX = resolveAxisMovement(position, "x", 5, radius, grid);
    const freeY = resolveAxisMovement(position, "y", 5, radius, grid);
    expect(blockedX).toBe(position.x);
    expect(freeY).toBe(position.y + 5);
  });

  it("returns the current coordinate unchanged when delta is zero", () => {
    const grid = buildWallGrid([WALL]);
    const position = { x: 42, y: 7 };
    expect(resolveAxisMovement(position, "x", 0, radius, grid)).toBe(42);
    expect(resolveAxisMovement(position, "y", 0, radius, grid)).toBe(7);
  });
});
