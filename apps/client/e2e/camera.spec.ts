/**
 * Checkpoint 0A camera coverage, with the arena-size-dependent safe-state
 * expectation maintained for Checkpoint 0B. Actual scrolling remains a 0C
 * contract; these tests prove the safe state, authoritative bounds, viewport,
 * and rendering-only boundary without fabricating client geometry.
 */
import { testArena } from "@carry-or-fall/game-content";
import { expect, test, type Page } from "@playwright/test";

import {
  aimAt,
  enterMatch,
  fireAndObserve,
  getCamera,
  getConnectionStatus,
  getLocalPlayer,
  getLocalPlayerId,
  gotoGame,
  pressKey,
  waitForActiveScene,
  walkToArenaPoint,
} from "./helpers";

async function settleRenderFrame(page: Page): Promise<void> {
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
      }),
  );
}

interface HudObservation {
  readonly type: string;
  readonly x: number;
  readonly y: number;
  readonly scrollFactorX: number;
  readonly scrollFactorY: number;
  readonly visible: boolean;
}

async function observeHud(page: Page): Promise<readonly HudObservation[]> {
  return page.evaluate(async () => {
    // Use the exact entry-module URL Vite booted. Importing a differently
    // spelled relative URL would create a second Phaser.Game module instance
    // instead of observing the running one.
    const mainModuleUrl = "/src/main.ts";
    const { game } = (await import(mainModuleUrl)) as typeof import("../src/main");
    const scene = game.scene.getScene("play");
    return scene.children.list.flatMap((child) => {
      const display = child as unknown as Partial<HudObservation>;
      if (
        typeof display.x !== "number" ||
        typeof display.y !== "number" ||
        display.scrollFactorX !== 0 ||
        display.scrollFactorY !== 0 ||
        typeof display.visible !== "boolean"
      ) {
        return [];
      }
      return [
        {
          type: child.type,
          x: display.x,
          y: display.y,
          scrollFactorX: display.scrollFactorX,
          scrollFactorY: display.scrollFactorY,
          visible: display.visible,
        },
      ];
    });
  });
}

test.describe("Checkpoint 0A main camera", () => {
  test("has a deterministic in-bounds state before an authoritative local player exists", async ({
    page,
  }) => {
    // Refuse only matchmaking so PlayScene creates normally but no
    // authoritative room state or local player can arrive.
    await page.route("**/matchmake/**", (route) => route.abort("connectionrefused"));
    await gotoGame(page);
    await pressKey(page, "Enter");
    await waitForActiveScene(page, "play");

    const observation = await page.evaluate(() => ({
      camera: window.__CARRY_OR_FALL_DEBUG__?.getCamera() ?? null,
      localPlayerId: window.__CARRY_OR_FALL_DEBUG__?.getLocalPlayerId() ?? null,
      snapshot: window.__CARRY_OR_FALL_DEBUG__?.getSnapshot() ?? null,
    }));

    expect(observation.localPlayerId).toBeNull();
    expect(observation.snapshot).toBeNull();

    const logicalViewport = { width: 1920, height: 1080 } as const;
    const centeredSafeScroll = {
      scrollX: (testArena.width - logicalViewport.width) / 2,
      scrollY: (testArena.height - logicalViewport.height) / 2,
    };
    expect(centeredSafeScroll).toEqual({ scrollX: 320, scrollY: 180 });
    expect(observation.camera).toEqual({
      ...centeredSafeScroll,
      viewportWidth: logicalViewport.width,
      viewportHeight: logicalViewport.height,
      arenaBounds: { x: 0, y: 0, width: testArena.width, height: testArena.height },
    });

    await expect.poll(() => getConnectionStatus(page)).toBe("failed");
    await pressKey(page, "Enter");
    await waitForActiveScene(page, "loadout");
    expect(
      await page.evaluate(() => window.__CARRY_OR_FALL_DEBUG__?.getCamera() ?? null),
    ).toBeNull();
  });

  test("observes ArenaDefinition bounds without changing authoritative coordinates", async ({
    page,
  }) => {
    await gotoGame(page);
    await enterMatch(page);

    const before = await getLocalPlayer(page);
    const cameraBefore = await getCamera(page);

    await settleRenderFrame(page);

    const after = await getLocalPlayer(page);
    const cameraAfter = await getCamera(page);

    expect(cameraBefore).toEqual({
      scrollX: 0,
      scrollY: 0,
      viewportWidth: 1920,
      viewportHeight: 1080,
      arenaBounds: { x: 0, y: 0, width: testArena.width, height: testArena.height },
    });
    expect(cameraAfter).toEqual(cameraBefore);
    expect({ x: after.x, y: after.y }).toEqual({ x: before.x, y: before.y });
  });
});

