/**
 * Client entry point. Boots Phaser directly into the local `PlayScene`
 * (`docs/M1_EXECUTION_PLAN.md` §9 M1.1 boot-flow clarification): M1 is local,
 * single-player combat with no network required. `BootScene` (the M0
 * connection/health view) is registered but not started by default; it is
 * retained unchanged as the networked entry point M4 reuses.
 */
import Phaser from "phaser";

import { BootScene } from "./scenes/BootScene";
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
  scene: [PlayScene, BootScene],
});
