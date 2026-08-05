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
 * ## Timing rule: wait for the thing, never for a duration that implies it
 *
 * Everything this file drives is sampled by Phaser inside a
 * `requestAnimationFrame` loop, and everything it observes is decided by a
 * server stepping at a fixed 50 ms. Neither clock is the test runner's. So a
 * helper that holds a key for 80 ms, or expects a walk to cover 30 px per poll,
 * is really asserting how fast the *machine* is — which is fine until CI, where
 * it stops being true and the failure looks like a game defect.
 *
 * Three helpers below apply the rule, each recording the measurement that
 * motivated it:
 *
 * - {@link pressKey} and {@link interactFor} hold until the page has actually
 *   rendered frames, rather than for a duration chosen because it worked here.
 * - {@link fireAndObserve} holds the attack button until the server publishes
 *   the shot, rather than clicking for 80 ms and hoping a frame caught it.
 * - {@link walkToward} releases each key hold when the authoritative player
 *   has covered the intended distance, so host scheduling cannot stretch a
 *   nominal duration into an overshoot.
 */
import type { Page } from "@playwright/test";
import { ALL_SKILLS, testArena } from "@carry-or-fall/game-content";
import type {
  BossView,
  EnemyView,
  LocalPlayerState,
  MatchView,
  PartyView,
  PlayerView,
} from "@carry-or-fall/protocol";
import { PLAYER_SPEED } from "@carry-or-fall/simulation-core";

/** Matches `main.ts`'s Phaser game config (and so the arena's dimensions). */
export const GAME_WIDTH = testArena.width;
export const GAME_HEIGHT = testArena.height;

/** Matches `LoadoutScene.ts`'s `DEFAULT_SKILL_LOADOUT_IDS`. */
export const DEFAULT_SKILL_LOADOUT_IDS = ["ricochet", "extended_reach", "bulwark_strike"];

/**
 * How long to allow for joining a room and playing through the lobby countdown.
 *
 * The countdown itself is shortened to five seconds by `MATCH_LOBBY_MS` in
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
 * Report how much of a wall-clock budget a helper actually used, when
 * `E2E_MARGIN` is set. Silent otherwise.
 *
 * These budgets are the suite's timeouts, and a timeout that is routinely 90%
 * consumed is a failure waiting for a slower machine. Printing used-against-
 * budget turns "this test feels tight" into a number, and makes re-auditing the
 * suite one command rather than a research project — which matters most when
 * something changes the arena's danger, as adding a boss (M7) will.
 *
 * Run: `E2E_MARGIN=1 pnpm test:e2e`, then read the `BUDGET` lines.
 *
 * **Exported, because a helper is not the only thing that spends a budget.** A
 * spec that waits inline — `boss.spec.ts` stands a player inside the Warden's
 * aggro radius while it watches the boss leave its lair — spends one too, and a
 * window the audit cannot see is a window the audit cannot certify. That is
 * exactly how the M7 audit came to report a 72% floor for a suite containing a
 * wait it had never measured (`docs/TEST_PLAN.md` §2.3.0).
 */
export function reportMargin(label: string, startedAt: number, budgetMs: number): void {
  if (process.env.E2E_MARGIN === undefined) {
    return;
  }
  const used = Date.now() - startedAt;
  console.log(
    `BUDGET ${label} used=${String(used)} budget=${String(budgetMs)} ` +
      `margin=${String(Math.round((100 * (budgetMs - used)) / budgetMs))}%`,
  );
}

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

/** Wait for a named Phaser scene and expose the join/transition budget to the margin audit. */
export async function waitForActiveScene(
  page: Page,
  sceneKey: "loadout" | "play",
  timeoutMs = MATCH_START_TIMEOUT_MS,
): Promise<void> {
  const budgetStart = Date.now();
  const handle = await page.waitForFunction(
    (expected) => window.__CARRY_OR_FALL_DEBUG__?.getActiveSceneKey() === expected,
    sceneKey,
    { polling: 25, timeout: timeoutMs },
  );
  await handle.dispose();
  reportMargin(`activeScene:${sceneKey}`, budgetStart, timeoutMs);
}

