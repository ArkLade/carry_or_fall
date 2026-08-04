/**
 * **Technical plan §13.4's caps 5 and 6, driven through the real pipeline**
 * (M7.4, `docs/M7_ISSUES.md` §1.2, §11.6).
 *
 * From M1 to M6 this repository recorded both as *implemented but unreachable*:
 * `canProjectileSplit` and `canChildCreateParentEffect` existed in
 * `combat/caps.ts` and were exercised only by their own unit tests, because
 * splitting is boss-core-exclusive (concept §11, §29.4) and there was no boss.
 * Every other cap had a mechanic that reached it; these two had a comment.
 *
 * M7's `split_return` reaches them. What follows is not "the function returns
 * false when passed true" — `caps.test.ts` already covers that, and it would
 * prove nothing about the game. These drive a real attack through
 * `startRangedAttack` and `stepProjectiles` and assert the two things the caps
 * exist to prevent can never be observed in a running world:
 *
 * - **no grandchild** — a split child that hits a target produces nothing;
 * - **no returning child** — a child that outlives its lifespan disappears.
 *
 * Both are also attacked directly, by handing the engine a child that *claims*
 * it may split and return. Content cannot raise a cap
 * (`docs/DEVELOPMENT_RULES.md`), and the way that is true is that the engine
 * refuses regardless of what the projectile says about itself.
 */
import { basicBow, splitReturn, multishot, piercingRounds } from "@carry-or-fall/game-content";
import { describe, expect, it } from "vitest";

import { buildWallGrid } from "./collision";
import { MAX_ACTIVE_PROJECTILES_PER_PLAYER, MAX_PROJECTILES_PER_ATTACK } from "./combat/caps";
import type { AttackTarget } from "./combat/pipeline";
import {
  PROJECTILE_LIFESPAN_MS,
  SPLIT_SPREAD_DEGREES,
  splitProjectile,
  startRangedAttack,
  stepProjectiles,
} from "./combat/ranged";
import { aggregateSkillEffects } from "./skill-effects";
import type { Projectile, Wall } from "./world";

const NO_WALLS: readonly Wall[] = [];
const grid = buildWallGrid(NO_WALLS);

const shooter = { id: "player-1", position: { x: 0, y: 0 }, facing: 0, radius: 16 };

/** A stationary, very tough target sitting directly in the shot's path. */
function target(id: string, x: number, health = 10_000): AttackTarget {
  return { id, position: { x, y: 0 }, radius: 20, health };
}

/**
 * A wall of targets across the fan a split produces, so every child runs into
 * something. Children diverge by design ({@link SPLIT_SPREAD_DEGREES}), so a
 * single point target further down the line would simply be missed — and the
 * test would then "pass" by observing nothing.
 */
function targetWall(prefix: string, x: number): readonly AttackTarget[] {
  return [-300, -150, 0, 150, 300].map((y, index) => ({
    id: `${prefix}-${String(index)}`,
    position: { x, y },
    radius: 90,
    health: 1e9,
  }));
}

/** Fire the bow with `split_return` equipped, exactly as a player carrying the core would. */
function fireSplitReturn(): readonly Projectile[] {
  const effects = aggregateSkillEffects([splitReturn], basicBow.tags);
  const result = startRangedAttack(shooter, basicBow, 0, 0, 1, undefined, effects);
  if (!result.started) {
    throw new Error(`the shot did not start: ${result.reason}`);
  }
  return result.projectiles;
}

/** Step `projectiles` until one of them hits `targets`, returning what survived. */
function stepUntilHit(
  projectiles: readonly Projectile[],
  targets: readonly AttackTarget[],
  maxSteps = 120,
): readonly Projectile[] {
  let live = projectiles;
  let working = targets;
  for (let step = 0; step < maxSteps; step += 1) {
    const result = stepProjectiles(live, 50, 0.05, working, grid);
    live = result.projectiles;
    working = result.updatedTargets;
    if (result.hitEvents.length > 0) {
      return live;
    }
  }
  throw new Error("no hit happened within the step budget");
}

