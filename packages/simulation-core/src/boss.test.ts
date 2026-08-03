/**
 * The boss's own rules (M7.2, `docs/M7_ISSUES.md` §11.5; concept §14.3).
 *
 * Every bullet §14.3 gives the first boss is asserted here as behaviour rather
 * than as a number in a table — `game-content/boss.test.ts` covers the table.
 * The two that carry the most weight are the leash, because it is what bounds
 * where danger can be (`docs/DECISIONS.md` D66), and the telegraph, because
 * "readable" means a player who reacts can leave.
 */
import { warden } from "@carry-or-fall/game-content";
import { describe, expect, it } from "vitest";

import {
  effectiveIntervalMs,
  isWithinBossAttack,
  spawnBoss,
  stepBoss,
  type BossTarget,
} from "./boss";
import { buildWallGrid } from "./collision";
import type { Boss, Vec2, Wall } from "./world";

const NO_WALLS: readonly Wall[] = [];
const grid = buildWallGrid(NO_WALLS);
const LAIR: Vec2 = { x: 1000, y: 1000 };

function player(id: string, position: Vec2, overrides: Partial<BossTarget> = {}): BossTarget {
  return { id, position, radius: 16, alive: true, runResult: null, ...overrides };
}

/** Step the boss `steps` times against a fixed set of targets. */
function run(
  boss: Boss,
  targets: readonly BossTarget[],
  steps: number,
): { boss: Boss; hits: { playerId: string; damage: number }[] } {
  let working = boss;
  const hits: { playerId: string; damage: number }[] = [];
  for (let step = 0; step < steps; step += 1) {
    const result = stepBoss(working, warden, targets, 50, 0.05, grid);
    working = result.boss;
    hits.push(...result.hits);
  }
  return { boss: working, hits };
}

describe("attraction: the boss wakes for a visitor and not for a passer-by", () => {
  it("stays asleep and still while nobody is inside the aggro radius", () => {
    const boss = spawnBoss(warden, LAIR);
    const faraway = player("p", { x: LAIR.x + warden.aggroRadiusPx + 200, y: LAIR.y });

    const { boss: after } = run(boss, [faraway], 40);

    expect(after.awake).toBe(false);
    expect(after.position).toEqual(LAIR);
    expect(after.telegraph).toBeNull();
  });

  it("wakes and closes once a player steps inside it", () => {
    const boss = spawnBoss(warden, LAIR);
    const visitor = player("p", { x: LAIR.x + warden.aggroRadiusPx - 40, y: LAIR.y });

    const { boss: after } = run(boss, [visitor], 10);

    expect(after.awake).toBe(true);
    expect(after.position.x).toBeGreaterThan(LAIR.x);
  });

  it("ignores a player whose run has ended, and one who is dead", () => {
    const boss = spawnBoss(warden, LAIR);
    const inert = player("p", { x: LAIR.x + 60, y: LAIR.y }, { alive: false });
    const finished = player(
      "q",
      { x: LAIR.x + 60, y: LAIR.y },
      {
        runResult: {
          outcome: "extracted",
          pointsGained: { force: 0, precision: 0, motion: 0, guard: 0, signal: 0 },
          itemsConverted: 0,
          itemsLost: 0,
          bossCoreIds: [],
        },
      },
    );

    const { boss: after, hits } = run(boss, [inert, finished], 60);

    expect(after.awake).toBe(false);
    expect(hits).toEqual([]);
  });
});

