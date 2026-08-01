/**
 * Arena content: the map a match is played on (M4.2, `docs/M4_ISSUES.md`).
 *
 * The geometry itself is not new — it is M1's test map as the M4-prep commit
 * tuned it (doubled in both dimensions, two extra interior walls, three
 * enemies), moved out of `apps/client/src/scenes/PlayScene.ts`. It has to move,
 * because the server now owns the map: the authoritative simulation collides
 * against these walls and spawns from these points, and the client draws the
 * same walls. Two ends needing the same geometry means one definition, and a
 * definition consumed by both ends is content (technical plan §7.1 shares
 * definitions, never authority).
 *
 * Everything here is pure data — no engine rule lives in this file. Values are
 * proposed and balance-deferred, exactly like the weapon, loot, and skill
 * numbers; the per-field provenance is recorded in `docs/M4_EXECUTION_PLAN.md`
 * §4.
 */
import type { ContentDefinition } from "./index";

/**
 * A point in arena space. Structurally identical to `simulation-core`'s `Vec2`
 * and assignable to it; declared here because content cannot depend on the
 * engine (the dependency runs the other way).
 */
export interface ArenaPoint {
  readonly x: number;
  readonly y: number;
}

/** A static wall: an axis-aligned box whose `x`/`y` is its top-left corner (technical plan §12.1). */
export interface ArenaWall {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface ArenaDefinition extends ContentDefinition {
  readonly kind: "arena";
  readonly width: number;
  readonly height: number;
  readonly walls: readonly ArenaWall[];
  /**
   * Where players start. A room holds up to eight players (technical plan
   * §8.1), so there must be at least eight distinct points: players must not
   * begin stacked inside one another.
   */
  readonly playerSpawnPoints: readonly ArenaPoint[];
  /** Candidate enemy spawns; `enemyCount` distinct ones are chosen per match by the seeded RNG. */
  readonly enemySpawnPoints: readonly ArenaPoint[];
  readonly enemyCount: number;
  /** Ground loot scattered at match start, one item per point. */
  readonly groundLootSpawnPoints: readonly ArenaPoint[];
  /** Wildcard skill chips scattered at match start, one per point. */
  readonly skillChipSpawnPoints: readonly ArenaPoint[];
  /** Candidate locations the two active extraction points rotate among (concept §17.1). */
  readonly extractionCandidatePoints: readonly ArenaPoint[];
  /**
   * A `y` coordinate on a full-width lane with no wall across it.
   *
   * `returning_shot` only returns when a projectile survives its whole
   * lifespan, which needs `PROJECTILE_LIFESPAN_MS × projectileSpeed` =
   * 2000 ms × 600 px/s = 1200 px of unobstructed travel. M1's 960×540 map's
   * longest interior run was about 1047 px, so the skill's defining behavior
   * was unreachable; this map's clear lanes are 1880 px. Published here so the
   * browser suite can find the lane from the content instead of hard-coding a
   * number that silently rots when the map changes.
   */
  readonly openLaneY: number;
}

const WIDTH = 1920;
const HEIGHT = 1080;
const WALL_THICKNESS = 20;

/**
 * The one arena M4 ships. A bordered room plus three interior walls to approach,
 * slide along, break line of sight on, and bounce `ricochet` projectiles off.
 *
 * Deliberate constraint carried over from the M4-prep tuning: every interior
 * wall sits inside `y ∈ [300, 780]`, leaving two full-width horizontal lanes
 * clear (above `y = 300` and below `y = 780`). {@link ArenaDefinition.openLaneY}
 * documents why that matters.
 */
export const testArena: ArenaDefinition = {
  id: "test_arena",
  kind: "arena",
  width: WIDTH,
  height: HEIGHT,
  walls: [
    { x: 0, y: 0, width: WIDTH, height: WALL_THICKNESS }, // top
    { x: 0, y: HEIGHT - WALL_THICKNESS, width: WIDTH, height: WALL_THICKNESS }, // bottom
    { x: 0, y: 0, width: WALL_THICKNESS, height: HEIGHT }, // left
    { x: WIDTH - WALL_THICKNESS, y: 0, width: WALL_THICKNESS, height: HEIGHT }, // right
    { x: WIDTH / 2 - 10, y: 300, width: 20, height: 480 }, // central divider
    { x: 300, y: 300, width: 300, height: 20 }, // near-side cover
    { x: 1300, y: 700, width: 300, height: 20 }, // far-side cover
  ],
  // Eight distinct points, all on the players' side of the central divider and
  // clear of the near-side cover wall, in two columns so a full room of eight
  // starts spread out rather than in one clump. The columns sit far enough east
  // of the left border and far enough west of the divider that nobody spawns
  // inside geometry.
  playerSpawnPoints: [
    { x: 420, y: 180 },
    { x: 560, y: 180 },
    { x: 420, y: 420 },
    { x: 560, y: 420 },
    { x: 420, y: 660 },
    { x: 560, y: 660 },
    { x: 420, y: 900 },
    { x: 560, y: 900 },
  ],
  // All on the far side of the divider from the players: the nearest is roughly
  // 700 px from the nearest player spawn, which at the chaser's 90 px/s is about
  // 7 seconds of warning — and the chasers have to path around the divider.
  enemySpawnPoints: [
    { x: 1250, y: 250 },
    { x: 1400, y: 200 },
    { x: 1350, y: 820 },
    { x: 1500, y: 880 },
    { x: 1650, y: 540 },
  ],
  enemyCount: 3,
  // Three scattered items plus three kill drops is exactly six, which is exactly
  // the inventory size — so a player who collects everything must start
  // discarding or securing. That pressure is what the six-slot limit exists for.
  groundLootSpawnPoints: [
    { x: 700, y: 250 },
    { x: 700, y: 850 },
    { x: 1700, y: 950 },
  ],
  skillChipSpawnPoints: [
    { x: 760, y: 540 }, // players' side: straight-line reachable from every spawn
    { x: 1740, y: 620 }, // far side: reachable only by routing around the divider
  ],
  extractionCandidatePoints: [
    { x: 200, y: 200 },
    { x: 200, y: 880 },
    { x: 1720, y: 200 },
    { x: 1720, y: 880 },
  ],
  openLaneY: 900,
} as const;

/** Every arena the game ships. One for now (concept §21.1: "initial map"). */
export const ALL_ARENAS: readonly ArenaDefinition[] = [testArena];

/** Look up an arena by id, or `undefined` if the id is unknown. */
export function findArena(id: string): ArenaDefinition | undefined {
  return ALL_ARENAS.find((arena) => arena.id === id);
}