describe("split_return actually splits (M7)", () => {
  it("seeds the fired projectile with the split the skill asked for", () => {
    const [projectile] = fireSplitReturn();
    expect(projectile!.splitCount).toBe(splitReturn.effects.splitCountAdd);
    expect(projectile!.isSplitChild).toBe(false);
    expect(projectile!.canReturn).toBe(true);
  });

  it("bursts into children when a target consumes it", () => {
    const survivors = stepUntilHit(fireSplitReturn(), [target("dummy", 300)]);

    expect(survivors.length).toBe(splitReturn.effects.splitCountAdd);
    for (const child of survivors) {
      expect(child.isSplitChild).toBe(true);
      expect(child.ownerId).toBe(shooter.id);
    }
    // They diverge, or "split" would be a rename of "keep going".
    const headings = survivors.map((child) => Math.atan2(child.velocity.y, child.velocity.x));
    expect(new Set(headings).size).toBe(survivors.length);
  });

  it("gives each child less damage than the parent carried", () => {
    const [parent] = fireSplitReturn();
    const survivors = stepUntilHit([parent!], [target("dummy", 300)]);
    for (const child of survivors) {
      expect(child.damage).toBeLessThan(parent!.damage);
      expect(child.damage).toBeGreaterThan(0);
    }
  });

  it("does not split a projectile that survived its hit by piercing", () => {
    // A pierced-through projectile was not consumed, so it both continues and
    // must not burst — one projectile becoming several while still being itself.
    const effects = aggregateSkillEffects([splitReturn, piercingRounds], basicBow.tags);
    const result = startRangedAttack(shooter, basicBow, 0, 0, 1, undefined, effects);
    if (!result.started) {
      throw new Error("the shot did not start");
    }
    const survivors = stepUntilHit(result.projectiles, [target("dummy", 300)]);

    expect(survivors).toHaveLength(1);
    expect(survivors[0]!.isSplitChild).toBe(false);
    expect(survivors[0]!.hitTargetIds).toContain("dummy");
  });
});

describe("cap 5: a split projectile cannot split again", () => {
  it("produces no grandchild when a child is itself consumed", () => {
    expect(SPLIT_SPREAD_DEGREES).toBeGreaterThan(0);
    const children = stepUntilHit(fireSplitReturn(), [target("first", 300)]);
    expect(children.length).toBeGreaterThan(0);

    // A wall further along, so every child hits something rather than sailing
    // past a point target the fan was never going to reach.
    const afterSecondHit = stepUntilHit(children, targetWall("second", 700));
    for (const survivor of afterSecondHit) {
      // Anything still alive is a sibling that has not hit yet, never a
      // grandchild: a grandchild's id would carry two "-split-" segments.
      expect(survivor.id.match(/-split-/g)?.length ?? 0).toBe(1);
    }
  });

  it("refuses a child that claims it may split, whatever its fields say", () => {
    // The adversarial form: content, a bug, or a hostile server could set
    // `splitCount` on a child. The cap is the engine's refusal, not the field.
    const [parent] = fireSplitReturn();
    const liar: Projectile = { ...parent!, isSplitChild: true, splitCount: 3 };
    expect(splitProjectile(liar, 0)).toEqual([]);
  });

  it("still splits a parent, so the refusal above is about being a child", () => {
    const [parent] = fireSplitReturn();
    expect(splitProjectile(parent!, 0).length).toBeGreaterThan(0);
  });
});