/** Wait for an exact party size without copying party state through CDP per poll. */
export async function waitForPartySize(
  page: Page,
  memberCount: number,
  timeoutMs = MATCH_START_TIMEOUT_MS,
): Promise<void> {
  const budgetStart = Date.now();
  const handle = await page.waitForFunction(
    (expected) => (window.__CARRY_OR_FALL_DEBUG__?.getParty()?.members.length ?? 0) === expected,
    memberCount,
    { polling: 25, timeout: timeoutMs },
  );
  await handle.dispose();
  reportMargin("partySize", budgetStart, timeoutMs);
}

/** Wait for teammate markers delivered over the party message channel. */
export async function waitForPartyMemberMarkers(
  page: Page,
  markerCount: number,
  timeoutMs = MATCH_START_TIMEOUT_MS,
): Promise<void> {
  const budgetStart = Date.now();
  const handle = await page.waitForFunction(
    (expected) => (window.__CARRY_OR_FALL_DEBUG__?.getPartyMemberIds().length ?? 0) === expected,
    markerCount,
    { polling: 25, timeout: timeoutMs },
  );
  await handle.dispose();
  reportMargin("partyMemberMarkers", budgetStart, timeoutMs);
}

/**
 * Block until `page` has actually rendered `frames` animation frames.
 *
 * Phaser reads input inside its update loop, which runs on `requestAnimationFrame`.
 * "Hold the key for 50 ms" is therefore a bet that the page renders faster than
 * 20 fps — comfortably true on an idle machine and not something a loaded CI
 * runner with several 1920x1080 canvases guarantees. Waiting for the frames
 * themselves states the requirement instead of betting on it: however slowly the
 * page is rendering, the key was down while it sampled.
 *
 * Bounded, so a page that stops rendering entirely fails its caller's own
 * assertion rather than hanging here.
 */
