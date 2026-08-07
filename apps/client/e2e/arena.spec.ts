/**
 * Browser coverage for the arena the match is played on — three tankier enemies
 * on the large map — and for the run-end handoff back to `LoadoutScene`.
 *
 * These assert things only a real match can show: how many enemies the server
 * actually spawns and where, whether a projectile survives long enough to
 * return, and whether the scene flow loops — rather than re-checking content
 * values that `packages/*` unit tests already cover.
 */
import { basicBow, basicSword, chaser, testArena } from "@carry-or-fall/game-content";
import {
  EXTRACTION_CHANNEL_MS,
  EXTRACTION_POINT_ACTIVE_MS,
  PLAYER_SPEED,
  PROJECTILE_LIFESPAN_MS,
} from "@carry-or-fall/simulation-core";
import { expect, test } from "@playwright/test";

import {
  aimAt,
  attackChaserUntil,
  chooseLoadout,
  confirmLoadout,
  dieToChasers,
  getActiveSceneKey,
  getLocalPlayer,
  getPrivateState,
  getSnapshot,
  gotoGame,
  meetChasers,
  pressKey,
  fireAndObserve,
  reportMargin,
  startRunWithLoadout,
  waitForActiveScene,
  waitForMatchRunning,
  waitForRunResult,
  waitForSnapshot,
  walkToOpenLane,
  walkToward,
} from "./helpers";

test.describe("arena configuration", () => {
  test("a match spawns three enemies, each at its own position", async ({ page }) => {
    await gotoGame(page);
    await startRunWithLoadout(page, []);
    const snapshot = await getSnapshot(page);

    expect(snapshot.enemies).toHaveLength(testArena.enemyCount);
    const positions = snapshot.enemies.map((enemy) => `${String(enemy.x)},${String(enemy.y)}`);
    expect(new Set(positions).size).toBe(testArena.enemyCount);
  });

  test("no enemy starts close enough to reach the player before they can react", async ({
    page,
  }) => {
    await gotoGame(page);
    await startRunWithLoadout(page, []);
    const snapshot = await getSnapshot(page);
    const player = await getLocalPlayer(page);

    // Straight-line distance is the optimistic case for the enemy — it
    // ignores having to path around the divider — so a floor here is a real
    // floor on reaction time.
    const secondsOfWarning = snapshot.enemies.map(
      (enemy) => Math.hypot(enemy.x - player.x, enemy.y - player.y) / chaser.moveSpeed,
    );
    expect(Math.min(...secondsOfWarning)).toBeGreaterThan(5);
  });

  test("an enemy survives a landed sword hit, so a fight lasts long enough to observe", async ({
    page,
  }) => {
    test.setTimeout(150_000);
    await gotoGame(page);
    await startRunWithLoadout(page, []);
    await meetChasers(page);

    // The point of the health value: a landed swing damages an enemy but does
    // not delete it, which is what gives stun, shield, and skill effects time
    // to be visible at all.
    expect(chaser.health).toBeGreaterThan(basicSword.damage);

    const snapshot = await attackChaserUntil(
      page,
      (view) => view.enemies.some((enemy) => enemy.health < chaser.health && enemy.health > 0),
      60_000,
    );

    const damagedSurvivor = snapshot.enemies.find(
      (enemy) => enemy.health < chaser.health && enemy.health > 0,
    );
    expect(damagedSurvivor).toBeDefined();
  });
});

/**
 * How far a `basic_bow` projectile travels before its lifespan expires. Derived
 * from the content and the engine constant rather than hardcoded, so a change to
 * either moves the requirement below instead of silently invalidating it.
 */
const PROJECTILE_TRAVEL_PX = (PROJECTILE_LIFESPAN_MS / 1000) * (basicBow.projectileSpeed ?? 0);

/**
 * Where the shot is fired from: far enough west that the projectile expires in
 * open air rather than hitting the far border first. Firing from the middle of
 * the lane looks like it should work and does not — the shot reaches the east
 * wall a few pixels before its lifespan ends, and a projectile stopped by a wall
 * never returns.
 */
const OPEN_LANE_BORDERS = testArena.walls
  .filter((wall) => testArena.openLaneY >= wall.y && testArena.openLaneY <= wall.y + wall.height)
  .sort((left, right) => left.x - right.x);
