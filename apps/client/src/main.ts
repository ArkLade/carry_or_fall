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

const GAME_WIDTH = 960;
const GAME_HEIGHT = 540;
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
