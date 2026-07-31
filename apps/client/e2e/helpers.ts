/**
 * Shared helpers for the browser end-to-end suite (`docs/TEST_PLAN.md`
 * §2.3). Every helper drives the page the way a human would (real keyboard/
 * mouse events into the canvas) and reads state back only through the
 * dev-only debug hook (`apps/client/src/debug/debug-hook.ts`) — no test here
 * reaches into client internals or asserts on DOM text (Phaser renders to
 * `<canvas>`, not real DOM nodes).
 *
 * `pressKey` explicitly holds each key down for a short, real duration
 * instead of using Playwright's atomic `press()`. This matters specifically
 * for `LoadoutScene`'s digit/Enter keys, which are read via Phaser's
 * edge-triggered `JustDown` once per animation frame: `press()`'s
 * near-zero-duration keydown+keyup can land and clear within the same
 * frame Phaser's `update()` never observes, silently dropping the input —
 * confirmed empirically (a 5-attempt loop of bare `press("Enter")` calls
 * failed ~60% of the time; holding the key for 50ms was reliable across 20+
 * consecutive runs). A real human keypress is never zero-duration either,
 * so this is a faithful simulation, not a workaround for a client defect.
 */
import type { Page } from "@playwright/test";
import { ALL_SKILLS } from "@carry-or-fall/game-content";
import type { World } from "@carry-or-fall/simulation-core";

/** Matches `main.ts`'s Phaser game config (and so `PlayScene`'s map dimensions). */
export const GAME_WIDTH = 1920;
export const GAME_HEIGHT = 1080;

/** Matches `LoadoutScene.ts`'s `DEFAULT_SKILL_LOADOUT_IDS`. */
export const DEFAULT_SKILL_LOADOUT_IDS = ["ricochet", "extended_reach", "bulwark_strike"];

/** Hold `key` down for `holdMs`, then release — see the module doc for why this beats `press()`. */
export async function pressKey(page: Page, key: string, holdMs = 50): Promise<void> {
  await page.keyboard.down(key);
  await page.waitForTimeout(holdMs);
  await page.keyboard.up(key);
}

export async function gotoGame(page: Page): Promise<void> {
  await page.goto("/");
  // Wait for LoadoutScene's own create() to have actually run (not just for
  // the hook object to exist, which main.ts installs synchronously before
  // Phaser's async boot/scene-start sequence completes) — otherwise an
  // immediate keypress can race ahead of `LoadoutScene.create()` registering
  // its keys and be silently dropped.
  await page.waitForFunction(
    () => window.__CARRY_OR_FALL_DEBUG__?.getActiveSceneKey() === "loadout",
  );
}

export async function getActiveSceneKey(page: Page): Promise<string | null> {
  return page.evaluate(() => window.__CARRY_OR_FALL_DEBUG__?.getActiveSceneKey() ?? null);
}

/** Reads the current `World`. Throws if no run is active (`getWorld()` is `null`). */
export async function getWorld(page: Page): Promise<World> {
  const world = await page.evaluate(() => window.__CARRY_OR_FALL_DEBUG__?.getWorld() ?? null);
  if (world === null) {
    throw new Error("expected an active run: getWorld() returned null");
  }
  return world;
}

function digitKeyFor(skillId: string): string {
  const index = ALL_SKILLS.findIndex((skill) => skill.id === skillId);
  if (index === -1) {
    throw new Error(`unknown skill id: ${skillId}`);
  }
  return index === 9 ? "0" : String(index + 1);
}

/**
 * From `LoadoutScene`, deselect every default skill, select exactly
 * `skillIds` (order matters only for slot-budget legality, the caller's
 * responsibility), then press Enter and wait for `PlayScene` to become
 * active. Assumes the page is already on `LoadoutScene` (call {@link
 * gotoGame} first).
 */
export async function startRunWithLoadout(page: Page, skillIds: readonly string[]): Promise<void> {
  for (const id of DEFAULT_SKILL_LOADOUT_IDS) {
    await pressKey(page, digitKeyFor(id));
  }
  for (const id of skillIds) {
    await pressKey(page, digitKeyFor(id));
  }
  await pressKey(page, "Enter");
  await page.waitForFunction(() => window.__CARRY_OR_FALL_DEBUG__?.getActiveSceneKey() === "play");
}

