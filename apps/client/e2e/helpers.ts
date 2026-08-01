/**
 * Shared helpers for the browser end-to-end suite (`docs/TEST_PLAN.md`
 * §2.3). Every helper drives the page the way a human would (real keyboard/
 * mouse events into the canvas) and reads state back only through the
 * dev-only debug hook (`apps/client/src/debug/debug-hook.ts`) — no test here
 * reaches into client internals or asserts on DOM text (Phaser renders to
 * `<canvas>`, not real DOM nodes).
 *
 * From M4 the state read back is the **authoritative snapshot the server
 * sent**, not a locally simulated world — the client no longer has one. That
 * makes these assertions stronger than they were: they are assertions about
 * what the server decided.
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
import { ALL_SKILLS, testArena } from "@carry-or-fall/game-content";
import type { EnemyView, LocalPlayerState, MatchView, PlayerView } from "@carry-or-fall/protocol";

/** Matches `main.ts`'s Phaser game config (and so the arena's dimensions). */
export const GAME_WIDTH = testArena.width;
export const GAME_HEIGHT = testArena.height;

/** Matches `LoadoutScene.ts`'s `DEFAULT_SKILL_LOADOUT_IDS`. */
export const DEFAULT_SKILL_LOADOUT_IDS = ["ricochet", "extended_reach", "bulwark_strike"];

/**
 * How long to allow for joining a room and playing through the lobby countdown.
 *
 * The countdown itself is shortened to a second by `MATCH_LOBBY_MS` in
 * `playwright.config.ts`, so almost all of this budget is headroom for the parts
 * that genuinely vary: a cold runner compiling Phaser on first request, the
 * WebSocket handshake, and the first state patch arriving. A CI runner is slower
 * and more contended than any development machine, so it gets more — generously,
 * because the cost of a too-tight timeout is a false failure that looks exactly
 * like a real one, while the cost of a too-loose one is only that a genuine hang
 * takes longer to report (and `maxFailures` caps that anyway).
 */
export const MATCH_START_TIMEOUT_MS =
  process.env.CI !== undefined && process.env.CI !== "" ? 60_000 : 30_000;

/**
 * Bring `page` to the front before driving it.
 *
 * This matters only once a test opens a second browser context, and then it
 * matters a lot: Chromium throttles `requestAnimationFrame` in a background
 * tab, and Phaser's whole update loop — including input sampling — runs on RAF.
 * A backgrounded page therefore samples the keyboard a handful of times a
 * second instead of sixty, so a walk that takes three seconds in the foreground
 * does not finish at all. The player is not stuck; the page is asleep.
 *
 * Cheap and idempotent, so every input-driving helper calls it rather than
 * making each multi-context test remember to.
 */
async function focusPage(page: Page): Promise<void> {
  await page.bringToFront();
}

/** Hold `key` down for `holdMs`, then release — see the module doc for why this beats `press()`. */
export async function pressKey(page: Page, key: string, holdMs = 50): Promise<void> {
  await focusPage(page);
  await page.keyboard.down(key);
  await page.waitForTimeout(holdMs);
  await page.keyboard.up(key);
}

/**
 * Fail immediately, and legibly, if the page has no debug hook.
 *
 * Every read in this file goes through `window.__CARRY_OR_FALL_DEBUG__?.…`, and
 * optional chaining on an absent hook yields `undefined` — which is
 * indistinguishable from "the value is not ready yet". Without this check, a
 * client built without the hook does not fail; it makes every single test wait
 * out its timeout and report whatever it happened to be waiting for. Thirty
 * identical timeouts are a much worse bug report than one sentence naming the
 * cause.
 *
 * The hook is installed only when `import.meta.env.DEV` is true
 * (`apps/client/src/debug/debug-hook.ts`), which the client's Vite config
 * derives from the command rather than from `NODE_ENV`, so it is present under
 * `vite` (dev) and verifiably absent from a production build.
 */
async function assertDebugHookPresent(page: Page): Promise<void> {
  const present = await page.evaluate(() => window.__CARRY_OR_FALL_DEBUG__ !== undefined);
  if (!present) {
    throw new Error(
      "the dev-only debug hook (window.__CARRY_OR_FALL_DEBUG__) is not installed on this page. " +
        "The browser suite reads all state through it, so nothing can be observed without it. " +
        "It ships only when import.meta.env.DEV is true, so this usually means the suite is " +
        "pointed at a production build instead of the Vite dev server.",
    );
  }
}

