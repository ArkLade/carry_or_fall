/**
 * The inventory HUD panel (M2.9, `docs/M2_ISSUES.md`): the six inventory slots,
 * the secure slot, the current build-effect summary, the three permanent skill
 * slots, the wildcard slot, the player's shield, and a live "if extracted now"
 * point preview. Toggled by `I` (concept §13.1).
 *
 * M4 changes where the data comes from, not what it shows: the panel reads this
 * client's own `LocalPlayerState`, which the server sends to it alone
 * (technical plan §10.3). It receives content **ids** and resolves them against
 * the shared content tables, so the derived values below (build effects, point
 * preview) are computed from definitions both ends agree on — the join
 * handshake refuses a client whose content version differs
 * (`docs/DECISIONS.md` D34).
 *
 * Everything here is display-only. The preview is what *would* be awarded; the
 * server decides what actually is (technical plan §5.1).
 */
import Phaser from "phaser";
import { isBossCore, type LootDefinition } from "@carry-or-fall/game-content";
import type { LocalPlayerState, PlayerView } from "@carry-or-fall/protocol";
import {
  addPointTotals,
  aggregateBuildEffects,
  pointsFromLoot,
  sumInventoryPoints,
  ZERO_POINTS,
} from "@carry-or-fall/simulation-core";

import { findLoot } from "../network/match-connection";

const TEXT_COLOR = "#e6edf3";
const MUTED_COLOR = "#8b949e";
const SECURED_COLOR = "#d29922";
const SHIELD_COLOR = "#58a6ff";
const PANEL_BACKGROUND = 0x0d1117;
const PANEL_ALPHA = 0.85;

const BASE_FONT = "system-ui, -apple-system, Segoe UI, Roboto, sans-serif";
const PANEL_X = 12;
const PANEL_Y = 84;
const PANEL_WIDTH = 320;
const PANEL_HEIGHT = 282;
const CORE_COLOR = "#f85149";

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

/** Resolve the server's inventory ids into definitions; an id this build cannot resolve reads as empty. */
function resolveInventory(state: LocalPlayerState): readonly (LootDefinition | null)[] {
  return state.inventory.map((id) => (id === null ? null : (findLoot(id) ?? null)));
}

export class InventoryHud {
  private readonly background: Phaser.GameObjects.Rectangle;
  private readonly slotsText: Phaser.GameObjects.Text;
  private readonly secureText: Phaser.GameObjects.Text;
  private readonly buildText: Phaser.GameObjects.Text;
  private readonly skillsText: Phaser.GameObjects.Text;
  private readonly pointsText: Phaser.GameObjects.Text;
  /** The boss-core prompt (M7): only present while a core is actually carried. */
  private readonly coreText: Phaser.GameObjects.Text;
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
    this.skillsText = scene.add
      .text(PANEL_X + 10, PANEL_Y + 140, "", { ...textStyle, color: SHIELD_COLOR })
      .setScrollFactor(0);
    this.pointsText = scene.add.text(PANEL_X + 10, PANEL_Y + 184, "", textStyle).setScrollFactor(0);
    this.coreText = scene.add
      .text(PANEL_X + 10, PANEL_Y + 206, "", {
        ...textStyle,
        fontSize: "12px",
        color: CORE_COLOR,
        // Wrapped rather than trusted to fit: this is the longest string the
        // panel ever shows, and an unwrapped line would run off its background.
        wordWrap: { width: PANEL_WIDTH - 20 },
      })
      .setScrollFactor(0);
    this.helpText = scene.add
      .text(PANEL_X + 10, PANEL_Y + 256, "1-6 discard · Shift+1-6 secure · I toggle", {
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
      this.skillsText,
      this.pointsText,
      this.coreText,
      this.helpText,
    ]) {
      item.setVisible(visible);
    }
  }

  render(state: LocalPlayerState | null, localPlayer: PlayerView | null): void {
    if (!this.visible) {
      return;
    }
    if (state === null) {
      this.slotsText.setText("(waiting for the server)");
      this.secureText.setText("");
      this.buildText.setText("");
      this.skillsText.setText("");
      this.pointsText.setText("");
      this.coreText.setText("");
      return;
    }

    const inventory = resolveInventory(state);
    const slotLines = inventory.map((item, index) => {
      const label = item === null ? "empty" : `${item.id} (${item.rarity})`;
      return `${String(index + 1)}: ${label}`;
    });
    this.slotsText.setText(slotLines.join("\n"));

    this.secureText.setText(`Secure slot: ${state.secureSlotItemId ?? "empty"}`);

    const effects = aggregateBuildEffects(inventory);
    this.buildText.setText(`Build: ${formatBuildEffects(effects)}`);

    const loadoutLabel = state.skillIds.length === 0 ? "none" : state.skillIds.join(", ");
    const shieldHp = localPlayer === null ? 0 : Math.ceil(localPlayer.shieldHp);
    this.skillsText.setText(
      `Skills: ${loadoutLabel}\nWildcard: ${state.wildcardSkillId ?? "empty"} · Shield: ${String(shieldHp)}`,
    );

    const secured = state.secureSlotItemId === null ? null : findLoot(state.secureSlotItemId);
    const securePoints =
      secured === undefined || secured === null ? ZERO_POINTS : pointsFromLoot(secured);
    const preview = addPointTotals(securePoints, sumInventoryPoints(inventory));
    this.pointsText.setText(
      `If extracted now: F${String(preview.force)} P${String(preview.precision)} M${String(
        preview.motion,
      )} G${String(preview.guard)} S${String(preview.signal)}`,
    );

    // The boss core's three-way decision (M7, concept §11), stated only while
    // one is carried — and stated as the *choice*, because the choice is the
    // mechanic. The point preview above already shows the truth that a core is
    // worth no points on its own: what it is worth is an unlock, and only if it
    // survives the run.
    const coreSlot = inventory.findIndex((item) => item !== null && isBossCore(item));
    this.coreText.setText(
      coreSlot === -1
        ? ""
        : `Boss core in slot ${String(coreSlot + 1)}: C activate now (lost on death) · ` +
            `Shift+${String(coreSlot + 1)} secure it · or carry it out`,
    );
  }
}
