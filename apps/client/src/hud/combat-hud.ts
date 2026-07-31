/**
 * Minimal combat HUD (M1.11): health, the equipped weapons, and the dash
 * cooldown, plus the M2 local run result once the run ends (extraction or
 * death, `docs/M2_ISSUES.md` M2.9). Reads `World` only — it holds no
 * authority and no game logic (`docs/M1_EXECUTION_PLAN.md` §9; technical plan
 * §5.1).
 */
import Phaser from "phaser";
import type { RunResult, World } from "@carry-or-fall/simulation-core";

const TEXT_COLOR = "#e6edf3";
const DASH_READY_COLOR = "#3fb950";
const DASH_COOLDOWN_COLOR = "#8b949e";
const DEATH_COLOR = "#f85149";
const EXTRACTED_COLOR = "#3fb950";

const BASE_FONT = "system-ui, -apple-system, Segoe UI, Roboto, sans-serif";

function formatRunResult(result: RunResult): string {
  const { pointsGained } = result;
  const outcomeLabel = result.outcome === "extracted" ? "Extracted" : "You Died";
  return [
    outcomeLabel,
    `Points: F${String(pointsGained.force)} P${String(pointsGained.precision)} M${String(
      pointsGained.motion,
    )} G${String(pointsGained.guard)} S${String(pointsGained.signal)}`,
    `Converted ${String(result.itemsConverted)} · Lost ${String(result.itemsLost)}`,
    "Press Enter for a new run",
  ].join("\n");
}

export class CombatHud {
  private readonly healthText: Phaser.GameObjects.Text;
  private readonly weaponsText: Phaser.GameObjects.Text;
  private readonly dashText: Phaser.GameObjects.Text;
  private readonly runResultText: Phaser.GameObjects.Text;

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
    this.runResultText = scene.add
      .text(camera.centerX, camera.centerY, "", {
        fontFamily: BASE_FONT,
        fontSize: "28px",
        color: DEATH_COLOR,
        align: "center",
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

    if (world.runResult === null) {
      this.runResultText.setVisible(false);
    } else {
      this.runResultText.setText(formatRunResult(world.runResult));
      this.runResultText.setColor(
        world.runResult.outcome === "extracted" ? EXTRACTED_COLOR : DEATH_COLOR,
      );
      this.runResultText.setVisible(true);
    }
  }
}