/** The canvas's on-screen bounding box, for converting a world position to a page click/move position. */
async function canvasBox(
  page: Page,
): Promise<{ x: number; y: number; width: number; height: number }> {
  const box = await page.locator("canvas").boundingBox();
  if (box === null) {
    throw new Error("canvas not found");
  }
  return box;
}

/** Convert a world-space position to a page-space position, accounting for Phaser's FIT scaling. */
export async function worldToPage(
  page: Page,
  worldX: number,
  worldY: number,
): Promise<{ x: number; y: number }> {
  const box = await canvasBox(page);
  return {
    x: box.x + worldX * (box.width / GAME_WIDTH),
    y: box.y + worldY * (box.height / GAME_HEIGHT),
  };
}

/** Move the mouse so the player aims at `worldX`/`worldY` (`input/pointer.ts`'s `aimAngleFrom`). */
export async function aimAt(page: Page, worldX: number, worldY: number): Promise<void> {
  const point = await worldToPage(page, worldX, worldY);
  await page.mouse.move(point.x, point.y);
}

/** Hold WASD for `durationMs`, moving the player, then release. */
export async function moveFor(
  page: Page,
  direction: "KeyW" | "KeyA" | "KeyS" | "KeyD",
  durationMs: number,
): Promise<void> {
  await page.keyboard.down(direction);
  await page.waitForTimeout(durationMs);
  await page.keyboard.up(direction);
}

/** Hold the left mouse button (melee attack, `input/pointer.ts`) for `durationMs`. */
export async function meleeAttackFor(page: Page, durationMs: number): Promise<void> {
  await page.mouse.down({ button: "left" });
  await page.waitForTimeout(durationMs);
  await page.mouse.up({ button: "left" });
}

/** Hold the right mouse button (ranged attack, `input/pointer.ts`) for `durationMs`. */
export async function rangedAttackFor(page: Page, durationMs: number): Promise<void> {
  await page.mouse.down({ button: "right" });
  await page.waitForTimeout(durationMs);
  await page.mouse.up({ button: "right" });
}

/** Hold `E` (interact — level-triggered, `input/keyboard.ts`) for `durationMs`. */
export async function interactFor(page: Page, durationMs: number): Promise<void> {
  await page.keyboard.down("KeyE");
  await page.waitForTimeout(durationMs);
  await page.keyboard.up("KeyE");
}

type MoveKey = "KeyA" | "KeyD" | "KeyW" | "KeyS";

/**
 * Walk the player toward `targetX`/`targetY`, polling actual position via the
 * debug hook rather than assuming travel time (the chasers are closing
 * distance at the same time, and walls can block a leg of the route).
 *
 * Wall routing is **derived from behavior, not from hardcoded coordinates**:
 * the walker moves greedily toward the target, and if it stops making
 * progress it assumes a wall is in the way and sidesteps vertically for a
 * moment before resuming. That kept working unchanged when the map doubled
 * and gained two more interior walls, whereas the previous version encoded
 * the single original wall's x/y bands and silently mis-routed the moment the
 * map changed.
 */
