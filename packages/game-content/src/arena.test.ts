import { describe, expect, it } from "vitest";

import { ALL_ARENAS, type ArenaDefinition, type ArenaPoint, findArena, testArena } from "./arena";

/**
 * Clearance every spawned circular actor needs around a point. Larger than
 * `simulation-core`'s `PLAYER_RADIUS` (16) and `ENEMY_RADIUS` (18), which this
 * package cannot import (the dependency runs the other way), so a point that
 * passes here is safe for either.
 */
const ACTOR_CLEARANCE_PX = 20;

/** A room holds up to eight players (technical plan §8.1). */
const MAX_PLAYERS = 8;

function overlapsWall(point: ArenaPoint, arena: ArenaDefinition, clearance: number): boolean {
  return arena.walls.some(
    (wall) =>
      point.x + clearance > wall.x &&
      point.x - clearance < wall.x + wall.width &&
      point.y + clearance > wall.y &&
      point.y - clearance < wall.y + wall.height,
  );
}

function everySpawnPoint(arena: ArenaDefinition): readonly ArenaPoint[] {
  return [
    ...arena.playerSpawnPoints,
    ...arena.enemySpawnPoints,
    ...arena.groundLootSpawnPoints,
    ...arena.skillChipSpawnPoints,
    ...arena.extractionCandidatePoints,
  ];
}

describe.each(ALL_ARENAS)("arena $id", (arena) => {
  it("places nothing inside a wall", () => {
    // A spawn inside geometry is unrecoverable: the actor's own collision
    // resolution refuses to move it out, so it is stuck for the whole match.
    for (const point of everySpawnPoint(arena)) {
      expect(
        overlapsWall(point, arena, ACTOR_CLEARANCE_PX),
        `point ${JSON.stringify(point)} overlaps a wall`,
      ).toBe(false);
    }
  });

  it("places nothing outside the arena bounds", () => {
    for (const point of everySpawnPoint(arena)) {
      expect(point.x).toBeGreaterThan(ACTOR_CLEARANCE_PX);
      expect(point.x).toBeLessThan(arena.width - ACTOR_CLEARANCE_PX);
      expect(point.y).toBeGreaterThan(ACTOR_CLEARANCE_PX);
      expect(point.y).toBeLessThan(arena.height - ACTOR_CLEARANCE_PX);
    }
  });

  it("offers a distinct start for every player a full room can hold", () => {
    expect(arena.playerSpawnPoints.length).toBeGreaterThanOrEqual(MAX_PLAYERS);
    const distinct = new Set(
      arena.playerSpawnPoints.map((point) => `${String(point.x)},${String(point.y)}`),
    );
    expect(distinct.size).toBe(arena.playerSpawnPoints.length);
  });

  it("keeps player spawns far enough apart that eight players do not begin overlapping", () => {
    for (let i = 0; i < arena.playerSpawnPoints.length; i += 1) {
      for (let j = i + 1; j < arena.playerSpawnPoints.length; j += 1) {
        const a = arena.playerSpawnPoints[i]!;
        const b = arena.playerSpawnPoints[j]!;
        expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeGreaterThan(ACTOR_CLEARANCE_PX * 2);
      }
    }
  });

  it("offers more enemy spawn candidates than it spawns, so placement can vary by seed", () => {
    expect(arena.enemySpawnPoints.length).toBeGreaterThan(arena.enemyCount);
  });

  it("offers more extraction candidates than the two active at once, so a point can rotate elsewhere", () => {
    // Concept §17.1: a point "disappears after expiration" and "reopens
    // elsewhere", which needs somewhere else to reopen.
    expect(arena.extractionCandidatePoints.length).toBeGreaterThan(2);
  });

  it("keeps the open lane genuinely open across the arena's full width", () => {
    // The lane is what makes `returning_shot` reachable at all (see
    // `ArenaDefinition.openLaneY`), so it must have no interior wall crossing
    // it — only the left and right borders.
    const crossing = arena.walls.filter(
      (wall) => arena.openLaneY > wall.y && arena.openLaneY < wall.y + wall.height,
    );
    const interiorCrossing = crossing.filter(
      (wall) => wall.x > 0 && wall.x + wall.width < arena.width,
    );
    expect(interiorCrossing).toEqual([]);
  });
});

describe("findArena", () => {
  it("resolves a known id to its definition", () => {
    expect(findArena(testArena.id)).toBe(testArena);
  });

  it("returns undefined for an unknown id rather than throwing", () => {
    // The id arrives from the server over the wire; an unknown one must be a
    // handled miss, not a crash in the renderer.
    expect(findArena("no_such_arena")).toBeUndefined();
  });
});
