/**
 * **Exit criterion 1 for §38 M4: "two real browsers can play."**
 *
 * Two independent browser contexts — separate storage, separate sockets, two
 * real Chromium pages — join one server and play the same match. Nothing here
 * inspects server internals: each page is driven with real keyboard and mouse
 * input and each assertion reads that page's own view of the authoritative
 * state, so what is proven is what a human at either machine would see.
 *
 * The four things §38 M4 needs demonstrated between two clients are covered
 * below: each sees the other's movement, enemies are consistent across both,
 * loot picked up by one is gone for the other, and extraction resolves
 * correctly and independently for each.
 */
import { testArena } from "@carry-or-fall/game-content";
import { expect, test, type Browser, type Page } from "@playwright/test";

import {
  chooseLoadout,
  confirmLoadout,
  getLocalPlayer,
  getLocalPlayerId,
  getPrivateState,
  getSnapshot,
  gotoGame,
  interactFor,
  pickUpAt,
  reportMargin,
  waitForMatchState,
  waitForMatchRunning,
  waitForRunResult,
  walkToArenaPoint,
  walkToward,
} from "./helpers";

/**
 * Open a second, fully independent browser context. A second *page* in the same
 * context would share storage and look like one client to anything that later
 * cares; a separate context is the closest thing to a second machine.
 */
async function openSecondClient(browser: Browser): Promise<Page> {
  const context = await browser.newContext();
  return context.newPage();
}

/**
 * Bring both clients into the same match.
 *
 * They land in the same room because the server keeps a short lobby open and
 * only locks it when the match starts (technical plan §8.3), so both
 * `joinOrCreate` calls resolve to the room the first one created — provided the
 * second gets in before the countdown expires.
 *
 * The phases are ordered deliberately. Anything that **drives input** is done
 * one page at a time, because a backgrounded tab's animation frame is throttled
 * and Phaser reads the keyboard on that frame; two pages typing at once means
 * one of them is asleep. Anything that only **waits** runs for both at once,
 * because snapshots arrive over the WebSocket and do not depend on the frame
 * loop at all.
 */
async function joinSameMatch(pageA: Page, pageB: Page): Promise<void> {
  await Promise.all([gotoGame(pageA), gotoGame(pageB)]);

  await chooseLoadout(pageA, []);
  await chooseLoadout(pageB, []);

  // Both joins land inside the lobby window; neither blocks on the countdown.
  await confirmLoadout(pageA);
  await confirmLoadout(pageB);

  await Promise.all([waitForMatchRunning(pageA), waitForMatchRunning(pageB)]);

  // Assert the thing every test below silently assumes. The room locks when the
  // countdown expires (technical plan §8.3), so a second client that is slow to
  // join lands in a *different* match — and then every assertion about "the
  // other player" is waiting for someone who was never there, which reads as a
  // slow test rather than a broken premise. Checked once, here, so it is named.
  const [playersA, playersB] = await Promise.all([getSnapshot(pageA), getSnapshot(pageB)]);
  if (playersA.players.length !== 2 || playersB.players.length !== 2) {
    throw new Error(
      "the two clients did not land in the same match " +
        `(client A sees ${String(playersA.players.length)} player(s), ` +
        `client B sees ${String(playersB.players.length)}). ` +
        "The lobby countdown (MATCH_LOBBY_MS in playwright.config.ts) is the window " +
        "in which the second client must join; it is too short for this machine.",
    );
  }
}

/**
 * How long an idle player survives once a match starts, with this suite's seed.
 *
 * Not a guess: with `MATCH_SEED=76` the three chasers spawn 1124-1287 px from
 * the players (measured), close at 90 px/s in a straight line and about 53 px/s
 * once the divider is in the way (also measured), and contact costs 5 health
 * every 500 ms against 100 health. So the earliest an untouched, motionless
 * player can die is roughly 13 s of travel plus 10 s of grinding.
 *
 * **This is a premise check, not the thing that makes the test work.** It fails
 * loudly if a window that should be short somehow was not — but the window is
 * short by construction, because both of its parts are paid in *server* time:
 * `walkToward` sizes its key holds to the distance left (so travel costs
 * distance ÷ `PLAYER_SPEED`, whatever the machine is doing), and the extraction
 * channel is a fixed 5 s of simulation. Measured end to end, the window is
 * 8.8 s against this 20 s budget, and the nearest chaser was still 811 px away
 * when the extraction completed.
 *
 * Before the walker was fixed the same window measured 19.9-22.5 s: the walk was
 * paid in *machine* time at a 25% duty cycle, so a loaded CI runner stretched it
 * until a chaser arrived. That is the failure this constant used to absorb and
 * no longer has to.
 */