export async function walkToward(
  page: Page,
  targetX: number,
  targetY: number,
  maxMs = 20_000,
): Promise<void> {
  const deadline = Date.now() + maxMs;
  let previousDistance = Number.POSITIVE_INFINITY;
  let stalledPolls = 0;
  let sidestep: MoveKey | null = null;
  let sidestepPollsLeft = 0;
  // Flipped on each new stall, so if the first way around an obstacle is
  // itself blocked the walker tries the other way instead of retrying the
  // same failing detour forever.
  let sidestepSign = 1;

  for (;;) {
    const world = await getWorld(page);
    const { x, y } = world.player.position;
    const dx = targetX - x;
    const dy = targetY - y;
    const distance = Math.hypot(dx, dy);
    if (distance < 24) {
      return;
    }
    if (Date.now() > deadline) {
      throw new Error(
        `walkToward: did not reach (${String(targetX)}, ${String(targetY)}) within ${String(maxMs)}ms`,
      );
    }

    // "Barely closed the gap since the last poll" means something is in the
    // way — the walker is pressed against a wall it needs to go around.
    if (distance > previousDistance - 4) {
      stalledPolls += 1;
    } else {
      stalledPolls = 0;
    }
    previousDistance = distance;

    if (stalledPolls >= 2 && sidestepPollsLeft <= 0) {
      // Detour *perpendicular* to the direction of travel: pushing further
      // along the blocked axis just presses harder into the wall. A vertical
      // wall (blocking horizontal travel) is cleared by moving vertically,
      // and a horizontal wall by moving horizontally.
      const blockedAxisIsHorizontal = Math.abs(dx) > Math.abs(dy);
      if (blockedAxisIsHorizontal) {
        sidestep = sidestepSign > 0 ? "KeyW" : "KeyS";
      } else {
        sidestep = sidestepSign > 0 ? "KeyA" : "KeyD";
      }
      sidestepSign *= -1;
      sidestepPollsLeft = 8;
      stalledPolls = 0;
    }

    const keys: MoveKey[] = [];
    if (sidestepPollsLeft > 0 && sidestep !== null) {
      keys.push(sidestep);
      // Keep pushing along the blocked axis too, so the moment the detour
      // clears the obstacle the walker immediately resumes progress.
      if (sidestep === "KeyW" || sidestep === "KeyS") {
        if (Math.abs(dx) > 10) keys.push(dx > 0 ? "KeyD" : "KeyA");
      } else if (Math.abs(dy) > 10) {
        keys.push(dy > 0 ? "KeyS" : "KeyW");
      }
      sidestepPollsLeft -= 1;
    } else {
      if (Math.abs(dx) > 10) keys.push(dx > 0 ? "KeyD" : "KeyA");
      if (Math.abs(dy) > 10) keys.push(dy > 0 ? "KeyS" : "KeyW");
    }

    for (const key of keys) {
      await page.keyboard.down(key);
    }
    await page.waitForTimeout(150);
    for (const key of keys) {
      await page.keyboard.up(key);
    }
  }
}

/** basic_sword's melee reach: rangePx (56) + the chaser's radius (18) — see `isWithinMeleeArc`. */
const MELEE_REACH_PX = 74;
/** PLAYER_RADIUS (16) + ENEMY_RADIUS (18) — the chaser deals contact damage once inside this. */
const TOUCH_DISTANCE_PX = 34;

/**
 * Where the death helper goes to meet the chasers: on **their** side of the
 * central divider, in the lower clear lane.
 *
 * This must not be on the player's own side of the divider. `enemy.ts` chases
 * greedily per axis with no pathfinding, so a chaser that slides along the
 * divider until it is dead-level with the player has no vertical component
 * left and simply presses into the wall forever — the player standing in the
 * wall's shadow is untouchable. Walking around to meet them sidesteps that
 * entirely, and is also how a player actually dies.
 */
const MEET_CHASERS_SPOT = { x: 1200, y: 900 };

/**
 * Walk to {@link MEET_CHASERS_SPOT} via the lower clear lane, in two straight
 * legs — down from the spawn column, then east along the lane. Both legs are
 * free of walls by construction, so this never depends on the
 * stall-and-sidestep detour logic and stays deterministic.
 */
export async function meetChasers(page: Page): Promise<void> {
  const start = await getWorld(page);
  await walkToward(page, start.player.position.x, MEET_CHASERS_SPOT.y, 20_000);
  await walkToward(page, MEET_CHASERS_SPOT.x, MEET_CHASERS_SPOT.y, 20_000);
}

/** Let the chasers kill the player, and return the finished world. */
export async function dieToChasers(page: Page, maxMs = 40_000): Promise<World> {
  await meetChasers(page);

  const deadline = Date.now() + maxMs;
  for (;;) {
    const world = await getWorld(page);
    if (!world.player.alive) {
      return world;
    }
    if (Date.now() > deadline) {
      throw new Error(
        `dieToChasers: player still alive after ${String(maxMs)}ms (hp ${String(world.player.health)})`,
      );
    }
    await page.waitForTimeout(200);
  }
}

