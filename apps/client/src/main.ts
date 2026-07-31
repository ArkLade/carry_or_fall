/**
 * Client entry point. Boots Phaser directly into the local `LoadoutScene`
 * (M3, `docs/M3_ISSUES.md` M3.8), which starts `PlayScene` once a legal
 * skill loadout is confirmed (`docs/M1_EXECUTION_PLAN.md` §9 M1.1's boot-flow
 * clarification still applies: this is local, single-player, no network
 * required). `BootScene` (the M0 connection/health view) is registered but
 * not started by default; it is retained unchanged as the networked entry
 * point M4 reuses.
 */
import Phaser from "phaser";

import { installDebugHook } from "./debug/debug-hook";
import { BootScene } from "./scenes/BootScene";
import { LoadoutScene } from "./scenes/LoadoutScene";
import { PlayScene } from "./scenes/PlayScene";

/**
 * Matches `PlayScene`'s map dimensions, so the whole arena is visible at
 * once. Doubled alongside the map for M4 prep. `Scale.FIT` then scales that
 * down to whatever the browser window is, which means a larger map renders
 * everything proportionally smaller rather than cropping it — acceptable
 * while the map is a single fixed-size test arena, and the reason a
 * follow-camera is worth revisiting if the map grows again.
 */
const GAME_WIDTH = 1920;
const GAME_HEIGHT = 1080;
const BACKGROUND = "#0b0e14";

export const game = new Phaser.Game({
  type: Phaser.AUTO,
  parent: "app",
  width: GAME_WIDTH,
  height: GAME_HEIGHT,
  backgroundColor: BACKGROUND,
  scale: {
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_BOTH,
  },
  scene: [LoadoutScene, PlayScene, BootScene],
});

// Dev/test-only observation hook (docs/TEST_PLAN.md §2.3); stripped from the
// production bundle (`debug-hook.ts`'s module doc explains how and why).
installDebugHook({
  getActiveSceneKey: () => game.scene.getScenes(true)[0]?.scene.key ?? null,
  getWorld: () => (game.scene.getScene("play") as PlayScene | null)?.getWorld() ?? null,
});
