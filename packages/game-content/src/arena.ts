/**
 * Arena content: the map a match is played on (M4.2, `docs/M4_ISSUES.md`).
 *
 * The geometry moved out of `apps/client/src/scenes/PlayScene.ts` in M4 because
 * the server owns the map: the authoritative simulation collides against these
 * walls and spawns from these points, and the client draws the same walls. Two
 * ends needing the same geometry means one definition, and a definition
 * consumed by both ends is content (technical plan §7.1 shares definitions,
 * never authority). M7A Checkpoint 0B re-authored the initial arena at
 * 2560 × 1440 behind the fixed 1920 × 1080 logical viewport.
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
  /**
   * Where the boss's lair is (M7), or absent for an arena with no boss.
   *
   * Chosen against the routes the browser suite actually walks, not just
   * somewhere thematically sensible (`docs/M7_ISSUES.md` §1.8): the boss is
   * leashed to this point, so a lair far from those routes is a *by
   * construction* bound on how much danger the rest of the suite has to survive,
   * rather than a budget that a slower machine invalidates.
   */
  readonly bossSpawnPoint?: ArenaPoint;
}

const WIDTH = 2560;
const HEIGHT = 1440;
const WALL_THICKNESS = 20;

/**
 * The one arena the game ships. A bordered room plus four interior walls to
 * approach, slide along, break line of sight on, and bounce `ricochet`
 * projectiles off. The larger bounds provide separate player, ordinary-route,
 * and boss regions without turning the map into empty traversal distance.
 *
 * Every interior wall sits inside `y ∈ [360, 1060]`, leaving a clear upper band
 * and a full-width lower lane. A clear column at `x = 880` connects them on the
 * players' side of the divider. The Warden owns the upper-right pocket; all
 * ordinary routes remain outside its full leash plus body extent.
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
    { x: 1270, y: 360, width: 20, height: 720 }, // central divider
    { x: 360, y: 360, width: 420, height: 20 }, // near-side upper cover
    { x: 360, y: 840, width: 420, height: 20 }, // near-side lower cover
    { x: 1620, y: 1040, width: 420, height: 20 }, // far-side lower cover
  ],
  // Eight distinct points, all on the players' side of the central divider and
  // clear of the near-side cover wall, in two columns so a full room of eight
  // starts spread out rather than in one clump. The columns sit far enough east
  // of the left border and far enough west of the divider that nobody spawns
  // inside geometry.
  playerSpawnPoints: [
    { x: 480, y: 220 },
    { x: 660, y: 220 },
    { x: 480, y: 500 },
    { x: 660, y: 500 },
    { x: 480, y: 800 },
    { x: 660, y: 800 },
    { x: 480, y: 1180 },
    { x: 660, y: 1180 },
  ],
  // All on the far side of the divider and in the lower half: they give the
  // player reaction time, converge on the authored lower-lane meeting point,
  // and stay outside the Warden encounter even before its leash is applied.
  enemySpawnPoints: [
    { x: 1540, y: 1160 },
    { x: 1740, y: 1220 },
    { x: 1900, y: 1120 },
    { x: 2100, y: 1240 },
    { x: 2300, y: 1160 },
  ],
  enemyCount: 3,
  // Three scattered items plus three kill drops is exactly six, which is exactly
  // the inventory size — so a player who collects everything must start
  // discarding or securing. That pressure is what the six-slot limit exists for.
  groundLootSpawnPoints: [
    { x: 900, y: 300 },
    { x: 980, y: 1160 },
    { x: 2320, y: 1280 },
  ],
  skillChipSpawnPoints: [
    { x: 1040, y: 700 }, // players' side: reached through the upper clear band
    { x: 2260, y: 1100 }, // far side: reached safely from the lower open lane
  ],
  extractionCandidatePoints: [
    { x: 260, y: 260 },
    { x: 260, y: 1180 },
    { x: 1480, y: 260 },
    { x: 2320, y: 1180 },
  ],
  openLaneY: 1200,
  // The upper-right pocket is the only intentional boss route. The full
  // 420 px leash plus the Warden's 34 px body remains inside the arena and
  // clear of the ordinary route network; the nearest ordinary authored point
  // is more than 600 px away.
  bossSpawnPoint: { x: 2060, y: 500 },
} as const;

/** Every arena the game ships. One for now (concept §21.1: "initial map"). */
export const ALL_ARENAS: readonly ArenaDefinition[] = [testArena];

/** Look up an arena by id, or `undefined` if the id is unknown. */
export function findArena(id: string): ArenaDefinition | undefined {
  return ALL_ARENAS.find((arena) => arena.id === id);
}
