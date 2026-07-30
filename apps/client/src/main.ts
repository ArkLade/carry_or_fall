/**
 * Client entry point. Boots Phaser with a single scene. All connection logic
 * lives in the scene; this file only wires up the game instance.
 */
import Phaser from "phaser";

import { BootScene } from "./scenes/BootScene";

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
  scene: [BootScene],
});
