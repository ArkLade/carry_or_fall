/**
 * Minimal combat HUD (M1.11): health, the equipped weapons, and the dash
 * cooldown, plus the run result once this player's run ends (extraction or
 * death, `docs/M2_ISSUES.md` M2.9). M4 adds the match line — phase, countdown or
 * remaining time, and how many players are in the room — and the connection
 * status, because a player now needs to know whether the server is still there.
 *
 * It reads server-decided state only: it holds no authority and computes no
 * game rule (`docs/M1_EXECUTION_PLAN.md` §9; technical plan §5.1).
 *
 * The dash cooldown is the one thing the HUD can no longer show: cooldowns are
 * server state and are not published, because publishing every player's
 * cooldowns would be private data with no rendering purpose (technical plan
 * §10.3). The line shows the equipped weapons instead, which is what concept
 * §23.1 asks the HUD for.
 */
import Phaser from "phaser";
import { basicBow, basicSword } from "@carry-or-fall/game-content";
import type {
  LocalPlayerState,
  MatchView,
  PlayerView,
  RunResultPayload,
  SettlementMessage,
} from "@carry-or-fall/protocol";

import {
  ANONYMOUS_ACCOUNT_WARNING,
  shouldWarnAboutAnonymousAccount,
} from "../account/linking-warning";
import type { MatchStatus } from "../network/match-connection";

const TEXT_COLOR = "#e6edf3";
const MUTED_COLOR = "#8b949e";
const OK_COLOR = "#3fb950";
const PENDING_COLOR = "#d29922";
const DEATH_COLOR = "#f85149";
const EXTRACTED_COLOR = "#3fb950";

const BASE_FONT = "system-ui, -apple-system, Segoe UI, Roboto, sans-serif";

const STATUS_COLOR: Record<MatchStatus, string> = {
  connecting: PENDING_COLOR,
  connected: OK_COLOR,
  reconnecting: PENDING_COLOR,
  disconnected: DEATH_COLOR,
  failed: DEATH_COLOR,
};

function formatRunResult(result: RunResultPayload): string {
  const { pointsGained } = result;
  const outcomeLabel = result.outcome === "extracted" ? "Extracted" : "You Died";
  return [
    outcomeLabel,
    `Points: F${String(pointsGained.force)} P${String(pointsGained.precision)} M${String(
      pointsGained.motion,
    )} G${String(pointsGained.guard)} S${String(pointsGained.signal)}`,
    `Converted ${String(result.itemsConverted)} · Lost ${String(result.itemsLost)}`,
    "Press Enter to choose your next loadout",
  ].join("\n");
}

function formatMatchLine(view: MatchView): string {
  const players = view.players.filter((player) => !player.runOver).length;
  switch (view.phase) {
    case "waiting":
      return "Waiting for players…";
    case "countdown":
      return `Match starts in ${(view.countdownRemainingMs / 1000).toFixed(1)}s · ${String(players)} in lobby`;
    case "running": {
      const seconds = Math.max(0, Math.floor(view.matchRemainingMs / 1000));
      const minutes = Math.floor(seconds / 60);
      return `Match ${String(minutes)}:${String(seconds % 60).padStart(2, "0")} · ${String(players)} playing`;
    }
    case "ending":
      return "Match over";
    default:
      return "";
  }
}

export class CombatHud {
  private readonly healthText: Phaser.GameObjects.Text;
  private readonly weaponsText: Phaser.GameObjects.Text;
  private readonly matchText: Phaser.GameObjects.Text;
  private readonly statusText: Phaser.GameObjects.Text;
  private readonly runResultText: Phaser.GameObjects.Text;

  constructor(scene: Phaser.Scene) {
    const textStyle: Phaser.Types.GameObjects.Text.TextStyle = {
      fontFamily: BASE_FONT,
      fontSize: "16px",
      color: TEXT_COLOR,
    };

    this.healthText = scene.add.text(12, 12, "", textStyle).setScrollFactor(0);
    this.weaponsText = scene.add.text(12, 34, "", textStyle).setScrollFactor(0);
    this.matchText = scene.add
      .text(12, 56, "", { ...textStyle, color: MUTED_COLOR })
      .setScrollFactor(0);

    const camera = scene.cameras.main;
    this.statusText = scene.add
      .text(camera.width - 12, 12, "", { ...textStyle, fontSize: "14px" })
      .setScrollFactor(0)
      .setOrigin(1, 0);

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

  render(
    view: MatchView,
    localPlayer: PlayerView | null,
    privateState: LocalPlayerState | null,
    status: MatchStatus,
    /**
     * The settled account, once the write has landed (M5). `null` while the run
     * result is on screen but the settlement has not returned — which is a state
     * worth showing honestly rather than pretending the points are already
     * banked.
     */
    settlement: SettlementMessage | null = null,
  ): void {
    if (localPlayer === null) {
      this.healthText.setText("HP: —");
    } else {
      this.healthText.setText(
        `HP: ${String(Math.ceil(localPlayer.health))} / ${String(localPlayer.maxHealth)}`,
      );
    }
    this.weaponsText.setText(`Sword: ${basicSword.id} · Bow: ${basicBow.id}`);
    this.matchText.setText(formatMatchLine(view));

    this.statusText.setText(
      status === "connected"
        ? ""
        : status === "failed"
          ? "Server: failed · press Enter to go back"
          : `Server: ${status}`,
    );
    this.statusText.setColor(STATUS_COLOR[status]);

    const result = privateState?.runResult ?? null;
    if (result === null) {
      this.runResultText.setVisible(false);
    } else {
      this.runResultText.setText(`${formatRunResult(result)}\n${formatSettlement(settlement)}`);
      this.runResultText.setColor(result.outcome === "extracted" ? EXTRACTED_COLOR : DEATH_COLOR);
      this.runResultText.setVisible(true);
    }
  }
}

/**
 * What the account looks like after the run (M5). The three cases are
 * deliberately distinguishable rather than collapsed into one cheerful line:
 *
 * - not yet settled — the write has not landed, so nothing is claimed;
 * - already settled — a retry or recovery found this run settled, so no second
 *   payout is animated for points that were not just earned;
 * - settled now — the balances, plus any unlock this run opened.
 */
function formatSettlement(settlement: SettlementMessage | null): string {
  if (settlement === null) {
    return "Saving progress…";
  }
  const { balances } = settlement;
  const totals =
    `Force ${String(balances.force)} · Precision ${String(balances.precision)} · ` +
    `Motion ${String(balances.motion)} · Guard ${String(balances.guard)} · ` +
    `Signal ${String(balances.signal)}`;

  if (settlement.alreadySettled) {
    return `Already recorded\n${totals}`;
  }
  const unlocked =
    settlement.newUnlockIds.length > 0 ? `\nUnlocked: ${settlement.newUnlockIds.join(", ")}` : "";
  // Concept §11's duplicate rule, said out loud (M7). A player who carried a
  // second core out is owed an explanation of where it went, and "converted to
  // points" is that explanation — the alternative is a core that silently
  // vanishes into a balance.
  const converted =
    settlement.duplicateCoreIds.length > 0
      ? `\nDuplicate core converted to points: ${settlement.duplicateCoreIds.join(", ")}`
      : "";
  const warning = shouldWarnAboutAnonymousAccount({
    isAnonymous: settlement.isAnonymous,
    balances,
    unconfigured: false,
  })
    ? `\n\n${ANONYMOUS_ACCOUNT_WARNING}`
    : "";
  return `${totals}${unlocked}${converted}${warning}`;
}