const IDLE_PLAYER_SURVIVES_MS = 20_000;

test.describe("two real browsers play one match (§38 M4 exit criterion 1)", () => {
  test("both clients join the same room and see two players", async ({ page, browser }) => {
    test.setTimeout(120_000);
    const second = await openSecondClient(browser);
    try {
      await joinSameMatch(page, second);

      const [snapshotA, snapshotB] = await Promise.all([getSnapshot(page), getSnapshot(second)]);
      expect(snapshotA.players).toHaveLength(2);
      expect(snapshotB.players).toHaveLength(2);

      // Same room, same match: identical seed, identical arena, identical
      // player ids on both sides.
      expect(snapshotB.seed).toBe(snapshotA.seed);
      expect(snapshotB.arenaId).toBe(snapshotA.arenaId);
      expect(snapshotB.players.map((player) => player.id).sort()).toEqual(
        snapshotA.players.map((player) => player.id).sort(),
      );

      // Each client knows which of the two is itself, and they are different.
      const [idA, idB] = await Promise.all([getLocalPlayerId(page), getLocalPlayerId(second)]);
      expect(idA).not.toBe(idB);
    } finally {
      await second.context().close();
    }
  });

  test("one client's movement is visible to the other", async ({ page, browser }) => {
    test.setTimeout(120_000);
    const second = await openSecondClient(browser);
    try {
      await joinSameMatch(page, second);
      const idA = await getLocalPlayerId(page);

      const beforeOnB = (await getSnapshot(second)).players.find((player) => player.id === idA)!;
      // A moves an authoritative 100 px left; B is not touched at all.
      await walkToward(page, beforeOnB.x - 100, beforeOnB.y, 10_000);

      const afterOnB = await waitForMatchState(
        second,
        { kind: "player_x_below", id: idA, x: beforeOnB.x - 30 },
        10_000,
      );

      const movedOnB = afterOnB.players.find((player) => player.id === idA)!;
      const movedOnA = await getLocalPlayer(page);
      expect(movedOnB.x).toBeLessThan(beforeOnB.x);
      // Both clients agree about where A is, within one interpolation step.
      expect(Math.abs(movedOnB.x - movedOnA.x)).toBeLessThan(40);
    } finally {
      await second.context().close();
    }
  });

  test("enemies are the same on both clients", async ({ page, browser }) => {
    test.setTimeout(120_000);
    const second = await openSecondClient(browser);
    try {
      await joinSameMatch(page, second);

      const [snapshotA, snapshotB] = await Promise.all([getSnapshot(page), getSnapshot(second)]);
      expect(snapshotA.enemies).toHaveLength(testArena.enemyCount);
      expect(snapshotB.enemies.map((enemy) => enemy.id).sort()).toEqual(
        snapshotA.enemies.map((enemy) => enemy.id).sort(),
      );

      // Positions agree closely: both are rendering the same authoritative
      // enemies, sampled at most a tick apart.
      for (const enemyA of snapshotA.enemies) {
        const enemyB = snapshotB.enemies.find((enemy) => enemy.id === enemyA.id)!;
        expect(Math.hypot(enemyA.x - enemyB.x, enemyA.y - enemyB.y)).toBeLessThan(40);
        expect(enemyB.maxHealth).toBe(enemyA.maxHealth);
      }
    } finally {
      await second.context().close();
    }
  });

  test("loot picked up by one client is gone for the other, and cannot be taken twice", async ({
    page,
    browser,
  }) => {
    test.setTimeout(150_000);
    const second = await openSecondClient(browser);
    try {
      await joinSameMatch(page, second);

      const snapshot = await getSnapshot(page);
      const target = snapshot.groundLoot[0]!;

      // **Both** stand over the item before either takes it. That is what
      // concept §32 means by "two players looting the same item", and it is
      // also what keeps this test short: the previous order — A walks, A takes
      // it, B then crosses the arena to try — left one player or the other
      // standing in the middle of the map, which is where the chasers converge,
      // for roughly twice as long as the contest itself needs.
      await walkToArenaPoint(second, target.x, target.y, 40_000);
      await walkToArenaPoint(page, target.x, target.y, 40_000);

      // A takes it, with B in range of the same item the whole time.
      await pickUpAt(page, target.x, target.y, { kind: "ground_loot", id: target.id });
      expect((await getPrivateState(page)).inventory).toContain(target.lootId);

      // B sees it gone too, and taking it is not possible any more.
      const onB = await waitForMatchState(
        second,
        { kind: "ground_loot_missing", id: target.id },
        10_000,
      );
      expect(onB.groundLoot.some((loot) => loot.id === target.id)).toBe(false);

      await interactFor(second, 400);
      const stateB = await getPrivateState(second);
      expect(stateB.inventory.filter((item) => item === target.lootId)).toHaveLength(0);

      // The premise the assertion above rests on, checked rather than assumed:
      // A never died holding it. A dead player drops their inventory where they
      // stood (concept §15.2) — which here is exactly where B is standing — so
      // B ending up with the item would be correct behaviour rather than a
      // double pickup, and this test would be reporting the opposite of what
      // happened. Seen once, when a frame-timing fix made B's interact land
      // reliably for the first time.
      const playerA = await getLocalPlayer(page);
      expect(playerA.alive).toBe(true);
      expect((await getPrivateState(page)).inventory).toContain(target.lootId);
    } finally {
      await second.context().close();
    }
  });

  test("extraction resolves independently: one client extracts while the other keeps playing", async ({
    page,
    browser,
  }) => {
    test.setTimeout(180_000);
    const second = await openSecondClient(browser);
    try {
      await joinSameMatch(page, second);

      const snapshot = await getSnapshot(page);
      const playerA = await getLocalPlayer(page);
      // The nearest active point, so the walk is short and the channel starts
      // well before the chasers can cross the map and interrupt it — an
      // interruption is correct behavior that would fail this test for the
      // wrong reason.
      const point = [...snapshot.extractionPoints].sort(
        (left, right) =>
          Math.hypot(left.x - playerA.x, left.y - playerA.y) -
          Math.hypot(right.x - playerA.x, right.y - playerA.y),
      )[0]!;
      const idA = await getLocalPlayerId(page);

      // A walks to it and channels to completion. B does nothing: their run must
      // be entirely unaffected. The clock starts here because this is when B's
      // stillness starts costing them (see IDLE_PLAYER_SURVIVES_MS).
      const idleStartedAt = Date.now();
      await walkToArenaPoint(page, point.x, point.y, 45_000);

      // Hold interact until the server actually reports the extraction, rather
      // than for a fixed span. The channel is five seconds; waiting a fixed
      // eight spent three of them keeping B idle for no reason, and the whole
      // difficulty in this test is how long B is left standing still.
      await page.keyboard.down("KeyE");
      let resultA: Awaited<ReturnType<typeof getPrivateState>>["runResult"] = null;
      try {
        resultA = (await waitForRunResult(page, 15_000)).runResult;
      } finally {
        await page.keyboard.up("KeyE");
      }
      expect(resultA?.outcome).toBe("extracted");

      // The premise this test rests on, asserted rather than assumed: B was only
      // ever idle for a fraction of the time it takes the chasers to kill them,
      // so "B is still alive" below is a property of the design and not of how
      // busy the machine happened to be.
      const idleMs = Date.now() - idleStartedAt;
      // Reported as well as asserted, so the margin audit sees it. It is a
      // budget spent inside a spec rather than inside `helpers.ts`, which until
      // M7 meant `E2E_MARGIN=1` could not measure it at all — the same blind
      // spot that let the M7 audit certify a floor for a boss test whose one
      // wait it had never seen (`docs/TEST_PLAN.md` §5, "The margin audit").
      reportMargin("extractionIdleWindow", idleStartedAt, IDLE_PLAYER_SURVIVES_MS);
      expect(idleMs).toBeLessThan(IDLE_PLAYER_SURVIVES_MS);

      // B is still playing, still alive, and has no result of their own.
      const stateB = await getPrivateState(second);
      expect(stateB.runResult).toBeNull();
      const playerB = await getLocalPlayer(second);
      expect(playerB.alive).toBe(true);
      expect(playerB.runOver).toBe(false);

      // And B sees A as out of the match, not still standing there.
      const onB = await waitForMatchState(second, { kind: "player_run_over", id: idA }, 10_000);
      expect(onB.players.find((player) => player.id === idA)?.runOver).toBe(true);
    } finally {
      await second.context().close();
    }
  });
});
