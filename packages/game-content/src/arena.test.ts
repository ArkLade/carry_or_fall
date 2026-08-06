import { describe, expect, it } from "vitest";

import { createSimulation } from "../../simulation-core/src/simulation";
import { ALL_ARENAS, type ArenaDefinition, type ArenaPoint, findArena, testArena } from "./arena";
import { warden } from "./boss";
import { chaser } from "./enemies";

/**
 * Clearance every spawned circular actor needs around a point. Larger than
 * `simulation-core`'s `PLAYER_RADIUS` (16) and `ENEMY_RADIUS` (18), which this
 * package cannot import (the dependency runs the other way), so a point that
 * passes here is safe for either.
 */
const ACTOR_CLEARANCE_PX = 20;

/** Extraction has the largest authored point radius; this safely covers every smaller point kind. */
const POINT_CLEARANCE_PX = 40;

/** Test-only connectivity grid; it proves authored reachability, not runtime navigation. */
const PATH_GRID_PX = 20;

const CLEAR_COLUMN_X = 880;
const UPPER_LANE_Y = 240;
const LOWER_LANE_Y = 1200;
const MEET_CHASERS_SPOT = { x: 1540, y: LOWER_LANE_Y } as const;

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
    ...(arena.bossSpawnPoint === undefined ? [] : [arena.bossSpawnPoint]),
  ];
}

function pointKey(point: ArenaPoint): string {
  return `${String(point.x)},${String(point.y)}`;
}

/** Flood the authored walkable component on a bounded cardinal grid. */
function reachableGridPoints(arena: ArenaDefinition, start: ArenaPoint): ReadonlySet<string> {
  const visited = new Set<string>();
  const pending: ArenaPoint[] = [start];
  for (let index = 0; index < pending.length; index += 1) {
    const point = pending[index]!;
    const key = pointKey(point);
    if (
      visited.has(key) ||
      point.x < PATH_GRID_PX ||
      point.x > arena.width - PATH_GRID_PX ||
      point.y < PATH_GRID_PX ||
      point.y > arena.height - PATH_GRID_PX ||
      overlapsWall(point, arena, ACTOR_CLEARANCE_PX)
    ) {
      continue;
    }
    visited.add(key);
    pending.push(
      { x: point.x + PATH_GRID_PX, y: point.y },
      { x: point.x - PATH_GRID_PX, y: point.y },
      { x: point.x, y: point.y + PATH_GRID_PX },
      { x: point.x, y: point.y - PATH_GRID_PX },
    );
  }
  return visited;
}

interface RouteSegment {
  readonly from: ArenaPoint;
  readonly to: ArenaPoint;
}

function routeTo(point: ArenaPoint): readonly RouteSegment[] {
  const laneY = point.y < testArena.height / 2 ? UPPER_LANE_Y : LOWER_LANE_Y;
  return [
    { from: { x: CLEAR_COLUMN_X, y: laneY }, to: { x: point.x, y: laneY } },
    { from: { x: point.x, y: laneY }, to: point },
  ];
}

function distanceToSegment(point: ArenaPoint, segment: RouteSegment): number {
  const dx = segment.to.x - segment.from.x;
  const dy = segment.to.y - segment.from.y;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared === 0) {
    return Math.hypot(point.x - segment.from.x, point.y - segment.from.y);
  }
  const projection = Math.max(
    0,
    Math.min(
      1,
      ((point.x - segment.from.x) * dx + (point.y - segment.from.y) * dy) / lengthSquared,
    ),
  );
  return Math.hypot(
    point.x - (segment.from.x + projection * dx),
    point.y - (segment.from.y + projection * dy),
  );
}

const PLAYER_ROUTE_SEGMENTS: readonly RouteSegment[] = testArena.playerSpawnPoints.map((spawn) => ({
  from: spawn,
  to: { x: CLEAR_COLUMN_X, y: spawn.y },
}));

const ROUTE_GROUPS: ReadonlyArray<{
  readonly name: string;
  readonly segments: readonly RouteSegment[];
}> = [
  {
    name: "loot and wildcard-chip routes",
    segments: [...testArena.groundLootSpawnPoints, ...testArena.skillChipSpawnPoints].flatMap(
      routeTo,
    ),
  },
  {
    name: "extraction routes",
    segments: testArena.extractionCandidatePoints.flatMap(routeTo),
  },
  {
    name: "Chaser routes",
    segments: [...testArena.enemySpawnPoints, MEET_CHASERS_SPOT].flatMap(routeTo),
  },
  {
    name: "returning-shot open-lane route",
    segments: [
      {
        from: { x: ACTOR_CLEARANCE_PX, y: testArena.openLaneY },
        to: { x: testArena.width - ACTOR_CLEARANCE_PX, y: testArena.openLaneY },
      },
    ],
  },
  {
    name: "multiplayer routes",
    segments: [
      ...PLAYER_ROUTE_SEGMENTS,
      { from: { x: CLEAR_COLUMN_X, y: ACTOR_CLEARANCE_PX }, to: { x: CLEAR_COLUMN_X, y: 1420 } },
      ...routeTo(testArena.groundLootSpawnPoints[0]!),
      ...routeTo(testArena.extractionCandidatePoints[0]!),
      ...routeTo(testArena.extractionCandidatePoints[1]!),
    ],
  },
];

