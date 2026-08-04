/**
 * Shared boss fixtures for the two M7 suites that need a dead boss: the
 * decision tests (`boss-core-decision.test.ts`) and the settlement tests
 * (`settlement-adversarial.test.ts`).
 *
 * Not a test file — it defines no tests and asserts nothing. It exists so the
 * two suites cannot drift apart on what "a boss whose core reaches settlement"
 * means, which would let one of them pass against a world the other never sees.
 */
import {
  type ArenaDefinition,
  type BossDefinition,
  splitReturnCore,
} from "@carry-or-fall/game-content";

/**
 * A boss that dies to a handful of arrows and cannot hurt anybody.
 *
 * These suites need a core in a player's hands, which means a dead boss.
 * Killing a full-health `warden` over a real socket takes about twenty seconds
 * of arrows, and doing that in every test would add minutes to a suite that
 * already runs serially (`docs/DECISIONS.md` D54). `MatchRoomDeps.bossDefinition`
 * overrides which boss inhabits the lair — the same seam `arena` already
 * provides — so these matches host a small one.
 *
 * `boss.ts` implements no per-boss behaviour, so this is the shipped boss with
 * different numbers rather than a different code path: the shape of what is
 * tested (an arc attack, an area attack, a telegraph, a leash, a core on death)
 * is `warden`'s shape.
 *
 * Zero-damage attacks are deliberate. A player killed mid-test by a boss they
 * were not testing would be a flake.
 */
export const trainingBoss: BossDefinition = {
  id: "warden",
  kind: "boss",
  health: 30,
  radius: 34,
  moveSpeed: 40,
  aggroRadiusPx: 120,
  leashRadiusPx: 160,
  attacks: [
    {
      id: "cleave",
      kind: "arc",
      damage: 0,
      rangePx: 40,
      arcDegrees: 120,
      telegraphMs: 400,
      intervalMs: 1_800,
    },
    {
      id: "slam",
      kind: "arc",
      damage: 0,
      rangePx: 36,
      arcDegrees: 60,
      telegraphMs: 550,
      intervalMs: 3_200,
    },
    {
      id: "nova",
      kind: "area",
      damage: 0,
      rangePx: 60,
      arcDegrees: 360,
      telegraphMs: 900,
      intervalMs: 6_000,
    },
  ],
  enrageBelowHealthFraction: 0.5,
  enrageIntervalMultiplier: 0.6,
  coreLootId: splitReturnCore.id,
};

/**
 * The lair, 300 px east of spawn: outside the boss's aggro radius, so a test
 * chooses when the fight starts, and close enough that walking there costs a
 * second rather than a minute.
 */
export const BOSS_LAIR = { x: 800, y: 500 } as const;

/** An arena with a lair, no chasers, and an extraction point beside the spawn. */
export const bossArena: ArenaDefinition = {
  id: "test_boss_arena",
  kind: "arena",
  width: 1000,
  height: 1000,
  walls: [],
  playerSpawnPoints: [
    { x: 500, y: 500 },
    { x: 540, y: 500 },
  ],
  enemySpawnPoints: [{ x: 950, y: 950 }],
  // No chasers: an interruption here would fail a test for a reason that has
  // nothing to do with boss cores.
  enemyCount: 0,
  groundLootSpawnPoints: [{ x: 500, y: 560 }],
  skillChipSpawnPoints: [],
  extractionCandidatePoints: [
    { x: 460, y: 460 },
    { x: 540, y: 460 },
    { x: 460, y: 540 },
    { x: 560, y: 540 },
  ],
  bossSpawnPoint: BOSS_LAIR,
  openLaneY: 950,
};
