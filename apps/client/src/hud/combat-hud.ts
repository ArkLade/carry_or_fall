/**
 * Minimal combat HUD (M1.11): health, the equipped weapons, and the dash
 * cooldown, plus a death message. Reads `World` only — it holds no authority
 * and no game logic (`docs/M1_EXECUTION_PLAN.md` §9; technical plan §5.1).
 */
import Phaser from "phaser";
import type { World } from "@carry-or-fall/simulation-core";

const TEXT_COLOR = "#e6edf3";
const DASH_READY_COLOR = "#3fb950";
const DASH_COOLDOWN_COLOR = "#8b949e";
const DEATH_COLOR = "#f85149";

const BASE_FONT = "system-ui, -apple-system, Segoe UI, Roboto, sans-serif";

export class CombatHud {
  private readonly healthText: Phaser.GameObjects.Text;
  private readonly weaponsText: Phaser.GameObjects.Text;
  private readonly dashText: Phaser.GameObjects.Text;
  private readonly deathText: Phaser.GameObjects.Text;

  constructor(scene: Phaser.Scene) {
    const textStyle: Phaser.Types.GameObjects.Text.TextStyle = {
      fontFamily: BASE_FONT,
      fontSize: "16px",
      color: TEXT_COLOR,
    };

    this.healthText = scene.add.text(12, 12, "", textStyle).setScrollFactor(0);
    this.weaponsText = scene.add.text(12, 34, "", textStyle).setScrollFactor(0);
    this.dashText = scene.add.text(12, 56, "", textStyle).setScrollFactor(0);

    const camera = scene.cameras.main;
    this.deathText = scene.add
      .text(camera.centerX, camera.centerY, "You Died", {
        fontFamily: BASE_FONT,
        fontSize: "40px",
        color: DEATH_COLOR,
      })
      .setScrollFactor(0)
      .setOrigin(0.5)
      .setVisible(false);
  }

  render(world: World): void {
    const { player } = world;

    this.healthText.setText(
      `HP: ${String(Math.ceil(player.health))} / ${String(player.maxHealth)}`,
    );
    this.weaponsText.setText(`Sword: ${player.meleeWeapon.id} · Bow: ${player.rangedWeapon.id}`);

    if (player.dashCooldownMs <= 0) {
      this.dashText.setText("Dash: ready");
      this.dashText.setColor(DASH_READY_COLOR);
    } else {
      this.dashText.setText(`Dash: ${(player.dashCooldownMs / 1000).toFixed(1)}s`);
      this.dashText.setColor(DASH_COOLDOWN_COLOR);
    }

    this.deathText.setVisible(!player.alive);
  }
}