describe("the leash: there is a circle the boss cannot leave", () => {
  it("never travels beyond the leash radius, however far the player runs", () => {
    // A player who keeps walking away, dragging the boss: the classic pull.
    let boss = spawnBoss(warden, LAIR);
    let x = LAIR.x + 60;
    let worst = 0;

    for (let step = 0; step < 400; step += 1) {
      const result = stepBoss(boss, warden, [player("p", { x, y: LAIR.y })], 50, 0.05, grid);
      boss = result.boss;
      worst = Math.max(worst, Math.hypot(boss.position.x - LAIR.x, boss.position.y - LAIR.y));
      x += 11; // 220 px/s, the player's speed, in one 50 ms step.
    }

    expect(worst).toBeLessThanOrEqual(warden.leashRadiusPx);
  });

  it("walks home once its visitor leaves", () => {
    let boss = spawnBoss(warden, LAIR);
    const near = player("p", { x: LAIR.x + warden.aggroRadiusPx - 20, y: LAIR.y });
    boss = run(boss, [near], 30).boss;
    const pulled = Math.hypot(boss.position.x - LAIR.x, boss.position.y - LAIR.y);
    expect(pulled).toBeGreaterThan(0);

    // The player leaves the aggro radius entirely.
    const gone = player("p", { x: LAIR.x + warden.aggroRadiusPx + 400, y: LAIR.y });
    boss = run(boss, [gone], 200).boss;

    expect(Math.hypot(boss.position.x - LAIR.x, boss.position.y - LAIR.y)).toBeLessThan(2);
    expect(boss.awake).toBe(false);
  });

  it("cannot be lured onto a route far from the lair", () => {
    // The property the browser suite depends on (`docs/M7_ISSUES.md` §1.8): a
    // point a leash-radius-plus away is unreachable no matter what a player
    // does. Stated as a distance rather than as a named test route, so it stays
    // true if the arena's routes move.
    let boss = spawnBoss(warden, LAIR);
    const beyond: Vec2 = { x: LAIR.x + warden.leashRadiusPx + 200, y: LAIR.y };

    for (let step = 0; step < 600; step += 1) {
      boss = stepBoss(boss, warden, [player("p", beyond)], 50, 0.05, grid).boss;
    }

    expect(Math.hypot(boss.position.x - beyond.x, boss.position.y - beyond.y)).toBeGreaterThan(200);
  });
});

describe("attacks: telegraphed, and only landing on what is in range", () => {
  it("commits to a wind-up before any damage lands", () => {
    const boss = spawnBoss(warden, LAIR);
    const adjacent = player("p", { x: LAIR.x + 40, y: LAIR.y });

    // The shortest telegraph is the cleave's; nothing may land before it.
    const shortest = Math.min(...warden.attacks.map((attack) => attack.telegraphMs));
    const stepsBefore = Math.floor(shortest / 50);
    const { hits } = run(boss, [adjacent], stepsBefore);

    expect(hits).toEqual([]);
  });

  it("lands on a player who is still there when the wind-up ends", () => {
    const boss = spawnBoss(warden, LAIR);
    const adjacent = player("p", { x: LAIR.x + 40, y: LAIR.y });

    const { hits } = run(boss, [adjacent], 40);

    expect(hits.length).toBeGreaterThan(0);
    expect(hits.every((hit) => hit.playerId === "p")).toBe(true);
  });

  it("misses a player who leaves during the wind-up — which is what readable means", () => {
    let boss = spawnBoss(warden, LAIR);
    const adjacent = player("p", { x: LAIR.x + 40, y: LAIR.y });

    // Step until a telegraph is committed.
    let steps = 0;
    while (boss.telegraph === null && steps < 100) {
      boss = stepBoss(boss, warden, [adjacent], 50, 0.05, grid).boss;
      steps += 1;
    }
    expect(boss.telegraph).not.toBeNull();

    // The player runs well beyond every attack's reach before it resolves.
    const escaped = player("p", { x: LAIR.x + 900, y: LAIR.y });
    const hits: { playerId: string; damage: number }[] = [];
    for (let step = 0; step < 40; step += 1) {
      const result = stepBoss(boss, warden, [escaped], 50, 0.05, grid);
      boss = result.boss;
      hits.push(...result.hits);
    }

    expect(hits).toEqual([]);
  });

  it("does not re-aim a committed wind-up", () => {
    // A telegraph that tracked the player would be a delay, not a tell.
    let boss = spawnBoss(warden, LAIR);
    const adjacent = player("p", { x: LAIR.x + 40, y: LAIR.y });
    while (boss.telegraph === null) {
      boss = stepBoss(boss, warden, [adjacent], 50, 0.05, grid).boss;
    }
    const committedFacing = boss.telegraph.facing;

    boss = stepBoss(
      boss,
      warden,
      [player("p", { x: LAIR.x, y: LAIR.y + 40 })],
      50,
      0.05,
      grid,
    ).boss;

    expect(boss.telegraph?.facing ?? committedFacing).toBe(committedFacing);
  });

  it("resolves an arc only in front, and an area attack all around", () => {
    const boss = spawnBoss(warden, LAIR);
    const [cleave] = warden.attacks;
    const area = warden.attacks.find((attack) => attack.kind === "area")!;
    const behind = player("p", { x: LAIR.x - 60, y: LAIR.y });

    // Facing east; the target is west.
    expect(isWithinBossAttack(boss, cleave, 0, behind)).toBe(false);
    expect(isWithinBossAttack(boss, area, 0, behind)).toBe(true);
  });

  it("reaches nobody outside the attack's range, whatever it is facing", () => {
    const boss = spawnBoss(warden, LAIR);
    const area = warden.attacks.find((attack) => attack.kind === "area")!;
    const distant = player("p", { x: LAIR.x + area.rangePx + 200, y: LAIR.y });

    expect(isWithinBossAttack(boss, area, 0, distant)).toBe(false);
  });
});

