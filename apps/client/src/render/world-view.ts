/**
 * Renders the simulation `World` (walls + player) each frame. This is a pure
 * read of simulation state (technical plan §5.1) — it draws what
 * `simulation-core` already decided and never computes a game rule itself
 * (`docs/M1_EXECUTION_PLAN.md` invariant 2).
 */
import Phaser from "phaser";
import type { World } from "@carry-or-fall/simulation-core";

const WALL_COLOR = 0x30363d;
const PLAYER_COLOR = 0x58a6ff;

export class WorldView {
  private readonly graphics: Phaser.GameObjects.Graphics;

  constructor(scene: Phaser.Scene) {
    this.graphics = scene.add.graphics();
  }

  render(world: World): void {
    this.graphics.clear();

    this.graphics.fillStyle(WALL_COLOR, 1);
    for (const wall of world.walls) {
      this.graphics.fillRect(wall.x, wall.y, wall.width, wall.height);
    }

    this.graphics.fillStyle(PLAYER_COLOR, 1);
    this.graphics.fillCircle(world.player.position.x, world.player.position.y, world.player.radius);
  }
}
