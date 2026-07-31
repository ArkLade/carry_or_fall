/**
 * The M2 inventory HUD panel (M2.9, `docs/M2_ISSUES.md`): the six inventory
 * slots, the secure slot, the current build-effect summary, and a live
 * "if extracted now" point preview. Toggled by `I` (concept §13.1). Reads
 * `World` only and computes purely derived display values from it (the same
 * treatment `combat-hud.ts` gives cooldown-ratio formatting) — it decides no
 * game rule and holds no authority (technical plan §5.1).
 */
import Phaser from "phaser";
import {
  addPointTotals,
  aggregateBuildEffects,
  pointsFromLoot,
  sumInventoryPoints,
  type World,
} from "@carry-or-fall/simulation-core";

const TEXT_COLOR = "#e6edf3";
const MUTED_COLOR = "#8b949e";
const SECURED_COLOR = "#d29922";
const PANEL_BACKGROUND = 0x0d1117;
const PANEL_ALPHA = 0.85;

const BASE_FONT = "system-ui, -apple-system, Segoe UI, Roboto, sans-serif";
const PANEL_X = 12;
const PANEL_Y = 84;
const PANEL_WIDTH = 320;
const PANEL_HEIGHT = 190;

function formatBuildEffects(effects: ReturnType<typeof aggregateBuildEffects>): string {
  const parts: string[] = [];
  if (effects.damageAdd > 0) parts.push(`+${effects.damageAdd.toFixed(0)} dmg`);
  if (effects.attackSpeedBonus > 0)
    parts.push(`+${(effects.attackSpeedBonus * 100).toFixed(0)}% atk spd`);
  if (effects.projectileSpeedAdd > 0)
    parts.push(`+${effects.projectileSpeedAdd.toFixed(0)} proj spd`);
  if (effects.moveSpeedBonus > 0)
    parts.push(`+${(effects.moveSpeedBonus * 100).toFixed(0)}% move spd`);
  if (effects.maxHealthAdd > 0) parts.push(`+${effects.maxHealthAdd.toFixed(0)} max HP`);
  return parts.length > 0 ? parts.join(" · ") : "none";
}

export class InventoryHud {
  private readonly background: Phaser.GameObjects.Rectangle;
  private readonly slotsText: Phaser.GameObjects.Text;
  private readonly secureText: Phaser.GameObjects.Text;
  private readonly buildText: Phaser.GameObjects.Text;
  private readonly pointsText: Phaser.GameObjects.Text;
  private readonly helpText: Phaser.GameObjects.Text;
  private visible = false;

  constructor(scene: Phaser.Scene) {
    this.background = scene.add
      .rectangle(PANEL_X, PANEL_Y, PANEL_WIDTH, PANEL_HEIGHT, PANEL_BACKGROUND, PANEL_ALPHA)
      .setOrigin(0)
      .setScrollFactor(0);

    const textStyle: Phaser.Types.GameObjects.Text.TextStyle = {
      fontFamily: BASE_FONT,
      fontSize: "14px",
      color: TEXT_COLOR,
    };

    this.slotsText = scene.add.text(PANEL_X + 10, PANEL_Y + 8, "", textStyle).setScrollFactor(0);
    this.secureText = scene.add
      .text(PANEL_X + 10, PANEL_Y + 96, "", { ...textStyle, color: SECURED_COLOR })
      .setScrollFactor(0);
    this.buildText = scene.add.text(PANEL_X + 10, PANEL_Y + 118, "", textStyle).setScrollFactor(0);
    this.pointsText = scene.add.text(PANEL_X + 10, PANEL_Y + 140, "", textStyle).setScrollFactor(0);
    this.helpText = scene.add
      .text(PANEL_X + 10, PANEL_Y + 164, "1-6 discard · Shift+1-6 secure · I toggle", {
        ...textStyle,
        fontSize: "12px",
        color: MUTED_COLOR,
      })
      .setScrollFactor(0);

    this.setVisible(false);
  }

  toggle(): void {
    this.setVisible(!this.visible);
  }

  private setVisible(visible: boolean): void {
    this.visible = visible;
    for (const item of [
      this.background,
      this.slotsText,
      this.secureText,
      this.buildText,
      this.pointsText,
      this.helpText,
    ]) {
      item.setVisible(visible);
    }
  }

  render(world: World): void {
    if (!this.visible) {
      return;
    }
    const { player } = world;

    const slotLines = player.inventory.map((item, index) => {
      const label = item === null ? "empty" : `${item.id} (${item.rarity})`;
      return `${String(index + 1)}: ${label}`;
    });
    this.slotsText.setText(slotLines.join("\n"));

    this.secureText.setText(
      `Secure slot: ${player.secureSlot === null ? "empty" : player.secureSlot.id}`,
    );

    const effects = aggregateBuildEffects(player.inventory);
    this.buildText.setText(`Build: ${formatBuildEffects(effects)}`);

    const securePoints =
      player.secureSlot === null
        ? { force: 0, precision: 0, motion: 0, guard: 0, signal: 0 }
        : pointsFromLoot(player.secureSlot);
    const preview = addPointTotals(securePoints, sumInventoryPoints(player.inventory));
    this.pointsText.setText(
      `If extracted now: F${String(preview.force)} P${String(preview.precision)} M${String(
        preview.motion,
      )} G${String(preview.guard)} S${String(preview.signal)}`,
    );
  }
}
