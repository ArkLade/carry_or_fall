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
  moveFor,
  pickUpAt,
  waitForMatchRunning,
  waitForSnapshot,
  walkToArenaPoint,
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
}

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
      // A walks left for a full second; B is not touched at all.
      await moveFor(page, "KeyA", 1000);

      const afterOnB = await waitForSnapshot(
        second,
        (view) => {
          const remote = view.players.find((player) => player.id === idA);
          return remote !== undefined && remote.x < beforeOnB.x - 30;
        },
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

      // Both walk to the same item; A gets there and takes it.
      await walkToArenaPoint(page, target.x, target.y, 40_000);
      await pickUpAt(page, target.x, target.y, (view) =>
        view.groundLoot.every((loot) => loot.id !== target.id),
      );
      expect((await getPrivateState(page)).inventory).toContain(target.lootId);

      // B sees it gone too, and taking it is not possible any more.
      const onB = await waitForSnapshot(
        second,
        (view) => view.groundLoot.every((loot) => loot.id !== target.id),
        10_000,
      );
      expect(onB.groundLoot.some((loot) => loot.id === target.id)).toBe(false);

      await walkToArenaPoint(second, target.x, target.y, 40_000);
      await interactFor(second, 400);
      const stateB = await getPrivateState(second);
      expect(stateB.inventory.filter((item) => item === target.lootId)).toHaveLength(0);
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

      // A walks to it and channels to completion. B does nothing: their run
      // must be entirely unaffected.
      await walkToArenaPoint(page, point.x, point.y, 45_000);
      await interactFor(page, 8_000);

      const resultA = (await getPrivateState(page)).runResult;
      expect(resultA?.outcome).toBe("extracted");

      // B is still playing, still alive, and has no result of their own.
      const stateB = await getPrivateState(second);
      expect(stateB.runResult).toBeNull();
      const playerB = await getLocalPlayer(second);
      expect(playerB.alive).toBe(true);
      expect(playerB.runOver).toBe(false);

      // And B sees A as out of the match, not still standing there.
      const onB = await waitForSnapshot(
        second,
        (view) => view.players.find((player) => player.id === idA)?.runOver === true,
        10_000,
      );
      expect(onB.players.find((player) => player.id === idA)?.runOver).toBe(true);
    } finally {
      await second.context().close();
    }
  });
});