/** The enemy closest to the player right now, or `null` if none are left alive. */
export function nearestEnemy(world: World): World["enemies"][number] | null {
  let nearest: World["enemies"][number] | null = null;
  let nearestDistance = Number.POSITIVE_INFINITY;
  for (const enemy of world.enemies) {
    const distance = Math.hypot(
      enemy.position.x - world.player.position.x,
      enemy.position.y - world.player.position.y,
    );
    if (distance < nearestDistance) {
      nearest = enemy;
      nearestDistance = distance;
    }
  }
  return nearest;
}

/**
 * Repeatedly aim at the **nearest** live enemy and throw a melee swing until
 * `predicate(world)` is true, without ever voluntarily walking the player
 * into contact-damage range: the state machine only swings while the live
 * distance is inside melee reach but outside touch distance, retreats a step
 * if that enemy closes past touch distance, and otherwise waits for the
 * chasers' own behavior (`docs/M1_EXECUTION_PLAN.md` M1.9) to bring one into
 * range — real behavior, not a scripted approach.
 *
 * Targets the nearest rather than `enemies[0]` because a run now spawns
 * three: fixing on the first in the array would leave the player swinging at
 * a distant enemy while a closer one is already dealing contact damage.
 */
export async function attackChaserUntil(
  page: Page,
  predicate: (world: World) => boolean,
  maxMs = 20_000,
): Promise<World> {
  const deadline = Date.now() + maxMs;
  for (;;) {
    const world = await getWorld(page);
    if (predicate(world)) {
      return world;
    }
    if (Date.now() > deadline) {
      throw new Error(`attackChaserUntil: predicate never became true within ${String(maxMs)}ms`);
    }
    if (!world.player.alive) {
      throw new Error("attackChaserUntil: player died before predicate became true");
    }
    const enemy = nearestEnemy(world);
    if (enemy === null) {
      await page.waitForTimeout(100);
      continue;
    }

    if (world.player.meleeAttack !== null) {
      // A swing is already resolving; just let it play out.
      await page.waitForTimeout(60);
      continue;
    }

    const distance = Math.hypot(
      enemy.position.x - world.player.position.x,
      enemy.position.y - world.player.position.y,
    );

    if (distance <= TOUCH_DISTANCE_PX) {
      const away = Math.atan2(
        world.player.position.y - enemy.position.y,
        world.player.position.x - enemy.position.x,
      );
      const retreatKey =
        Math.abs(Math.cos(away)) > Math.abs(Math.sin(away))
          ? Math.cos(away) > 0
            ? "KeyD"
            : "KeyA"
          : Math.sin(away) > 0
            ? "KeyS"
            : "KeyW";
      await page.keyboard.down(retreatKey);
      await page.waitForTimeout(150);
      await page.keyboard.up(retreatKey);
      continue;
    }

    if (distance <= MELEE_REACH_PX) {
      await aimAt(page, enemy.position.x, enemy.position.y);
      await page.mouse.down({ button: "left" });
      await page.waitForTimeout(30);
      await page.mouse.up({ button: "left" });
      await page.waitForTimeout(60);
      continue;
    }

    // Out of reach: wait for the chaser to close the gap on its own rather
    // than walking toward it (walking risks overshooting into touch range).
    await page.waitForTimeout(100);
  }
}

/** Wait until `predicate(world)` is true, polling every `intervalMs`, up to `timeoutMs`. */
export async function waitForWorld(
  page: Page,
  predicate: (world: World) => boolean,
  timeoutMs = 5000,
  intervalMs = 100,
): Promise<World> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const world = await getWorld(page);
    if (predicate(world)) {
      return world;
    }
    if (Date.now() > deadline) {
      throw new Error(`waitForWorld: predicate never became true within ${String(timeoutMs)}ms`);
    }
    await page.waitForTimeout(intervalMs);
  }
}