export async function gotoGame(page: Page): Promise<void> {
  await page.goto("/");
  await assertDebugHookPresent(page);
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

export async function getConnectionStatus(page: Page): Promise<string> {
  return page.evaluate(() => window.__CARRY_OR_FALL_DEBUG__?.getConnectionStatus() ?? "unknown");
}

/** Reads the latest authoritative snapshot. Throws if none has arrived yet. */
export async function getSnapshot(page: Page): Promise<MatchView> {
  const snapshot = await page.evaluate(() => window.__CARRY_OR_FALL_DEBUG__?.getSnapshot() ?? null);
  if (snapshot === null) {
    throw new Error("expected an authoritative snapshot: getSnapshot() returned null");
  }
  return snapshot;
}

export async function getLocalPlayerId(page: Page): Promise<string> {
  const id = await page.evaluate(() => window.__CARRY_OR_FALL_DEBUG__?.getLocalPlayerId() ?? null);
  if (id === null) {
    throw new Error("expected a local player id: the client has not joined a room");
  }
  return id;
}

/** This client's own private state (inventory, secure slot, skills, run result). */
export async function getPrivateState(page: Page): Promise<LocalPlayerState> {
  const state = await page.evaluate(
    () => window.__CARRY_OR_FALL_DEBUG__?.getPrivateState() ?? null,
  );
  if (state === null) {
    throw new Error("expected private state: none has arrived yet");
  }
  return state;
}

/**
 * This client's own player, as the server currently sees them.
 *
 * The lookup happens **inside the page** and returns one player rather than
 * doing it here from a full {@link getSnapshot}. The walker polls this several
 * times a second, and shipping the whole match — every enemy, projectile, and
 * loot entity — across the debugging protocol each time made walking measurably
 * slower than the player actually moves. Slow enough, in the two-client tests,
 * that a chaser reached the player before the walk finished, and the test failed
 * for a reason that had nothing to do with what it was testing.
 */
export async function getLocalPlayer(page: Page): Promise<PlayerView> {
  const player = await page.evaluate(() => {
    const hook = window.__CARRY_OR_FALL_DEBUG__;
    const id = hook?.getLocalPlayerId() ?? null;
    if (id === null) {
      return null;
    }
    return hook?.getSnapshot()?.players.find((entry) => entry.id === id) ?? null;
  });
  if (player === null) {
    throw new Error("expected this client to have a player in the authoritative snapshot");
  }
  return player;
}

function digitKeyFor(skillId: string): string {
  const index = ALL_SKILLS.findIndex((skill) => skill.id === skillId);
  if (index === -1) {
    throw new Error(`unknown skill id: ${skillId}`);
  }
  return index === 9 ? "0" : String(index + 1);
}

/** Select exactly `skillIds` on `LoadoutScene`, starting from the default selection. */
export async function chooseLoadout(page: Page, skillIds: readonly string[]): Promise<void> {
  for (const id of DEFAULT_SKILL_LOADOUT_IDS) {
    await pressKey(page, digitKeyFor(id));
  }
  for (const id of skillIds) {
    await pressKey(page, digitKeyFor(id));
  }
}

/**
 * From `LoadoutScene`, select exactly `skillIds`, press Enter, and wait until
 * the match is actually running — which means waiting out the server's lobby
 * countdown, not just the scene transition. Assumes the page is already on
 * `LoadoutScene` (call {@link gotoGame} first).
 */
export async function startRunWithLoadout(page: Page, skillIds: readonly string[]): Promise<void> {
  await chooseLoadout(page, skillIds);
  await enterMatch(page);
}

/** Press Enter on `LoadoutScene` and wait for the match to reach the `running` phase. */
export async function enterMatch(page: Page): Promise<void> {
  await confirmLoadout(page);
  await waitForMatchRunning(page);
}

/**
 * Press Enter on `LoadoutScene` and wait only until the room join has happened.
 * Split out from {@link enterMatch} for the two-client case: the room locks when
 * the match starts (technical plan §8.3), so the second client has to get its
 * join in *during* the countdown — which it cannot do if the first client's
 * helper is still blocking until the match is running.
 */
export async function confirmLoadout(page: Page): Promise<void> {
  await pressKey(page, "Enter");
  await page.waitForFunction(() => window.__CARRY_OR_FALL_DEBUG__?.getActiveSceneKey() === "play");
}

/**
 * Wait out the server's lobby countdown. Pure observation, so it is safe to run
 * for several pages at once: snapshots arrive over the WebSocket rather than
 * through Phaser's (background-throttled) animation frame.
 */
export async function waitForMatchRunning(page: Page): Promise<void> {
  await page.waitForFunction(
    () => window.__CARRY_OR_FALL_DEBUG__?.getSnapshot()?.phase === "running",
    undefined,
    { timeout: MATCH_START_TIMEOUT_MS },
  );
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
  await focusPage(page);
  await page.keyboard.down(direction);
  await page.waitForTimeout(durationMs);
  await page.keyboard.up(direction);
}

/** Hold the left mouse button (melee attack, `input/pointer.ts`) for `durationMs`. */
export async function meleeAttackFor(page: Page, durationMs: number): Promise<void> {
  await focusPage(page);
  await page.mouse.down({ button: "left" });
  await page.waitForTimeout(durationMs);
  await page.mouse.up({ button: "left" });
}

/** Hold the right mouse button (ranged attack, `input/pointer.ts`) for `durationMs`. */
export async function rangedAttackFor(page: Page, durationMs: number): Promise<void> {
  await focusPage(page);
  await page.mouse.down({ button: "right" });
  await page.waitForTimeout(durationMs);
  await page.mouse.up({ button: "right" });
}

/** Hold `E` (interact — level-triggered, `input/keyboard.ts`) for `durationMs`. */
export async function interactFor(page: Page, durationMs: number): Promise<void> {
  await focusPage(page);
  await page.keyboard.down("KeyE");
  await page.waitForTimeout(durationMs);
  await page.keyboard.up("KeyE");
}

/**
 * Walk onto a ground entity at `(x, y)` and hold interact until `done()` says the
 * server took it, re-approaching between attempts.
 *
 * A single walk-then-press is not reliable, and the reason is worth stating: the
 * walker moves in 150 ms bursts, which at the player's speed is about 30 px of
 * travel, while the pickup range is the player's radius plus the item's — 36 px.
 * A final burst that overshoots the item can therefore end the walk *outside*
 * pickup range even though the walker believes it arrived. Re-approaching and
 * holding is also simply what a human does: you hold E until the thing is gone.
 */
export async function pickUpAt(
  page: Page,
  x: number,
  y: number,
  done: (snapshot: MatchView) => boolean,
  maxMs = 25_000,
): Promise<void> {
  await focusPage(page);
  const deadline = Date.now() + maxMs;
  for (let attempt = 0; Date.now() < deadline; attempt += 1) {
    if (attempt > 0) {
      await walkToward(page, x, y, 8000);
    }
    await page.keyboard.down("KeyE");
    try {
      const settled = Date.now() + 1500;
      while (Date.now() < settled) {
        if (done(await getSnapshot(page))) {
          return;
        }
        await page.waitForTimeout(100);
      }
    } finally {
      await page.keyboard.up("KeyE");
    }
  }
  throw new Error(
    `pickUpAt: nothing was picked up at (${String(x)}, ${String(y)}) within ${String(maxMs)}ms`,
  );
}

type MoveKey = "KeyA" | "KeyD" | "KeyW" | "KeyS";

/**
 * Walk the player toward `targetX`/`targetY`, polling the authoritative
 * position rather than assuming travel time (the chasers are closing distance
 * at the same time, and walls can block a leg of the route).
 *
 * Wall routing is **derived from behavior, not from hardcoded coordinates**:
 * the walker moves greedily toward the target, and if it stops making
 * progress it assumes a wall is in the way and sidesteps perpendicular for a
 * moment before resuming.
 */
export async function walkToward(
  page: Page,
  targetX: number,
  targetY: number,
  maxMs = 20_000,
): Promise<void> {
  await focusPage(page);
  const deadline = Date.now() + maxMs;
  let previousDistance = Number.POSITIVE_INFINITY;
  let stalledPolls = 0;
  let sidestep: MoveKey | null = null;
  let sidestepPollsLeft = 0;
  /**
   * Detours are for getting around geometry, and this arena has three interior
   * walls. A walk that has tried this many and still not arrived is not being
   * blocked by a wall, so further detours only take it further away — from here
   * on it pushes straight at the target and lets the timeout report honestly.
   */
  let sidestepsRemaining = 6;
  // Flipped on each new stall, so if the first way around an obstacle is
  // itself blocked the walker tries the other way instead of retrying the
  // same failing detour forever.
  let sidestepSign = 1;

  for (;;) {
    const { x, y, alive } = await getLocalPlayer(page);
    const dx = targetX - x;
    const dy = targetY - y;
    const distance = Math.hypot(dx, dy);
    if (distance < 24) {
      return;
    }
    // A dead player does not move, so without this the walk would spin to its
    // timeout and report "did not arrive" — true, but useless for diagnosis.
    // Say what actually happened.
    if (!alive) {
      throw new Error(
        `walkToward: the player died en route to (${String(targetX)}, ${String(targetY)})`,
      );
    }
    if (Date.now() > deadline) {
      throw new Error(
        `walkToward: did not reach (${String(targetX)}, ${String(targetY)}) within ${String(maxMs)}ms`,
      );
    }

    // "Made no real progress since the last poll" means something is in the
    // way — the walker is pressed against a wall it needs to go around.
    //
    // The threshold is deliberately near zero rather than a fraction of an
    // expected step. A poll covers about 30 px when everything is fast, but
    // under load — several browser pages and several live matches on one dev
    // server — a poll can legitimately cover only a few pixels. Treating
    // *slow* as *blocked* made the walker sidestep away from a target nothing
    // was blocking, and it then oscillated until its timeout: alive, moving,
    // and never arriving.
    if (distance > previousDistance - 1) {
      stalledPolls += 1;
    } else {
      stalledPolls = 0;
    }
    previousDistance = distance;

    if (stalledPolls >= 4 && sidestepPollsLeft <= 0 && sidestepsRemaining > 0) {
      sidestepsRemaining -= 1;
      // Detour *perpendicular* to the direction of travel: pushing further
      // along the blocked axis just presses harder into the wall.
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
 * A column with no wall anywhere along the arena's height, between the player
 * spawn columns and the central divider. Walking straight down from a spawn
 * runs into the near-side cover wall (`x ∈ [300, 600], y ∈ [300, 320]`), and
 * while the stall-and-sidestep detour below can eventually get around it, a
 * two-leg route through a column that is clear by construction is faster and
 * deterministic. Used by every helper that needs to reach the open lane.
 */
const CLEAR_COLUMN_X = 700;

/**
 * The vertical band the arena's interior walls occupy, derived from the walls
 * themselves rather than hardcoded, so a change to the map moves these with it.
 * An interior wall is one that does not run to the arena edge — i.e. not a
 * border.
 */
const INTERIOR_WALLS = testArena.walls.filter(
  (wall) => wall.x > 0 && wall.x + wall.width < testArena.width,
);
const INTERIOR_TOP_Y = Math.min(...INTERIOR_WALLS.map((wall) => wall.y));
const INTERIOR_BOTTOM_Y = Math.max(...INTERIOR_WALLS.map((wall) => wall.y + wall.height));

/** Clearance kept from a wall band, comfortably more than the player's radius. */
const WALL_CLEARANCE_PX = 40;

/** The upper wall-free band: above every interior wall, so it runs the arena's full width. */
const UPPER_LANE_Y = 200;

/** Whether a straight line between two heights stays entirely clear of the interior walls. */
function sharesOpenBand(fromY: number, toY: number): boolean {
  const above = Math.max(fromY, toY) + WALL_CLEARANCE_PX < INTERIOR_TOP_Y;
  const below = Math.min(fromY, toY) - WALL_CLEARANCE_PX > INTERIOR_BOTTOM_Y;
  return above || below;
}

/** Walk to the lower open lane (the arena's wall-free band) via {@link CLEAR_COLUMN_X}. */
export async function walkToOpenLane(page: Page, maxMs = 30_000): Promise<void> {
  const start = await getLocalPlayer(page);
  await walkToward(page, CLEAR_COLUMN_X, start.y, maxMs);
  await walkToward(page, CLEAR_COLUMN_X, testArena.openLaneY, maxMs);
}

/**
 * Walk to an arbitrary arena position along a route that is wall-free by
 * construction, rather than trusting {@link walkToward}'s stall-and-sidestep
 * detour to find its own way around the interior walls.
 *
 * The route is always: into the clear column, along it to whichever open lane
 * is nearer the target, along that lane to the target's column, then the final
 * short leg. Since both lanes span the arena's full width and the column spans
 * its full height, no leg can be blocked — which matters because the server is
 * authoritative now and a walker that gets stuck fails a test for a reason that
 * has nothing to do with the rule under test.
 */
export async function walkToArenaPoint(
  page: Page,
  targetX: number,
  targetY: number,
  maxMs = 30_000,
): Promise<void> {
  const start = await getLocalPlayer(page);

  // Already sharing an open band with the target: go straight there. Taking the
  // scenic route anyway is not merely slower — it walks *toward* the chasers'
  // half before doubling back, which has cost tests their subject before they
  // reached it.
  if (sharesOpenBand(start.y, targetY)) {
    await walkToward(page, targetX, targetY, maxMs);
    return;
  }

  const lane = targetY < testArena.height / 2 ? UPPER_LANE_Y : testArena.openLaneY;
  await walkToward(page, CLEAR_COLUMN_X, start.y, maxMs);
  await walkToward(page, CLEAR_COLUMN_X, lane, maxMs);
  await walkToward(page, targetX, lane, maxMs);
  await walkToward(page, targetX, targetY, maxMs);
}

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
 * Walk to {@link MEET_CHASERS_SPOT} in three straight legs — east into the clear
 * column, down it to the open lane, then east along the lane. Every leg is free
 * of walls by construction, so this never depends on the stall-and-sidestep
 * detour logic and stays deterministic.
 */
export async function meetChasers(page: Page): Promise<void> {
  await walkToOpenLane(page, 30_000);
  await walkToward(page, MEET_CHASERS_SPOT.x, MEET_CHASERS_SPOT.y, 30_000);
}

/** Let the chasers kill the player, and return their final authoritative state. */
export async function dieToChasers(page: Page, maxMs = 60_000): Promise<PlayerView> {
  await meetChasers(page);

  const deadline = Date.now() + maxMs;
  for (;;) {
    const player = await getLocalPlayer(page);
    if (!player.alive) {
      return player;
    }
    if (Date.now() > deadline) {
      throw new Error(
        `dieToChasers: player still alive after ${String(maxMs)}ms (hp ${String(player.health)})`,
      );
    }
    await page.waitForTimeout(200);
  }
}

/** The enemy closest to `player` right now, or `null` if none are left alive. */
export function nearestEnemy(snapshot: MatchView, player: PlayerView): EnemyView | null {
  let nearest: EnemyView | null = null;
  let nearestDistance = Number.POSITIVE_INFINITY;
  for (const enemy of snapshot.enemies) {
    const distance = Math.hypot(enemy.x - player.x, enemy.y - player.y);
    if (distance < nearestDistance) {
      nearest = enemy;
      nearestDistance = distance;
    }
  }
  return nearest;
}

/**
 * Repeatedly aim at the **nearest** live enemy and throw a melee swing until
 * `predicate(snapshot)` is true, without ever voluntarily walking the player
 * into contact-damage range: the state machine only swings while the live
 * distance is inside melee reach but outside touch distance, retreats a step
 * if that enemy closes past touch distance, and otherwise waits for the
 * chasers' own behavior to bring one into range — real behavior, not a
 * scripted approach.
 */
export async function attackChaserUntil(
  page: Page,
  predicate: (snapshot: MatchView) => boolean,
  maxMs = 40_000,
): Promise<MatchView> {
  const deadline = Date.now() + maxMs;
  for (;;) {
    const snapshot = await getSnapshot(page);
    if (predicate(snapshot)) {
      return snapshot;
    }
    if (Date.now() > deadline) {
      throw new Error(`attackChaserUntil: predicate never became true within ${String(maxMs)}ms`);
    }
    const player = await getLocalPlayer(page);
    if (!player.alive) {
      throw new Error("attackChaserUntil: player died before predicate became true");
    }
    const enemy = nearestEnemy(snapshot, player);
    if (enemy === null) {
      await page.waitForTimeout(100);
      continue;
    }

    if (player.swingActive) {
      // A swing is already resolving; just let it play out.
      await page.waitForTimeout(60);
      continue;
    }

    const distance = Math.hypot(enemy.x - player.x, enemy.y - player.y);

    if (distance <= TOUCH_DISTANCE_PX) {
      const away = Math.atan2(player.y - enemy.y, player.x - enemy.x);
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
      await aimAt(page, enemy.x, enemy.y);
      await page.mouse.down({ button: "left" });
      await page.waitForTimeout(80);
      await page.mouse.up({ button: "left" });
      await page.waitForTimeout(60);
      continue;
    }

    // Out of reach: wait for the chaser to close the gap on its own rather
    // than walking toward it (walking risks overshooting into touch range).
    await page.waitForTimeout(100);
  }
}

/** Wait until `predicate(snapshot)` is true, polling every `intervalMs`, up to `timeoutMs`. */
export async function waitForSnapshot(
  page: Page,
  predicate: (snapshot: MatchView) => boolean,
  timeoutMs = 10_000,
  intervalMs = 100,
): Promise<MatchView> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const snapshot = await getSnapshot(page);
    if (predicate(snapshot)) {
      return snapshot;
    }
    if (Date.now() > deadline) {
      throw new Error(`waitForSnapshot: predicate never became true within ${String(timeoutMs)}ms`);
    }
    await page.waitForTimeout(intervalMs);
  }
}