describe("cap 6: a child cannot create the parent effect", () => {
  it("lets the parent return once but never a child", () => {
    // The parent has `canReturn`; children are created without it. Run past the
    // lifespan and watch what comes back.
    const [parent] = fireSplitReturn();
    let live: readonly Projectile[] = [parent!];
    let returned = false;
    for (let step = 0; step < 200 && live.length > 0; step += 1) {
      live = stepProjectiles(live, 50, 0.05, [], grid).projectiles;
      if (live.some((projectile) => projectile.returnsSoFar > 0)) {
        returned = true;
      }
    }
    expect(returned).toBe(true);

    const children = stepUntilHit(fireSplitReturn(), [target("dummy", 300)]);
    for (const child of children) {
      expect(child.canReturn).toBe(false);
    }
  });

  it("refuses a child that claims it may return, and lets it expire instead", () => {
    const [parent] = fireSplitReturn();
    const liar: Projectile = {
      ...parent!,
      isSplitChild: true,
      canReturn: true,
      returnsSoFar: 0,
      remainingLifespanMs: 50,
    };

    const result = stepProjectiles([liar], 50, 0.05, [], grid);

    // Cap 6 refuses the return, so the projectile is simply gone. Without the
    // gate it would have come back with `returnsSoFar: 1`.
    expect(result.projectiles).toEqual([]);
  });

  it("still returns a non-child with the same fields, so the refusal is about lineage", () => {
    const [parent] = fireSplitReturn();
    const honest: Projectile = {
      ...parent!,
      isSplitChild: false,
      canReturn: true,
      returnsSoFar: 0,
      remainingLifespanMs: 50,
    };

    const result = stepProjectiles([honest], 50, 0.05, [], grid);

    expect(result.projectiles).toHaveLength(1);
    expect(result.projectiles[0]!.returnsSoFar).toBe(1);
  });
});

describe("splitting cannot escape the caps that already existed", () => {
  it("cap 1 bounds the burst however much content asks for", () => {
    const [parent] = fireSplitReturn();
    const greedy: Projectile = { ...parent!, splitCount: 999 };
    expect(splitProjectile(greedy, 0).length).toBeLessThanOrEqual(MAX_PROJECTILES_PER_ATTACK);
  });

  it("cap 7 bounds it again against what the owner already has in flight", () => {
    const [parent] = fireSplitReturn();
    const greedy: Projectile = { ...parent!, splitCount: 8 };

    // Room for two.
    expect(splitProjectile(greedy, MAX_ACTIVE_PROJECTILES_PER_PLAYER - 2)).toHaveLength(2);
    // Room for none.
    expect(splitProjectile(greedy, MAX_ACTIVE_PROJECTILES_PER_PLAYER)).toEqual([]);
  });

  it("keeps a multishot volley plus its splits inside the per-player ceiling", () => {
    // The realistic worst case a player can build today: every projectile skill
    // at once, every shot hitting something.
    const effects = aggregateSkillEffects([splitReturn, multishot], basicBow.tags);
    const result = startRangedAttack(shooter, basicBow, 0, 0, 1, undefined, effects);
    if (!result.started) {
      throw new Error("the shot did not start");
    }

    let live: readonly Projectile[] = result.projectiles;
    let targets: readonly AttackTarget[] = [target("wall-of-meat", 300, 1e9)];
    for (let step = 0; step < 200; step += 1) {
      const stepResult = stepProjectiles(live, 50, 0.05, targets, grid);
      live = stepResult.projectiles;
      targets = stepResult.updatedTargets;
      expect(live.length).toBeLessThanOrEqual(MAX_ACTIVE_PROJECTILES_PER_PLAYER);
    }
  });

  it("terminates: a world of splitters empties itself", () => {
    // The property the two recursion caps exist for, stated as the thing a
    // player would notice: projectiles stop. Without cap 5 this loop would never
    // reach zero.
    const effects = aggregateSkillEffects([splitReturn, multishot], basicBow.tags);
    const result = startRangedAttack(shooter, basicBow, 0, 0, 1, undefined, effects);
    if (!result.started) {
      throw new Error("the shot did not start");
    }

    let live: readonly Projectile[] = result.projectiles;
    let targets: readonly AttackTarget[] = [
      target("a", 200, 1e9),
      target("b", 500, 1e9),
      target("c", 800, 1e9),
    ];
    const steps = Math.ceil((PROJECTILE_LIFESPAN_MS * 4) / 50);
    for (let step = 0; step < steps && live.length > 0; step += 1) {
      const stepResult = stepProjectiles(live, 50, 0.05, targets, grid);
      live = stepResult.projectiles;
      targets = stepResult.updatedTargets;
    }
    expect(live).toEqual([]);
  });
});
