/**
 * Checkpoint 0A camera coverage on the shipped 1920 × 1080 arena. Actual
 * scrolling remains a 0C contract after 0B supplies a larger world; these
 * tests prove the safe state, authoritative bounds, viewport, and rendering-
 * only boundary without fabricating oversized client geometry.
 */
import { testArena } from "@carry-or-fall/game-content";
import { expect, test } from "@playwright/test";

import {
  enterMatch,
  getCamera,
  getConnectionStatus,
  getLocalPlayer,
  gotoGame,
  pressKey,
  waitForActiveScene,
} from "./helpers";

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
    expect(observation.camera).toEqual({
      scrollX: 0,
      scrollY: 0,
      viewportWidth: 1920,
      viewportHeight: 1080,
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

    await page.evaluate(
      () =>
        new Promise<void>((resolve) => {
          requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
        }),
    );

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
