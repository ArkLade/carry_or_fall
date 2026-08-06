/**
 * The boss, through a real browser (M7, `docs/TEST_PLAN.md` §2.3).
 *
 * Two things only this suite can answer, because they are about the seam
 * between a server that decides and a client that draws:
 *
 * 1. **The boss reaches the client at all** — it is in the authoritative
 *    snapshot, at the lair the arena declares, with the health the definition
 *    gives it. A boss that stepped correctly on the server and never appeared in
 *    `MatchState` would pass every test in `packages/simulation-core` and be
 *    invisible in the game.
 * 2. **The leash holds from outside** — the property the *rest of this suite*
 *    depends on. Every other spec walks routes chosen to be at least a leash
 *    radius from the lair (`docs/M7_ISSUES.md` §1.8), and that is only a real
 *    guarantee if the boss genuinely cannot leave its circle when a player walks
 *    away from it.
 *
 * What this suite deliberately does **not** do is kill the boss. `warden` has
 * 300 health, which is roughly twenty seconds of uninterrupted bow fire through
 * a browser — time this suite would spend on a fight already proven in
 * `packages/simulation-core/src/boss.test.ts` and driven end-to-end over a real
 * socket in `apps/server/test/boss-core-decision.test.ts`. The core's three-way
 * decision is tested there, against a real server, for the same reason: it is a
 * server rule, and a browser adds nothing to the evidence but minutes.
 */
import { testArena, warden } from "@carry-or-fall/game-content";
import { expect, test, type Page } from "@playwright/test";

import {
  DEFAULT_SKILL_LOADOUT_IDS,
  getBoss,
  getLocalPlayer,
  getSnapshot,
  gotoGame,
  reportMargin,
  startRunWithLoadout,
  walkToArenaPoint,
  walkToward,
} from "./helpers";

const LAIR = testArena.bossSpawnPoint ?? { x: 0, y: 0 };
const ORDINARY_ROUTE_POINT = { x: 880, y: testArena.openLaneY } as const;
const SAFE_UPPER_LANE_Y = 240;

/** How far the boss currently is from its lair. */
function distanceFromLair(boss: { x: number; y: number }): number {
  return Math.hypot(boss.x - LAIR.x, boss.y - LAIR.y);
}

/** How far the boss must be from its lair to count as having left it. */
const LEFT_ITS_LAIR_PX = 20;

/**
 * How long the player may stand inside the aggro radius watching the boss come
 * out to meet it. **A health budget wearing a duration's clothes**, and the one
 * number in this file that had to be measured rather than chosen.
 *
 * The observation cannot be made instantly, and the reason is content: at the
 * approach point the player is 240 px from the lair, `warden_nova` reaches
 * 276 px, and a telegraphing boss does not move (`simulation-core/src/boss.ts`
 * commits it for the wind-up). So the Warden's *first* act is to stand still for
 * `warden_nova.telegraphMs` — 900 ms — and it only clears
 * {@link LEFT_ITS_LAIR_PX} at **t ≈ 1000 ms**. There is no route to this
 * evidence that does not cost the player one nova.
 *
 * What it must not cost is an *unbounded* stay. Measured against the real
 * simulation, a stationary player at the approach point loses health at
 * 16-22 per second — the Warden's opening rotation is nova 26 at 0.9 s, cleave
 * 14 at ~2.2 s, slam 20 at ~3.0 s — and the three chasers, which have been
 * following since spawn and have no leash, arrive about a second behind the
 * player and add 5 per touch. Standing for 3-4 s is fatal from full health. The
 * previous shape of this test used two `expect.poll` blocks with 20-second
 * timeouts, so the stay was bounded by *how fast the machine could answer* —
 * which on an idle machine is ~2 s and on a loaded CI runner is not.
 *
 * 2000 ms is ~1.9x the ~1050 ms the evidence actually needs, and the worst case
 * it can cost was measured end-to-end (spawn -> approach -> full dwell ->
 * retreat) at 40 health remaining on the slowest walker duty cycle that still
 * reaches the lair. The loop below also returns the instant the evidence is in,
 * so the typical cost is one nova and the player leaves at 74.
 */
const SORTIE_BUDGET_MS = 2_000;

/** What one visit to the aggro radius saw the boss do. */
interface Sortie {
  readonly awake: boolean;
  readonly worstLairDistance: number;
}

/**
 * Stand still and watch, returning the moment the boss is both awake and
 * demonstrably out of its lair — or when {@link SORTIE_BUDGET_MS} runs out,
 * with whatever was seen, so the caller's assertions report the shortfall
 * rather than a timeout.
 *
 * One cheap `getBoss` per iteration rather than a whole-match `getSnapshot`:
 * see that helper's note. `awake` is sticky and `worstLairDistance` is a running
 * maximum, so a sample that lands after the boss has already turned for home
 * cannot erase evidence an earlier one collected.
 */
