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
import { expect, test } from "@playwright/test";

import {
  DEFAULT_SKILL_LOADOUT_IDS,
  getLocalPlayer,
  getSnapshot,
  gotoGame,
  startRunWithLoadout,
  walkToArenaPoint,
  walkToward,
} from "./helpers";

const LAIR = testArena.bossSpawnPoint ?? { x: 0, y: 0 };

/** How far the boss currently is from its lair. */
function distanceFromLair(boss: { x: number; y: number }): number {
  return Math.hypot(boss.x - LAIR.x, boss.y - LAIR.y);
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

    await walkToArenaPoint(page, 700, 900, 40_000);

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

    await expect
      .poll(async () => (await getSnapshot(page)).boss?.awake ?? false, { timeout: 20_000 })
      .toBe(true);

    // It left its lair to come and meet us. Asserted **here**, while the player
    // is standing in the aggro radius, rather than after the retreat: the boss
    // walks home at 150 px/s and the player runs at 220, so by the end of even
    // one retreat leg it is usually back on its spawn and "did it move" reads as
    // "no". (Found exactly that way, by this test failing on a fast machine.)
    let worst = 0;
    await expect
      .poll(
        async () => {
          const boss = (await getSnapshot(page)).boss;
          if (boss !== null) {
            worst = Math.max(worst, distanceFromLair(boss));
          }
          return worst;
        },
        { timeout: 20_000 },
      )
      .toBeGreaterThan(20);

    // Now run. The boss gives chase and is stopped by its leash — the bound that
    // makes "the boss is over there" a fact about the map rather than a hope
    // about how fast a player runs.
    //
    // Retreat in legs, sampling between them, rather than from a background
    // loop: a poll still running after the test body returns would reach into a
    // page Playwright is closing.
    for (const legX of [LAIR.x - 400, LAIR.x - 600, 700]) {
      await walkToward(page, legX, 250, 30_000);
      const boss = (await getSnapshot(page)).boss;
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