describe.each(ALL_ARENAS)("arena $id", (arena) => {
  it("keeps every wall fully inside the arena bounds", () => {
    for (const wall of arena.walls) {
      expect(wall.width).toBeGreaterThan(0);
      expect(wall.height).toBeGreaterThan(0);
      expect(wall.x).toBeGreaterThanOrEqual(0);
      expect(wall.y).toBeGreaterThanOrEqual(0);
      expect(wall.x + wall.width).toBeLessThanOrEqual(arena.width);
      expect(wall.y + wall.height).toBeLessThanOrEqual(arena.height);
    }
  });

  it("places nothing inside a wall", () => {
    // A spawn inside geometry is unrecoverable: the actor's own collision
    // resolution refuses to move it out, so it is stuck for the whole match.
    for (const point of everySpawnPoint(arena)) {
      expect(
        overlapsWall(point, arena, POINT_CLEARANCE_PX),
        `point ${JSON.stringify(point)} overlaps a wall`,
      ).toBe(false);
    }
  });

  it("places nothing outside the arena bounds", () => {
    for (const point of everySpawnPoint(arena)) {
      expect(point.x).toBeGreaterThan(POINT_CLEARANCE_PX);
      expect(point.x).toBeLessThan(arena.width - POINT_CLEARANCE_PX);
      expect(point.y).toBeGreaterThan(POINT_CLEARANCE_PX);
      expect(point.y).toBeLessThan(arena.height - POINT_CLEARANCE_PX);
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
      (wall) =>
        arena.openLaneY + POINT_CLEARANCE_PX > wall.y &&
        arena.openLaneY - POINT_CLEARANCE_PX < wall.y + wall.height,
    );
    const interiorCrossing = crossing.filter(
      (wall) => wall.x > 0 && wall.x + wall.width < arena.width,
    );
    expect(interiorCrossing).toEqual([]);
  });

  it("keeps every required authored point in one reachable walkable component", () => {
    const start = arena.playerSpawnPoints[0]!;
    const reachable = reachableGridPoints(arena, start);
    for (const point of everySpawnPoint(arena)) {
      expect(reachable.has(pointKey(point)), `point ${pointKey(point)} is unreachable`).toBe(true);
    }
  });
});

describe("M7A Checkpoint 0B test arena", () => {
  it("is exactly 2560 by 1440", () => {
    expect({ width: testArena.width, height: testArena.height }).toEqual({
      width: 2560,
      height: 1440,
    });
  });

  it("keeps the Warden's complete leash and body extent inside the arena", () => {
    const lair = testArena.bossSpawnPoint!;
    const encounterExtent = warden.leashRadiusPx + warden.radius;
    expect(lair.x - encounterExtent).toBeGreaterThan(0);
    expect(lair.y - encounterExtent).toBeGreaterThan(0);
    expect(lair.x + encounterExtent).toBeLessThan(testArena.width);
    expect(lair.y + encounterExtent).toBeLessThan(testArena.height);
  });

  it.each(ROUTE_GROUPS)("isolates the Warden's full leash and body from $name", ({ segments }) => {
    const lair = testArena.bossSpawnPoint!;
    const requiredClearance = warden.leashRadiusPx + warden.radius + ACTOR_CLEARANCE_PX;
    for (const segment of segments) {
      expect(
        distanceToSegment(lair, segment),
        `route ${pointKey(segment.from)} -> ${pointKey(segment.to)} enters the Warden encounter`,
      ).toBeGreaterThan(requiredClearance);
    }
  });

  it("pins the complete MATCH_SEED=76 content selection", () => {
    const world = createSimulation({
      seed: 76,
      players: [],
      walls: testArena.walls,
      enemyDefinition: chaser,
      enemySpawnPoints: testArena.enemySpawnPoints,
      enemyCount: testArena.enemyCount,
      groundLootSpawnPoints: testArena.groundLootSpawnPoints,
      skillChipSpawnPoints: testArena.skillChipSpawnPoints,
      extractionCandidatePoints: testArena.extractionCandidatePoints,
      bossDefinition: warden,
      bossSpawnPoint: testArena.bossSpawnPoint!,
    });

    expect(testArena.playerSpawnPoints).toEqual([
      { x: 480, y: 220 },
      { x: 660, y: 220 },
      { x: 480, y: 500 },
      { x: 660, y: 500 },
      { x: 480, y: 800 },
      { x: 660, y: 800 },
      { x: 480, y: 1180 },
      { x: 660, y: 1180 },
    ]);
    expect(world.enemies.map((enemy) => ({ id: enemy.id, ...enemy.position }))).toEqual([
      { id: "enemy-0", x: 1900, y: 1120 },
      { id: "enemy-1", x: 2100, y: 1240 },
      { id: "enemy-2", x: 2300, y: 1160 },
    ]);
    expect(
      world.groundLoot.map((loot) => ({
        id: loot.id,
        lootId: loot.definition.id,
        ...loot.position,
      })),
    ).toEqual([
      { id: "loot-start-0", lootId: "farsight_lens", x: 900, y: 300 },
      { id: "loot-start-1", lootId: "warlords_seal", x: 980, y: 1160 },
      { id: "loot-start-2", lootId: "scrap_plating", x: 2320, y: 1280 },
    ]);
    expect(
      world.skillChips.map((chip) => ({
        id: chip.id,
        skillId: chip.definition.id,
        ...chip.position,
      })),
    ).toEqual([
      { id: "chip-start-0", skillId: "swift_strikes", x: 1040, y: 700 },
      { id: "chip-start-1", skillId: "split_return", x: 2260, y: 1100 },
    ]);
    expect(world.extractionPoints.map((point) => ({ id: point.id, ...point.position }))).toEqual([
      { id: "extraction-0", x: 260, y: 1180 },
      { id: "extraction-1", x: 260, y: 260 },
    ]);
    expect(world.boss).toMatchObject({
      id: "boss-warden",
      definitionId: "warden",
      position: { x: 2060, y: 500 },
      lair: { x: 2060, y: 500 },
    });
    expect(warden.coreLootId).toBe("split_return_core");
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