async function watchSortie(page: Page): Promise<Sortie> {
  const budgetStart = Date.now();
  const deadline = budgetStart + SORTIE_BUDGET_MS;
  let awake = false;
  let worstLairDistance = 0;
  for (;;) {
    const boss = await getBoss(page);
    if (boss !== null) {
      awake ||= boss.awake;
      worstLairDistance = Math.max(worstLairDistance, distanceFromLair(boss));
    }
    if (awake && worstLairDistance > LEFT_ITS_LAIR_PX) {
      break;
    }
    if (Date.now() >= deadline) {
      break;
    }
    // Throttled, unlike an `expect.poll`, and deliberately short: ~80 samples
    // across the budget against a boss that clears the threshold at ~1000 ms,
    // so the evidence is caught promptly without spinning a tight loop on the
    // loaded machine this whole change exists to survive.
    await page.waitForTimeout(25);
  }
  reportMargin("bossSortie", budgetStart, SORTIE_BUDGET_MS);
  return { awake, worstLairDistance };
}

test.describe("the boss (concept §14.3)", () => {
  test("stands in its lair, at full health, in the state every client receives", async ({
    page,
  }) => {
    await gotoGame(page);
    await startRunWithLoadout(page, DEFAULT_SKILL_LOADOUT_IDS);

    const snapshot = await getSnapshot(page);
    const boss = snapshot.boss;
    expect(boss).not.toBeNull();
    if (boss === null) {
      return;
    }

    expect(boss.definitionId).toBe(warden.id);
    expect(boss.maxHealth).toBe(warden.health);
    expect(boss.health).toBe(warden.health);
    expect(Math.hypot(boss.x - LAIR.x, boss.y - LAIR.y)).toBeLessThan(1);

    // Asleep, and not winding anything up: nobody has visited it.
    expect(boss.awake).toBe(false);
    expect(boss.enraged).toBe(false);
    expect(boss.telegraphAttackIndex).toBe(-1);
  });

  test("ignores a player on the far side of the map, so the rest of the suite is safe", async ({
    page,
  }) => {
    // The whole reason the lair sits where it does. This walks the route the
    // extraction and chaser specs walk, and asserts the boss never moved — not
    // "did not reach me", which a fast machine could pass by accident, but
    // *never left its lair at all*.
    await gotoGame(page);
    await startRunWithLoadout(page, DEFAULT_SKILL_LOADOUT_IDS);

    await walkToArenaPoint(page, ORDINARY_ROUTE_POINT.x, ORDINARY_ROUTE_POINT.y, 40_000);

    const snapshot = await getSnapshot(page);
    const boss = snapshot.boss;
    expect(boss).not.toBeNull();
    if (boss === null) {
      return;
    }
    expect(boss.awake).toBe(false);
    expect(distanceFromLair(boss)).toBeLessThan(1);
  });

  test("wakes for a visitor, and cannot follow them out of its leash", async ({ page }) => {
    test.setTimeout(150_000);

    await gotoGame(page);
    await startRunWithLoadout(page, DEFAULT_SKILL_LOADOUT_IDS);

    // Walk into the aggro radius. The approach point is inside `aggroRadiusPx`
    // of the lair and on the boss's own side of the central divider.
    await walkToArenaPoint(page, LAIR.x - warden.aggroRadiusPx + 80, LAIR.y, 60_000);

    // Stand and watch, for a **bounded** time (see {@link SORTIE_BUDGET_MS}).
    // Both facts are collected in one window, from one cheap read, because the
    // window is paid for in the player's health rather than in wall clock.
    const sortie = await watchSortie(page);

    expect(sortie.awake).toBe(true);

    // It left its lair to come and meet us. Asserted from **this** window, while
    // the player is standing in the aggro radius, rather than after the retreat:
    // the boss walks home at 150 px/s and the player runs at 220, so by the end
    // of even one retreat leg it is usually back on its spawn and "did it move"
    // reads as "no". (Found exactly that way, by this test failing on a fast
    // machine.)
    expect(sortie.worstLairDistance).toBeGreaterThan(LEFT_ITS_LAIR_PX);
    let worst = sortie.worstLairDistance;

    // Now run. The boss gives chase and is stopped by its leash — the bound that
    // makes "the boss is over there" a fact about the map rather than a hope
    // about how fast a player runs.
    //
    // Retreat in legs, sampling between them, rather than from a background
    // loop: a poll still running after the test body returns would reach into a
    // page Playwright is closing.
    for (const legX of [LAIR.x - 400, LAIR.x - 600, ORDINARY_ROUTE_POINT.x]) {
      await walkToward(page, legX, SAFE_UPPER_LANE_Y, 30_000);
      // The cheap read again: between legs the player is standing still, and
      // the first leg is still partly inside the aggro radius.
      const boss = await getBoss(page);
      if (boss !== null) {
        worst = Math.max(worst, distanceFromLair(boss));
      }
    }

    // It never crossed the circle content draws around it.
    expect(worst).toBeLessThanOrEqual(warden.leashRadiusPx);

    // And the player is alive: leaving a telegraphed wind-up is possible, which
    // is what §14.3's "readable" means in practice.
    const player = await getLocalPlayer(page);
    expect(player.alive).toBe(true);
  });
});
