/**
 * Client entry point. Boots Phaser into `LoadoutScene` (M3,
 * `docs/M3_ISSUES.md` M3.8), which starts `PlayScene` once a legal skill
 * loadout is confirmed — and from M4 that scene joins the authoritative match
 * room carrying the selection as join options, rather than starting a local
 * world. `BootScene` (the connection/health diagnostic view, which joins the
 * connection-only probe room) is registered but not started by default.
 */
import Phaser from "phaser";

import { installDebugHook } from "./debug/debug-hook";
import { partyConnection } from "./party/party-connection";
import { BootScene } from "./scenes/BootScene";
import { LoadoutScene } from "./scenes/LoadoutScene";
import { PlayScene } from "./scenes/PlayScene";

/**
 * The fixed logical viewport. Arena dimensions are authoritative content and
 * may be larger; Phaser's main camera selects which part of that world is
 * visible while `Scale.FIT` maps this viewport onto the browser canvas.
 */
const VIEWPORT_WIDTH = 1920;
const VIEWPORT_HEIGHT = 1080;
const BACKGROUND = "#0b0e14";

export const game = new Phaser.Game({
  type: Phaser.AUTO,
  parent: "app",
  width: VIEWPORT_WIDTH,
  height: VIEWPORT_HEIGHT,
  backgroundColor: BACKGROUND,
  scale: {
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_BOTH,
  },
  scene: [LoadoutScene, PlayScene, BootScene],
});

// Dev/test-only observation hook (docs/TEST_PLAN.md §2.3); stripped from the
// production bundle (`debug-hook.ts`'s module doc explains how and why).
const playScene = (): PlayScene | null => game.scene.getScene("play") as PlayScene | null;

installDebugHook({
  getActiveSceneKey: () => game.scene.getScenes(true)[0]?.scene.key ?? null,
  getSnapshot: () => playScene()?.getSnapshot() ?? null,
  getLocalPlayerId: () => playScene()?.getLocalPlayerId() ?? null,
  getPrivateState: () => playScene()?.getPrivateState() ?? null,
  getConnectionStatus: () => playScene()?.getConnectionStatus() ?? "connecting",
  getCamera: () => playScene()?.getCameraObservation() ?? null,
  // The party lives outside any scene (it has to outlive `PlayScene`), so the
  // hook reads it from the connection directly.
  getParty: () => partyConnection.getParty(),
  getPartyMemberIds: () => playScene()?.getPartyMemberIds() ?? [],
});
