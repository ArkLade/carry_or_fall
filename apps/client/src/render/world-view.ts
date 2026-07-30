/**
 * Renders the simulation `World` (walls, player, aim, an in-flight melee
 * swing, and projectiles) each frame. This is a pure read of simulation state
 * (technical plan §5.1) — it draws what `simulation-core` already decided and
 * never computes a game rule itself (`docs/M1_EXECUTION_PLAN.md` invariant 2).
 */
import Phaser from "phaser";
import { meleePhase, type World } from "@carry-or-fall/simulation-core";

const WALL_COLOR = 0x30363d;
const PLAYER_COLOR = 0x58a6ff;
const PROJECTILE_COLOR = 0xf0b429;
const AIM_LINE_COLOR = 0x8b949e;
const AIM_LINE_LENGTH_PX = 30;
const MELEE_SWING_COLOR = 0xf85149;
const MELEE_SWING_ALPHA = 0.35;

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

    this.graphics.fillStyle(PROJECTILE_COLOR, 1);
    for (const projectile of world.projectiles) {
      this.graphics.fillCircle(projectile.position.x, projectile.position.y, projectile.radius);
    }

    const { player } = world;
    const meleeAttack = player.meleeAttack;
    if (meleeAttack !== null && meleePhase(meleeAttack) === "active") {
      const rangePx = meleeAttack.weapon.rangePx ?? 0;
      const halfArcRad = ((meleeAttack.weapon.arcDegrees ?? 0) * Math.PI) / 360;
      this.graphics.fillStyle(MELEE_SWING_COLOR, MELEE_SWING_ALPHA);
      this.graphics.slice(
        meleeAttack.origin.x,
        meleeAttack.origin.y,
        rangePx,
        meleeAttack.facing - halfArcRad,
        meleeAttack.facing + halfArcRad,
      );
      this.graphics.fillPath();
    }

    this.graphics.fillStyle(PLAYER_COLOR, 1);
    this.graphics.fillCircle(player.position.x, player.position.y, player.radius);

    this.graphics.lineStyle(2, AIM_LINE_COLOR, 1);
    this.graphics.lineBetween(
      player.position.x,
      player.position.y,
      player.position.x + Math.cos(player.facing) * AIM_LINE_LENGTH_PX,
      player.position.y + Math.sin(player.facing) * AIM_LINE_LENGTH_PX,
    );
  }
}