describe("the phase change (concept §14.3's one behaviour change)", () => {
  it("enrages once, below the health fraction, and stays enraged", () => {
    const boss = spawnBoss(warden, LAIR);
    const wounded: Boss = {
      ...boss,
      health: Math.floor(boss.maxHealth * warden.enrageBelowHealthFraction) - 1,
    };

    const after = stepBoss(wounded, warden, [], 50, 0.05, grid).boss;
    expect(after.enraged).toBe(true);

    // Healing back above the line — which nothing does today — would not undo
    // it: a phase change is a change, not a state that flickers.
    const healed = stepBoss({ ...after, health: boss.maxHealth }, warden, [], 50, 0.05, grid).boss;
    expect(healed.enraged).toBe(true);
  });

  it("is not enraged at full health", () => {
    const boss = spawnBoss(warden, LAIR);
    expect(stepBoss(boss, warden, [], 50, 0.05, grid).boss.enraged).toBe(false);
  });

  it("attacks more often once enraged", () => {
    const [cleave] = warden.attacks;
    const calm = effectiveIntervalMs(warden, cleave, false);
    const angry = effectiveIntervalMs(warden, cleave, true);
    expect(angry).toBeLessThan(calm);
  });

  it("actually lands more hits in the same window when enraged", () => {
    // The behavioural half of the assertion above: the multiplier is not just a
    // number, it changes what a player experiences.
    const adjacent = player("p", { x: LAIR.x + 40, y: LAIR.y });
    const boss = spawnBoss(warden, LAIR);
    const calmHits = run(boss, [adjacent], 200).hits.length;
    const angryHits = run({ ...boss, enraged: true }, [adjacent], 200).hits.length;

    expect(angryHits).toBeGreaterThan(calmHits);
  });
});

describe("death", () => {
  it("stops attacking, and drops a committed wind-up", () => {
    let boss = spawnBoss(warden, LAIR);
    const adjacent = player("p", { x: LAIR.x + 40, y: LAIR.y });
    while (boss.telegraph === null) {
      boss = stepBoss(boss, warden, [adjacent], 50, 0.05, grid).boss;
    }

    // Killed mid-wind-up: the swing must not still land.
    const dead = stepBoss({ ...boss, health: 0 }, warden, [adjacent], 50, 0.05, grid);

    expect(dead.hits).toEqual([]);
    expect(dead.boss.telegraph).toBeNull();
  });
});