async function awaitFrames(page: Page, frames = 2, timeoutMs = 3_000): Promise<void> {
  await page.evaluate(
    ([count, limit]) =>
      new Promise<void>((resolve) => {
        const deadline = performance.now() + limit;
        let seen = 0;
        const tick = (): void => {
          seen += 1;
          if (seen >= count || performance.now() >= deadline) {
            resolve();
            return;
          }
          requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
        setTimeout(resolve, limit);
      }),
    [frames, timeoutMs] as const,
  );
}

/**
 * Hold `key` down for at least `holdMs` **and** at least two rendered frames,
 * then release.
 *
 * `LoadoutScene`'s digit and Enter keys are read with Phaser's edge-triggered
 * `JustDown` once per frame, and a keydown+keyup that both land between two
 * frames is never observed — the press simply vanishes. That was originally
 * fixed by holding for 50 ms, measured to be reliable across 20+ consecutive
 * runs *on a development machine*; it is a frame-rate assumption wearing a
 * duration's clothes. {@link awaitFrames} makes the requirement literal, so the
 * press survives a page rendering at 5 fps as readily as one at 60.
 *
 * A real human keypress is never zero-duration either, so this remains a
 * faithful simulation rather than a workaround for a client defect.
 */
export async function pressKey(page: Page, key: string, holdMs = 50): Promise<void> {
  await focusPage(page);
  await page.keyboard.down(key);
  await page.waitForTimeout(holdMs);
  await awaitFrames(page);
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
  await waitForActiveScene(page, "loadout");
}

/** This page's party, or `null` when it is not in one (M6). */
export async function getParty(page: Page): Promise<PartyView | null> {
  return page.evaluate(() => window.__CARRY_OR_FALL_DEBUG__?.getParty() ?? null);
}

/** This page's party members inside the current match (M6). */
export async function getPartyMemberIds(page: Page): Promise<readonly string[]> {
  return page.evaluate(() => window.__CARRY_OR_FALL_DEBUG__?.getPartyMemberIds() ?? []);
}

/**
 * Create a party on `page` and return its join code, read from the page's own
 * state rather than from the canvas.
 */
export async function createParty(page: Page): Promise<string> {
  await pressKey(page, "KeyP");
  const budgetStart = Date.now();
  const handle = await page.waitForFunction(
    () => (window.__CARRY_OR_FALL_DEBUG__?.getParty()?.joinCode.length ?? 0) > 0,
    undefined,
    { polling: 25, timeout: MATCH_START_TIMEOUT_MS },
  );
  await handle.dispose();
  reportMargin("partyCreated", budgetStart, MATCH_START_TIMEOUT_MS);
  return (await getParty(page))!.joinCode;
}

/** Join an existing party on `page` by typing its code, exactly as a human would. */
export async function joinPartyByCode(page: Page, joinCode: string): Promise<void> {
  await pressKey(page, "KeyJ");
  await focusPage(page);
  // Real typing: one keydown per character, which is what the scene's text
  // entry reads. `type` with a delay keeps each press long enough to land on a
  // frame, for the same reason `pressKey` holds its key (see the module doc).
  await page.keyboard.type(joinCode, { delay: 40 });
  await pressKey(page, "Enter");
  const budgetStart = Date.now();
  const handle = await page.waitForFunction(
    () => (window.__CARRY_OR_FALL_DEBUG__?.getParty()?.members.length ?? 0) > 0,
    undefined,
    { polling: 25, timeout: MATCH_START_TIMEOUT_MS },
  );
  await handle.dispose();
  reportMargin("partyJoined", budgetStart, MATCH_START_TIMEOUT_MS);
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

/** Conditions used by multiplayer waits that can be evaluated inside the page. */
export type MatchStateCondition =
  | { readonly kind: "ground_loot_missing"; readonly id: string }
  | { readonly kind: "player_run_over"; readonly id: string }
  | { readonly kind: "player_x_below"; readonly id: string; readonly x: number };

/**
 * Wait on the browser's latest authoritative snapshot without copying that
 * snapshot through CDP on every poll. Only the final matching state crosses
 * the process boundary.
 */
export async function waitForMatchState(
  page: Page,
  condition: MatchStateCondition,
  timeoutMs = 10_000,
): Promise<MatchView> {
  const budgetStart = Date.now();
  const handle = await page.waitForFunction(
    (wanted) => {
      const view = window.__CARRY_OR_FALL_DEBUG__?.getSnapshot();
      if (view == null) return false;
      switch (wanted.kind) {
        case "ground_loot_missing":
          return view.groundLoot.every((loot) => loot.id !== wanted.id);
        case "player_run_over":
          return view.players.some((player) => player.id === wanted.id && player.runOver);
        case "player_x_below":
          return view.players.some((player) => player.id === wanted.id && player.x < wanted.x);
      }
    },
    condition,
    { polling: 25, timeout: timeoutMs },
  );
  await handle.dispose();
  reportMargin(`waitForMatchState:${condition.kind}`, budgetStart, timeoutMs);
  return getSnapshot(page);
}

/** Wait for this client's private run result without transferring private state per poll. */
export async function waitForRunResult(page: Page, timeoutMs = 15_000): Promise<LocalPlayerState> {
  const budgetStart = Date.now();
  const handle = await page.waitForFunction(
    () => window.__CARRY_OR_FALL_DEBUG__?.getPrivateState()?.runResult != null,
    undefined,
    { polling: 25, timeout: timeoutMs },
  );
  await handle.dispose();
  reportMargin("waitForRunResult", budgetStart, timeoutMs);
  return getPrivateState(page);
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

/**
 * The boss as the server currently sees it, or `null` in an arena without one.
 *
 * Read **inside the page** and returned alone, for the reason
 * {@link getLocalPlayer} records: a full {@link getSnapshot} ships every enemy,
 * projectile, and loot entity across the debugging protocol, and a poll that
 * pays that price several times a second is slow enough to matter. It matters
 * more here than anywhere else in the file, because the only caller polls this
 * while its player is **standing inside the boss's aggro radius** — where the
 * Warden deals a measured 16-22 health per second (`docs/TEST_PLAN.md`
 * §2.3.0c). Every millisecond of poll latency there is paid in health.
 */
export async function getBoss(page: Page): Promise<BossView | null> {
  return page.evaluate(() => window.__CARRY_OR_FALL_DEBUG__?.getSnapshot()?.boss ?? null);
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
  await waitForActiveScene(page, "play");
}

/**
 * Wait out the server's lobby countdown. Pure observation, so it is safe to run
 * for several pages at once: snapshots arrive over the WebSocket rather than
 * through Phaser's (background-throttled) animation frame.
 */
export async function waitForMatchRunning(page: Page): Promise<void> {
  const budgetStart = Date.now();
  const handle = await page.waitForFunction(
    () => window.__CARRY_OR_FALL_DEBUG__?.getSnapshot()?.phase === "running",
    undefined,
    { polling: 25, timeout: MATCH_START_TIMEOUT_MS },
  );
  await handle.dispose();
  reportMargin("matchRunning", budgetStart, MATCH_START_TIMEOUT_MS);
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

/**
 * Fire the bow and return the snapshot in which the shot appears.
 *
 * **Held until the server publishes the projectile, not for a fixed span.**
 * `PointerInput` is read once per animation frame, so a fixed 80 ms press
 * assumes the page is rendering at better than 12 fps — true on an idle
 * machine, and not true on a loaded CI runner with several Phaser canvases
 * alive. When that assumption broke the press fell between two frames, no shot
 * was fired at all, and the wait that followed timed out looking for a
 * projectile that was never created. Holding until the shot is *observed* has
 * no frame-rate assumption in it.
 *
 * The button is released the moment one projectile exists, which is why this
 * cannot fire twice: `basic_bow`'s attack interval is 650 ms against a 25 ms
 * poll, so the second shot is 26 polls away. Callers that assert a projectile
 * count depend on that.
 *
 * This is the same shape as the melee `swingAndWait` helper the skills spec
 * already used for the same reason — a 120 ms swing window is not something a
 * fixed-duration click can be relied on to land inside.
 */
export async function fireAndObserve(page: Page, timeoutMs = 15_000): Promise<MatchView> {
  await focusPage(page);
  await page.mouse.down({ button: "right" });
  try {
    return await waitForSnapshot(page, (view) => view.projectiles.length > 0, timeoutMs, 25);
  } finally {
    await page.mouse.up({ button: "right" });
  }
}

/**
 * Hold `E` (interact — level-triggered, `input/keyboard.ts`) for at least
 * `durationMs` and at least two rendered frames.
 *
 * The frame guarantee matters most where this is used to establish a
 * **negative** — "B pressed interact and got nothing". If the hold fell between
 * two frames the client would never have sampled the key, and the test would
 * pass because the button was never really pressed: a false pass, which is
 * worse than a flake because nothing ever reports it.
 */
export async function interactFor(page: Page, durationMs: number): Promise<void> {
  await focusPage(page);
  await page.keyboard.down("KeyE");
  await page.waitForTimeout(durationMs);
  await awaitFrames(page);
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
export interface PickupEntity {
  readonly kind: "ground_loot" | "skill_chip";
  readonly id: string;
}

export async function pickUpAt(
  page: Page,
  x: number,
  y: number,
  entity: PickupEntity,
  maxMs = 25_000,
): Promise<void> {
  await focusPage(page);
  const budgetStart = Date.now();
  const deadline = Date.now() + maxMs;
  for (let attempt = 0; Date.now() < deadline; attempt += 1) {
    if (attempt > 0) {
      await walkToward(page, x, y, 8000);
    }
    await page.keyboard.down("KeyE");
    try {
      const attemptEndsAt = Date.now() + 1500;
      const result = await page.waitForFunction(
        ({ target, deadline }) => {
          const view = window.__CARRY_OR_FALL_DEBUG__?.getSnapshot();
          if (view == null) return false;
          const entities = target.kind === "ground_loot" ? view.groundLoot : view.skillChips;
          if (entities.every((candidate) => candidate.id !== target.id)) return "picked_up";
          return Date.now() >= deadline ? "retry" : false;
        },
        { target: entity, deadline: attemptEndsAt },
        { polling: 25, timeout: 2500 },
      );
      const outcome = await result.jsonValue();
      await result.dispose();
      if (outcome === "picked_up") {
        reportMargin("pickUpAt", budgetStart, maxMs);
        return;
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

/** Ignore sub-step axis error once the other axis still needs meaningful travel. */
const AXIS_DEADZONE_PX = 10;

/**
 * Pick one cardinal direction for the next ordinary hold.
 *
 * WASD can express only cardinal and 45-degree movement. Pressing both axes for
 * every non-cardinal target silently steers at 45 degrees even when the target
 * is not on that line, so the shorter axis overshoots and oscillates. Advancing
 * the dominant remaining axis produces bounded Manhattan legs and makes the
 * hold's distance calculation describe the direction actually sent.
 */
export function movementKeyToward(dx: number, dy: number): MoveKey | null {
  if (Math.abs(dx) >= Math.abs(dy) && Math.abs(dx) > AXIS_DEADZONE_PX) {
    return dx > 0 ? "KeyD" : "KeyA";
  }
  if (Math.abs(dy) > AXIS_DEADZONE_PX) {
    return dy > 0 ? "KeyS" : "KeyW";
  }
  if (Math.abs(dx) > AXIS_DEADZONE_PX) {
    return dx > 0 ? "KeyD" : "KeyA";
  }
  return null;
}

/** How close to the target counts as arrived. */
const ARRIVAL_PX = 24;

/**
 * The longest a single key hold may last, in milliseconds — about 200 px of
 * travel at {@link PLAYER_SPEED}.
 *
 * It is capped at all because a hold is time the walker is not looking: a leg
 * that turns out to be blocked wastes the remainder of it. Legs are wall-free
 * by construction (see {@link walkToArenaPoint}), so this is generous.
 */
const MAX_HOLD_MS = 900;

/** The shortest useful hold: several server ticks, so progress is measurable. */
const MIN_HOLD_MS = 60;

/** A detour is a guess, so it is re-checked often. */
const SIDESTEP_HOLD_MS = 200;

/**
 * Fraction of the distance a hold *should* have covered, below which the
 * walker concludes a wall is in the way. See {@link walkToward}.
 */
const STALL_PROGRESS_FRACTION = 0.25;

/**
 * The shortest hold whose outcome is allowed to diagnose a wall, in pixels of
 * expected travel.
 *
 * A hold shortens as the target nears, and the last few are tiny. Those cannot
 * tell "blocked" from "arrived a little past the mark": releasing a key does not
 * stop the player instantly — the neutral input has to reach the server — so a
 * short hold routinely overshoots and the distance *grows*. Reading that as a
 * wall sends the walker on a detour away from a target nothing was blocking.
 * A real wall stops a long hold too, so only long holds get a vote.
 */
const STALL_MIN_EXPECTED_PX = 40;

/**
 * Hold movement until the server-published player has covered the requested
 * distance, or a bounded observation window proves that a wall stopped it.
 * Polling happens in Chromium; Playwright sends one wait command rather than
 * transferring a player or match object across CDP on every sample.
 */
async function holdMovementForAuthoritativeDistance(
  page: Page,
  keys: readonly MoveKey[],
  startX: number,
  startY: number,
  expectedDistancePx: number,
  nominalHoldMs: number,
): Promise<void> {
  for (const key of keys) {
    await page.keyboard.down(key);
  }
  try {
    const observationMs = Math.max(1000, nominalHoldMs * 2);
    const handle = await page.waitForFunction(
      ({ x, y, distance, deadline }) => {
        const hook = window.__CARRY_OR_FALL_DEBUG__;
        const id = hook?.getLocalPlayerId() ?? null;
        const player =
          id === null
            ? null
            : (hook?.getSnapshot()?.players.find((entry) => entry.id === id) ?? null);
        if (player === null) return false;
        return (
          !player.alive ||
          Math.hypot(player.x - x, player.y - y) >= distance ||
          Date.now() >= deadline
        );
      },
      {
        x: startX,
        y: startY,
        distance: Math.max(4, expectedDistancePx * 0.9),
        deadline: Date.now() + observationMs,
      },
      { polling: 25, timeout: observationMs + 5000 },
    );
    await handle.dispose();
  } finally {
    for (const key of keys) {
      await page.keyboard.up(key);
    }
  }
}

/**
 * Walk the player toward `targetX`/`targetY`, polling the authoritative
 * position rather than assuming travel time (walls can block a leg of the
 * route, and the chasers are closing distance at the same time).
 *
 * ## Why each hold is sized to the distance left
 *
 * The server stores each client's latest input and **re-applies it every tick
 * until a newer one arrives** (technical plan §9.3), so while a key is held the
 * player travels at the full `PLAYER_SPEED` no matter how busy the client is.
 * Holding is therefore *server* time; everything around it — the position read
 * and key events — is machine time. A host-side sleep is not safe, however:
 * when the runner is descheduled, key-up is late and the server correctly keeps
 * applying the old input. The resulting overshoot is machine-dependent.
 *
 * The previous walker held for a fixed 150 ms and then released, whatever the
 * distance. Measured on an unloaded machine, one iteration took ~570 ms of which
 * 150 ms was held: a **25% duty cycle**, an effective 55 px/s against the
 * server's 220, and a 221 px walk that should take 1.0 s taking 2.4 s. The ratio
 * is the problem, not the constant — on a loaded CI runner the machine-time part
 * grows while the chasers keep moving at 90 px/s, so the same walk took long
 * enough for one to cross the map and kill the walker. That is not a budget that
 * needed raising; it is a walker whose speed was set by the machine instead of
 * by the game.
 *
 * Sizing each hold to the distance remaining (capped by {@link MAX_HOLD_MS})
 * keeps the number of iterations a function of the route rather than runner
 * speed. The release condition is the authoritative distance actually covered,
 * evaluated in the page, rather than the host's nominal hold duration.
 *
 * ## Why stalling is now measured against the hold, not against the clock
 *
 * "Made no progress" used to mean "moved less than a pixel since the last poll",
 * counted four times over. That conflated *slow* with *blocked*: under load a
 * poll legitimately covered almost nothing, the walker read a wall that was not
 * there, and sidestepped away from an unobstructed target. Now the walker knows
 * exactly how far a hold should have moved it — `PLAYER_SPEED × holdMs` is
 * server truth — and treats covering less than a quarter of that as blocked.
 * One observation is enough, and it means the same thing on any machine.
 */
export async function walkToward(
  page: Page,
  targetX: number,
  targetY: number,
  maxMs = 20_000,
): Promise<void> {
  await focusPage(page);
  const budgetStart = Date.now();
  const deadline = Date.now() + maxMs;

  let previousDistance: number | null = null;
  let expectedProgressPx = 0;
  let sidestep: MoveKey | null = null;
  let sidestepHoldsLeft = 0;
  /** Whether the hold just completed was a detour rather than travel. */
  let wasSidestepping = false;
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
    if (distance < ARRIVAL_PX) {
      reportMargin("walkToward", budgetStart, maxMs);
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

    // Blocked, judged against how far the *server* should have carried us
    // during the previous hold rather than against how much wall time passed.
    //
    // Two holds are excluded from the judgement, and both exclusions are load
    // bearing. A hold too short to have covered {@link STALL_MIN_EXPECTED_PX}
    // cannot distinguish a wall from ordinary overshoot near the target. And a
    // hold spent *sidestepping* moves perpendicular to the target on purpose,
    // so it usually increases the distance — treating that as evidence of a
    // wall makes each detour manufacture the justification for the next one,
    // which is exactly how a 221 px walk turned into a 23 s wander.
    const progressPx =
      previousDistance === null ? Number.POSITIVE_INFINITY : previousDistance - distance;
    const measurable = previousDistance !== null && expectedProgressPx >= STALL_MIN_EXPECTED_PX;
    const blocked =
      measurable && !wasSidestepping && progressPx < expectedProgressPx * STALL_PROGRESS_FRACTION;
    previousDistance = distance;

    if (blocked && sidestepHoldsLeft <= 0 && sidestepsRemaining > 0) {
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
      sidestepHoldsLeft = 4;
    }

    const keys: MoveKey[] = [];
    let holdMs: number;
    if (sidestepHoldsLeft > 0 && sidestep !== null) {
      keys.push(sidestep);
      // Keep pushing along the blocked axis too, so the moment the detour
      // clears the obstacle the walker immediately resumes progress.
      if (sidestep === "KeyW" || sidestep === "KeyS") {
        if (Math.abs(dx) > 10) keys.push(dx > 0 ? "KeyD" : "KeyA");
      } else if (Math.abs(dy) > 10) {
        keys.push(dy > 0 ? "KeyS" : "KeyW");
      }
      sidestepHoldsLeft -= 1;
      wasSidestepping = true;
      // Short, because a detour is a guess and the walker wants to re-check
      // whether it has cleared the obstacle.
      holdMs = SIDESTEP_HOLD_MS;
    } else {
      wasSidestepping = false;
      const movementKey = movementKeyToward(dx, dy);
      if (movementKey !== null) keys.push(movementKey);
      const axisDistance =
        movementKey === "KeyA" || movementKey === "KeyD" ? Math.abs(dx) : Math.abs(dy);
      // Sized to stop just short of the target rather than sail past it. The
      // keys are released before the next poll, so travel per iteration is
      // exactly this hold — the poll's own latency moves the player not at all,
      // which is what keeps a slow machine from overshooting and oscillating.
      // Aimed at the *inside* of the arrival circle rather than its edge, so
      // the overshoot that releasing a key always costs lands the player inside
      // it instead of just past it.
      holdMs = Math.min(
        MAX_HOLD_MS,
        Math.max(MIN_HOLD_MS, ((axisDistance - ARRIVAL_PX) / PLAYER_SPEED) * 1000),
      );
    }
    expectedProgressPx = (PLAYER_SPEED * holdMs) / 1000;

    await holdMovementForAuthoritativeDistance(page, keys, x, y, expectedProgressPx, holdMs);
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
  const budgetStart = Date.now();
  await meetChasers(page);

  const deadline = Date.now() + maxMs;
  for (;;) {
    const player = await getLocalPlayer(page);
    if (!player.alive) {
      reportMargin("dieToChasers", budgetStart, maxMs);
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
  const budgetStart = Date.now();
  const deadline = Date.now() + maxMs;
  for (;;) {
    const snapshot = await getSnapshot(page);
    if (predicate(snapshot)) {
      reportMargin("attackChaserUntil", budgetStart, maxMs);
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
  const budgetStart = Date.now();
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const snapshot = await getSnapshot(page);
    if (predicate(snapshot)) {
      reportMargin("waitForSnapshot", budgetStart, timeoutMs);
      return snapshot;
    }
    if (Date.now() > deadline) {
      throw new Error(`waitForSnapshot: predicate never became true within ${String(timeoutMs)}ms`);
    }
    await page.waitForTimeout(intervalMs);
  }
}
