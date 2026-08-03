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
import { PROJECTILE_LIFESPAN_MS } from "@carry-or-fall/simulation-core";
import { expect, test } from "@playwright/test";

import {
  aimAt,
  attackChaserUntil,
  dieToChasers,
  getActiveSceneKey,
  getLocalPlayer,
  getPrivateState,
  getSnapshot,
  gotoGame,
  meetChasers,
  pressKey,
  fireAndObserve,
  startRunWithLoadout,
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
const FIRING_X = 400;

test.describe("returning_shot is reachable on this arena", () => {
  test("a shot fired along the open lane survives its lifespan and reverses", async ({ page }) => {
    test.setTimeout(120_000);
    await gotoGame(page);
    await startRunWithLoadout(page, ["returning_shot"]);

    // The arena has to be long enough for the shot to expire in open space; a
    // shorter map makes this behavior unobservable entirely, which is why
    // `ArenaDefinition.openLaneY` exists at all.
    expect(testArena.width - FIRING_X).toBeGreaterThan(PROJECTILE_TRAVEL_PX + 100);

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
    await page.waitForFunction(
      () => window.__CARRY_OR_FALL_DEBUG__?.getActiveSceneKey() === "loadout",
    );
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
    await page.waitForFunction(
      () => window.__CARRY_OR_FALL_DEBUG__?.getActiveSceneKey() === "loadout",
    );

    // Swap ricochet out for piercing_rounds and start a fresh match.
    await pressKey(page, "2"); // ricochet off
    await pressKey(page, "3"); // piercing_rounds on
    await pressKey(page, "Enter");
    await page.waitForFunction(
      () => window.__CARRY_OR_FALL_DEBUG__?.getActiveSceneKey() === "play",
    );
    await page.waitForFunction(
      () => window.__CARRY_OR_FALL_DEBUG__?.getSnapshot()?.phase === "running",
      undefined,
      { timeout: 30_000 },
    );

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