const EDGE_CASES = [
  {
    name: "north",
    target: { x: 880, y: 50 },
    expectedScroll: { x: 0, y: 0 },
    moveKey: "KeyS",
    aim: { x: 0, y: 1 },
  },
  {
    name: "south",
    target: { x: 880, y: 1390 },
    expectedScroll: { x: 0, y: 360 },
    moveKey: "KeyW",
    aim: { x: 0, y: -1 },
  },
  {
    name: "east",
    target: { x: 2510, y: 60 },
    expectedScroll: { x: 640, y: 0 },
    moveKey: "KeyA",
    aim: { x: -1, y: 0 },
  },
  {
    name: "west",
    target: { x: 50, y: 220 },
    expectedScroll: { x: 0, y: 0 },
    moveKey: "KeyD",
    aim: { x: 1, y: 0 },
  },
] as const;

test.describe("Checkpoint 0C edge camera and aim", () => {
  for (const edge of EDGE_CASES) {
    test(`${edge.name} edge stays clamped, keeps the player visible, and aims while moving`, async ({
      page,
    }) => {
      await gotoGame(page);
      await enterMatch(page);
      if (edge.name === "east") {
        // Cross the upper-right half above the Warden's encounter rather than
        // taking the direct y=220 line through its 320 px aggro circle.
        await walkToArenaPoint(page, 880, edge.target.y);
      }
      await walkToArenaPoint(page, edge.target.x, edge.target.y);
      await settleRenderFrame(page);

      const player = await getLocalPlayer(page);
      const camera = await getCamera(page);
      expect(camera.scrollX).toBeCloseTo(edge.expectedScroll.x, 4);
      expect(camera.scrollY).toBeCloseTo(edge.expectedScroll.y, 4);
      expect(camera.scrollX).toBeGreaterThanOrEqual(0);
      expect(camera.scrollY).toBeGreaterThanOrEqual(0);
      expect(camera.scrollX + camera.viewportWidth).toBeLessThanOrEqual(testArena.width);
      expect(camera.scrollY + camera.viewportHeight).toBeLessThanOrEqual(testArena.height);
      expect(player.x - camera.scrollX).toBeGreaterThanOrEqual(0);
      expect(player.x - camera.scrollX).toBeLessThanOrEqual(camera.viewportWidth);
      expect(player.y - camera.scrollY).toBeGreaterThanOrEqual(0);
      expect(player.y - camera.scrollY).toBeLessThanOrEqual(camera.viewportHeight);

      const playerId = await getLocalPlayerId(page);
      await page.keyboard.down(edge.moveKey);
      let fired: Awaited<ReturnType<typeof fireAndObserve>>;
      try {
        await aimAt(page, player.x + edge.aim.x * 300, player.y + edge.aim.y * 300);
        fired = await fireAndObserve(page);
      } finally {
        await page.keyboard.up(edge.moveKey);
      }
      const projectile = fired.projectiles.find((entry) => entry.ownerId === playerId);
      expect(projectile).toBeDefined();
      if (projectile === undefined) return;
      const speed = Math.hypot(projectile.velocityX, projectile.velocityY);
      const aimDot =
        (projectile.velocityX * edge.aim.x + projectile.velocityY * edge.aim.y) / speed;
      expect(aimDot).toBeGreaterThan(0.98);
    });
  }

  test("CombatHud and InventoryHud stay fixed while the world scrolls", async ({
    page,
  }, testInfo) => {
    await gotoGame(page);
    await enterMatch(page);
    await pressKey(page, "KeyI");
    await settleRenderFrame(page);

    const playerId = await getLocalPlayerId(page);
    const before = await observeHud(page);
    expect(before).toHaveLength(13);
    expect(before.every((entry) => entry.scrollFactorX === 0 && entry.scrollFactorY === 0)).toBe(
      true,
    );

    await walkToArenaPoint(page, 880, testArena.openLaneY);
    await settleRenderFrame(page);
    const camera = await getCamera(page);
    expect(camera.scrollY).toBe(360);
    const after = await observeHud(page);
    expect(after).toEqual(before);

    const artifactPath = testInfo.outputPath("hud-after-world-scroll.png");
    expect(artifactPath.replaceAll("\\", "/")).toContain("/.playwright-test-results/");
    await page.screenshot({ path: artifactPath });
    expect(await getLocalPlayerId(page)).toBe(playerId);
    expect(await waitForActiveScene(page, "play")).toBeUndefined();
  });
});