const OPEN_LANE_LEFT_X = OPEN_LANE_BORDERS[0]!.x + OPEN_LANE_BORDERS[0]!.width;
const OPEN_LANE_RIGHT_X = OPEN_LANE_BORDERS[1]!.x;
const FIRING_X = OPEN_LANE_LEFT_X + 100;

test.describe("returning_shot is reachable on this arena", () => {
  test("a shot fired along the open lane survives its lifespan and reverses", async ({ page }) => {
    test.setTimeout(120_000);
    await gotoGame(page);
    await startRunWithLoadout(page, ["returning_shot"]);

    // The arena has to be long enough for the shot to expire in open space; a
    // shorter map makes this behavior unobservable entirely, which is why
    // `ArenaDefinition.openLaneY` exists at all.
    expect(OPEN_LANE_BORDERS).toHaveLength(2);
    expect(OPEN_LANE_RIGHT_X - FIRING_X).toBeGreaterThanOrEqual(PROJECTILE_TRAVEL_PX + 100);

    await walkToOpenLane(page);
    await walkToward(page, FIRING_X, testArena.openLaneY, 30_000);
    const player = await getLocalPlayer(page);
    await aimAt(page, player.x + 400, player.y);
    const fired = await fireAndObserve(page);
    expect(fired.projectiles).toHaveLength(1);
    expect(fired.projectiles[0]!.velocityX).toBeGreaterThan(0);
    expect(fired.projectiles[0]!.canReturn).toBe(true);

    // Poll past the projectile's 2000 ms lifespan for the reversal.
    const returned = await waitForSnapshot(
      page,
      (view) => view.projectiles.some((projectile) => projectile.returnsSoFar > 0),
      8000,
      100,
    );
    const reversed = returned.projectiles.find((projectile) => projectile.returnsSoFar > 0)!;
    expect(reversed.returnsSoFar).toBe(1);
    expect(reversed.velocityX).toBeLessThan(0); // reversed back toward the shooter
    expect(basicBow.projectileSpeed).toBeGreaterThan(0);
  });
});

