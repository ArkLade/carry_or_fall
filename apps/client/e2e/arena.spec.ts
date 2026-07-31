/**
 * Browser coverage for the M4-prep arena tuning: three tankier enemies on a
 * map twice the size, and the run-end handoff back to `LoadoutScene`.
 *
 * These assert things only a real run can show — how many enemies actually
 * spawn and where, whether a projectile survives long enough to return, and
 * whether the scene flow loops — rather than re-checking the content values
 * that `packages/*` unit tests already cover.
 */
import { basicBow, basicSword, chaser } from "@carry-or-fall/game-content";
import { expect, test } from "@playwright/test";

import {
  aimAt,
  attackChaserUntil,
  dieToChasers,
  getActiveSceneKey,
  getWorld,
  gotoGame,
  meetChasers,
  pressKey,
  rangedAttackFor,
  startRunWithLoadout,
  walkToward,
} from "./helpers";

/**
 * Matches `PlayScene`'s `RETURNING_SHOT_LANE_Y`: the lower lane, which has no
 * wall across the map's width and sits directly below the player's start.
 */
const CLEAR_LANE_Y = 900;

test.describe("arena configuration (M4 prep)", () => {
  test("a run spawns three enemies, each at its own position", async ({ page }) => {
    await gotoGame(page);
    await startRunWithLoadout(page, []);
    const world = await getWorld(page);

    expect(world.enemies).toHaveLength(3);
    const positions = world.enemies.map(
      (enemy) => `${String(enemy.position.x)},${String(enemy.position.y)}`,
    );
    expect(new Set(positions).size).toBe(3);
  });

  test("no enemy starts close enough to reach the player before they can react", async ({
    page,
  }) => {
    await gotoGame(page);
    await startRunWithLoadout(page, []);
    const world = await getWorld(page);

    // Straight-line distance is the optimistic case for the enemy — it
    // ignores having to path around the divider — so a floor here is a real
    // floor on reaction time.
    const secondsOfWarning = world.enemies.map((enemy) => {
      const distance = Math.hypot(
        enemy.position.x - world.player.position.x,
        enemy.position.y - world.player.position.y,
      );
      return distance / chaser.moveSpeed;
    });
    expect(Math.min(...secondsOfWarning)).toBeGreaterThan(5);
  });

  test("an enemy survives a landed sword hit, so a fight lasts long enough to observe", async ({
    page,
  }) => {
    test.setTimeout(120_000);
    await gotoGame(page);
    await startRunWithLoadout(page, []);
    await meetChasers(page);

    // The point of the health change: a landed swing damages an enemy but
    // does not delete it, which is what gives stun, shield, and skill effects
    // time to be visible at all. Before the change a chaser died to one hit.
    expect(chaser.health).toBeGreaterThan(basicSword.damage);

    const world = await attackChaserUntil(
      page,
      (w) => w.enemies.some((enemy) => enemy.health < chaser.health && enemy.health > 0),
      40_000,
    );

    const damagedSurvivor = world.enemies.find(
      (enemy) => enemy.health < chaser.health && enemy.health > 0,
    );
    expect(damagedSurvivor).toBeDefined();
  });
});

test.describe("returning_shot is reachable on the larger map (M3 gap)", () => {
  test("a shot fired along a clear lane survives its lifespan and reverses", async ({ page }) => {
    test.setTimeout(60_000);
    await gotoGame(page);
    await startRunWithLoadout(page, ["returning_shot"]);

    // Drop straight down into the lower clear lane, then fire along it. The
    // old map was too short for a projectile to ever reach its lifespan in
    // open space, so this behavior could not be observed at all before the
    // map doubled.
    let world = await getWorld(page);
    await walkToward(page, world.player.position.x, CLEAR_LANE_Y, 25_000);
    world = await getWorld(page);
    await aimAt(page, world.player.position.x + 400, world.player.position.y);
    await rangedAttackFor(page, 80);

    world = await getWorld(page);
    expect(world.projectiles).toHaveLength(1);
    const outboundVelocityX = world.projectiles[0]!.velocity.x;
    expect(outboundVelocityX).toBeGreaterThan(0);
    expect(world.projectiles[0]!.canReturn).toBe(true);

    // Poll past the projectile's 2000ms lifespan for the reversal.
    let returned: { velocity: { x: number }; returnsSoFar: number } | undefined;
    for (let i = 0; i < 40; i += 1) {
      await page.waitForTimeout(100);
      world = await getWorld(page);
      const projectile = world.projectiles[0];
      if (projectile !== undefined && projectile.returnsSoFar > 0) {
        returned = projectile;
        break;
      }
      if (world.projectiles.length === 0) {
        break;
      }
    }

    expect(returned, "projectile never returned — it expired or hit a wall first").toBeDefined();
    expect(returned!.returnsSoFar).toBe(1);
    expect(returned!.velocity.x).toBeLessThan(0); // reversed back toward the shooter
    expect(basicBow.projectileSpeed).toBeGreaterThan(0);
  });
});

test.describe("run end returns to the loadout screen (M4 prep item 4)", () => {
  test("finishing a run shows the result, then Enter hands off to LoadoutScene", async ({
    page,
  }) => {
    test.setTimeout(120_000);
    await gotoGame(page);
    await startRunWithLoadout(page, ["ricochet"]);

    // Die to the chasers: the shortest reliable way to end a run.
    const world = await dieToChasers(page);
    expect(world.player.alive).toBe(false);

    // The result is on screen and the run is over, but we are still in
    // PlayScene until the player acknowledges it.
    expect(world.runResult).not.toBeNull();
    expect(await getActiveSceneKey(page)).toBe("play");

    await pressKey(page, "Enter");
    await page.waitForFunction(
      () => window.__CARRY_OR_FALL_DEBUG__?.getActiveSceneKey() === "loadout",
    );
    expect(await getActiveSceneKey(page)).toBe("loadout");
  });

  test("a different loadout can be chosen for the next run, and it takes effect", async ({
    page,
  }) => {
    test.setTimeout(120_000);
    await gotoGame(page);
    await startRunWithLoadout(page, ["ricochet"]);

    let world = await getWorld(page);
    expect(world.player.skillLoadout.map((skill) => skill.id)).toEqual(["ricochet"]);

    world = await dieToChasers(page);
    expect(world.player.alive).toBe(false);

    await pressKey(page, "Enter");
    await page.waitForFunction(
      () => window.__CARRY_OR_FALL_DEBUG__?.getActiveSceneKey() === "loadout",
    );

    // Swap ricochet out for piercing_rounds and start again.
    await pressKey(page, "2"); // ricochet off
    await pressKey(page, "3"); // piercing_rounds on
    await pressKey(page, "Enter");
    await page.waitForFunction(
      () => window.__CARRY_OR_FALL_DEBUG__?.getActiveSceneKey() === "play",
    );

    world = await getWorld(page);
    expect(world.player.skillLoadout.map((skill) => skill.id)).toEqual(["piercing_rounds"]);
    expect(world.player.alive).toBe(true);
    expect(world.runResult).toBeNull();

    // And the new skill really is the one driving the projectile now.
    await aimAt(page, world.player.position.x + 400, world.player.position.y);
    await rangedAttackFor(page, 80);
    world = await getWorld(page);
    expect(world.projectiles[0]!.piercesRemaining).toBe(2);
    expect(world.projectiles[0]!.bouncesRemaining).toBe(0);
  });
});