test.describe("extraction active-window contract", () => {
  test("the longest active route, a Chaser fight, and the channel fit inside 75 seconds", async ({
    page,
    browser,
  }) => {
    const fightPage = await browser.newPage();
    const kiter = await browser.newPage();
    let fightMoveKey: "KeyD" | "KeyA" | null = null;
    const steerFightPage = async (next: "KeyD" | "KeyA"): Promise<void> => {
      await fightPage.bringToFront();
      if (fightMoveKey !== null) await fightPage.keyboard.up(fightMoveKey);
      await fightPage.keyboard.down(next);
      fightMoveKey = next;
      await fightPage.evaluate(
        () =>
          new Promise<void>((resolve) => {
            requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
          }),
      );
    };
    try {
      // Measure a complete representative fight in its own ordinary match.
      // Separating it from the extraction match prevents concurrency from
      // making combat time disappear from the route + fight + channel sum.
      await gotoGame(fightPage);
      await startRunWithLoadout(fightPage, ["homing_arrows"]);
      await walkToOpenLane(fightPage);
      await walkToward(fightPage, 1200, testArena.openLaneY);
      const beforeFight = await getSnapshot(fightPage);
      const initialEnemyIds = new Set(beforeFight.enemies.map((enemy) => enemy.id));
      await steerFightPage("KeyA");
      const fightStartedAt = Date.now();
      let afterFight = beforeFight;
      const maximumShotAttempts = Math.ceil(chaser.health / basicBow.damage) * 2;
      for (
        let shotAttempt = 0;
        shotAttempt < maximumShotAttempts &&
        afterFight.enemies.length === beforeFight.enemies.length;
        shotAttempt += 1
      ) {
        if (shotAttempt > 0 && shotAttempt % 3 === 0) {
          await steerFightPage(shotAttempt % 6 === 0 ? "KeyA" : "KeyD");
        }

        const fighterPlayer = await getLocalPlayer(fightPage);
        expect(fighterPlayer.alive).toBe(true);
        const target = [...afterFight.enemies].sort(
          (left, right) =>
            Math.hypot(left.x - fighterPlayer.x, left.y - fighterPlayer.y) -
            Math.hypot(right.x - fighterPlayer.x, right.y - fighterPlayer.y),
        )[0]!;
        const totalHealthBefore = afterFight.enemies.reduce(
          (total, enemy) => total + enemy.health,
          0,
        );
        await aimAt(fightPage, target.x, target.y);
        const fired = await fireAndObserve(fightPage);
        const firedProjectileIds = new Set(
          fired.projectiles
            .filter(
              (projectile) =>
                projectile.ownerId === fighterPlayer.id && projectile.homingStrength > 0,
            )
            .map((projectile) => projectile.id),
        );
        expect(firedProjectileIds.size).toBeGreaterThan(0);
        afterFight = await waitForSnapshot(
          fightPage,
          (view) =>
            view.enemies.length < beforeFight.enemies.length ||
            view.enemies.reduce((total, enemy) => total + enemy.health, 0) < totalHealthBefore ||
            [...firedProjectileIds].every(
              (id) => !view.projectiles.some((projectile) => projectile.id === id),
            ),
          8000,
          25,
        );
      }
      const fightMs = Date.now() - fightStartedAt;
      const defeatedEnemyIds = [...initialEnemyIds].filter(
        (id) => !afterFight.enemies.some((enemy) => enemy.id === id),
      );
      expect(defeatedEnemyIds).toHaveLength(1);
      expect(afterFight.enemies).toHaveLength(beforeFight.enemies.length - 1);
      if (fightMoveKey !== null) {
        await fightPage.keyboard.up(fightMoveKey);
        fightMoveKey = null;
      }
      await fightPage.context().close();

      // Use a fresh two-player match for the route and channel. The second
      // player remains a full-health target for the ordinary Chasers while the
      // first walks the exact longest canonical route.
      await gotoGame(page);
      await gotoGame(kiter);
      await chooseLoadout(page, []);
      await chooseLoadout(kiter, []);
      await confirmLoadout(page);
      await confirmLoadout(kiter);
      await Promise.all([waitForMatchRunning(page), waitForMatchRunning(kiter)]);

      const activeWindowObservedAt = Date.now();
      const spawn = await getLocalPlayer(page);
      const kiterSpawn = await getLocalPlayer(kiter);
      expect({ x: spawn.x, y: spawn.y }).toEqual({ x: 480, y: 220 });
      expect({ x: kiterSpawn.x, y: kiterSpawn.y }).toEqual({ x: 660, y: 220 });
      const extraction = (await getSnapshot(page)).extractionPoints.find(
        (point) => point.id === "extraction-0",
      );
      expect(extraction).toMatchObject({ x: 260, y: 1180 });
      if (extraction === undefined) return;
      const canonicalRoutePx =
        Math.abs(880 - spawn.x) +
        Math.abs(testArena.openLaneY - spawn.y) +
        Math.abs(extraction.x - 880) +
        Math.abs(extraction.y - testArena.openLaneY);
      expect(canonicalRoutePx).toBe(2020);
      expect(canonicalRoutePx / PLAYER_SPEED).toBeLessThan(EXTRACTION_POINT_ACTIVE_MS / 1000);

      await kiter.bringToFront();
      await walkToOpenLane(kiter);
      await walkToward(kiter, 1200, testArena.openLaneY);
      let extractionComplete = false;
      const kiteUntilExtraction = async (): Promise<void> => {
        let targetX = 2200;
        while (!extractionComplete) {
          await walkToward(kiter, targetX, testArena.openLaneY);
          targetX = targetX === 2200 ? 1200 : 2200;
        }
      };
      let intentionalKiterCleanup = false;
      const kiting = kiteUntilExtraction().then(
        () => ({ error: null, duringIntentionalCleanup: false }),
        (error: unknown) => ({
          error:
            error instanceof Error
              ? error
              : new Error("kiting rejected with a non-Error value", { cause: error }),
          duringIntentionalCleanup: intentionalKiterCleanup,
        }),
      );
      let routeMs = 0;
      const measureRouteLeg = async (walk: () => Promise<void>): Promise<void> => {
        const startedAt = Date.now();
        await walk();
        routeMs += Date.now() - startedAt;
      };
      await page.bringToFront();
      await measureRouteLeg(() => walkToOpenLane(page));
      await page.bringToFront();
      await measureRouteLeg(() => walkToward(page, extraction.x, testArena.openLaneY));
      await page.bringToFront();
      await measureRouteLeg(() => walkToward(page, extraction.x, extraction.y));
      await page.evaluate(
        () =>
          new Promise<void>((resolve) => {
            requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
          }),
      );
      const channelStartedAt = Date.now();
      let channelMs = 0;
      await page.keyboard.down("KeyE");
      try {
        const result = await waitForRunResult(page);
        expect(result.runResult?.outcome).toBe("extracted");
        channelMs = Date.now() - channelStartedAt;
        extractionComplete = true;
        intentionalKiterCleanup = true;
        await kiter.context().close();
      } finally {
        await page.keyboard.up("KeyE");
      }
      const kitingOutcome = await kiting;
      if (kitingOutcome.error !== null) {
        const intentionalTargetClose =
          kitingOutcome.duringIntentionalCleanup &&
          kitingOutcome.error.message.includes("Target page, context or browser has been closed");
        if (!intentionalTargetClose) throw kitingOutcome.error;
      }
      expect(channelMs).toBeGreaterThanOrEqual(EXTRACTION_CHANNEL_MS);

      const totalRequiredMs = routeMs + fightMs + channelMs;
      const activeWindowObservedMs = Date.now() - activeWindowObservedAt;
      const marginReportedAt = Date.now();
      reportMargin(
        "extractionActiveWindow",
        marginReportedAt - totalRequiredMs,
        EXTRACTION_POINT_ACTIVE_MS,
      );
      expect(totalRequiredMs).toBeLessThan(EXTRACTION_POINT_ACTIVE_MS);
      expect(activeWindowObservedMs).toBeLessThan(EXTRACTION_POINT_ACTIVE_MS);
      expect(EXTRACTION_POINT_ACTIVE_MS).toBeGreaterThanOrEqual(45_000);
      expect(EXTRACTION_POINT_ACTIVE_MS).toBeLessThanOrEqual(90_000);

      test.info().annotations.push(
        {
          type: "canonical-route",
          description: `${String(canonicalRoutePx)} px / ${String(routeMs)} ms`,
        },
        {
          type: "representative-fight",
          description: `one Chaser defeated / ${String(fightMs)} ms`,
        },
        { type: "extraction-channel", description: `${String(channelMs)} ms` },
        { type: "arithmetic-total", description: `${String(totalRequiredMs)} ms` },
        { type: "active-window-observed", description: `${String(activeWindowObservedMs)} ms` },
      );
    } finally {
      if (fightMoveKey !== null) {
        await fightPage.keyboard.up(fightMoveKey).catch(() => {});
      }
      await fightPage
        .context()
        .close()
        .catch(() => {});
      await kiter
        .context()
        .close()
        .catch(() => {});
    }
  });
});

test.describe("run end returns to the loadout screen", () => {
  test("finishing a run shows the result, then Enter hands off to LoadoutScene", async ({
    page,
  }) => {
    test.setTimeout(180_000);
    await gotoGame(page);
    await startRunWithLoadout(page, ["ricochet"]);

    // Die to the chasers: the shortest reliable way to end a run.
    const dead = await dieToChasers(page);
    expect(dead.alive).toBe(false);

    // The result is on screen and the run is over, but we are still in
    // PlayScene until the player acknowledges it.
    const result = await getPrivateState(page);
    expect(result.runResult?.outcome).toBe("died");
    expect(await getActiveSceneKey(page)).toBe("play");

    await pressKey(page, "Enter");
    await waitForActiveScene(page, "loadout");
    expect(await getActiveSceneKey(page)).toBe("loadout");
  });

  test("a different loadout can be chosen for the next match, and it takes effect", async ({
    page,
  }) => {
    test.setTimeout(180_000);
    await gotoGame(page);
    await startRunWithLoadout(page, ["ricochet"]);
    expect((await getPrivateState(page)).skillIds).toEqual(["ricochet"]);

    const dead = await dieToChasers(page);
    expect(dead.alive).toBe(false);

    await pressKey(page, "Enter");
    await waitForActiveScene(page, "loadout");

    // Swap ricochet out for piercing_rounds and start a fresh match.
    await pressKey(page, "2"); // ricochet off
    await pressKey(page, "3"); // piercing_rounds on
    await pressKey(page, "Enter");
    await waitForActiveScene(page, "play");
    await waitForMatchRunning(page);

    expect((await getPrivateState(page)).skillIds).toEqual(["piercing_rounds"]);
    const player = await getLocalPlayer(page);
    expect(player.alive).toBe(true);
    expect((await getPrivateState(page)).runResult).toBeNull();

    // And the new skill really is the one driving the projectile now.
    await aimAt(page, player.x + 400, player.y);
    const fired = await fireAndObserve(page);
    expect(fired.projectiles[0]!.piercesRemaining).toBe(2);
    expect(fired.projectiles[0]!.bouncesRemaining).toBe(0);
  });
});
