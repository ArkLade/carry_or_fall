/**
 * Renders one authoritative snapshot of the match — walls, every player, aim,
 * in-flight melee swings, projectiles, enemies, ground loot, skill chips, and
 * extraction points — each frame. This is a pure read of server-decided state
 * (technical plan §5.1): it draws what the room already resolved and computes no
 * game rule itself.
 *
 * M4 changed two things. The walls now come from the arena content definition
 * both ends share (`@carry-or-fall/game-content`), not from a client constant,
 * so the geometry drawn is the geometry the server collides against. And there
 * are now up to eight players: the local one is drawn in the player color, the
 * others in a distinct remote color, so a glance answers "which one is me".
 *
 * Per-projectile skill-behavior rendering (concept §13.3 "distinguishable...
 * attacks", "obvious damage sources"; must avoid "large opaque effects" and
 * "unreadable projectile spam") uses four independent, composable channels —
 * simple silhouettes and outlines, no particles, no animation — so any
 * combination of bounce/pierce/return/homing on the same projectile stays
 * readable at a glance:
 *
 * - **homing** → the projectile's core fill color shifts (pink vs. the
 *   default gold).
 * - **return** → the core shape becomes a small arrow pointing along its
 *   direction of travel, instead of a plain circle.
 * - **pierce** → a short trailing line behind the projectile.
 * - **bounce** → an outline ring around the projectile.
 */
import Phaser from "phaser";
import { type ArenaDefinition, findBoss } from "@carry-or-fall/game-content";
import type { BossView, MatchView, PlayerView, ProjectileView } from "@carry-or-fall/protocol";
import { EXTRACTION_CHANNEL_MS } from "@carry-or-fall/simulation-core";

const WALL_COLOR = 0x30363d;
const PLAYER_COLOR = 0x58a6ff;
const REMOTE_PLAYER_COLOR = 0xa5d6ff;
const DISCONNECTED_PLAYER_COLOR = 0x6e7681;
const PROJECTILE_COLOR = 0xf0b429;
const PROJECTILE_HOMING_COLOR = 0xff5fd1;
const PROJECTILE_BOUNCE_RING_COLOR = 0xffa657;
const PROJECTILE_PIERCE_TRAIL_COLOR = 0x39c5cf;
const PROJECTILE_RETURN_ARROW_PX = 9;
const AIM_LINE_COLOR = 0x8b949e;
const AIM_LINE_LENGTH_PX = 30;
const MELEE_SWING_COLOR = 0xf85149;
const MELEE_SWING_ALPHA = 0.35;
const ENEMY_COLOR = 0xd29922;
const ENEMY_STUNNED_COLOR = 0x8b949e;
const ENEMY_STUN_MARK_COLOR = 0xf0b429;
const ENEMY_HEALTH_BAR_BACKGROUND = 0x30363d;
const ENEMY_HEALTH_BAR_FILL = 0x3fb950;
const ENEMY_HEALTH_BAR_WIDTH_PX = 36;
const ENEMY_HEALTH_BAR_HEIGHT_PX = 5;
const ENEMY_HEALTH_BAR_OFFSET_PX = 14;
const GROUND_LOOT_COLOR = 0xa371f7;
const SKILL_CHIP_COLOR = 0x39c5cf;
const EXTRACTION_RING_COLOR = 0x3fb950;
const EXTRACTION_CHANNEL_FILL_COLOR = 0x3fb950;
const EXTRACTION_CHANNEL_FILL_ALPHA = 0.4;
const SHIELD_RING_COLOR = 0x58a6ff;
const SHIELD_RING_OFFSET_PX = 6;

/**
 * Party marker (M6; concept §8.4 step 6's "shared visual identifiers", §23.1's
 * "party status"). A small chevron above a teammate's head — a silhouette, no
 * particles and no animation, matching concept §24.1's readability rules and
 * the projectile cues above.
 *
 * It is drawn from the per-owner private message, so **only** party members see
 * it and only over their own teammates (`docs/DECISIONS.md` D58). It grants no
 * authority: deleting this code would change what is on screen and nothing else.
 */
const PARTY_MARKER_COLOR = 0x3fb950;
const PARTY_MARKER_OFFSET_PX = 14;
const PARTY_MARKER_HALF_WIDTH_PX = 7;
const PARTY_MARKER_HEIGHT_PX = 7;

/**
 * The boss (M7; concept §14.3 "readable", §24.1's readability rules).
 *
 * Three static cues, no particles and no animation, matching every other cue in
 * this file:
 *
 * - **body** — a larger circle in its own color, with a wider health bar, so it
 *   is never mistaken for an ordinary enemy.
 * - **phase change** — the body color shifts once it enrages, and a ring is
 *   added around it. Two independent channels, like the stun indicator.
 * - **telegraph** — the *shape of the attack that is coming*, filled
 *   translucently, drawn from the `BossDefinition` this client already holds.
 *   The arc attacks draw a wedge along the committed facing; the area attack
 *   draws a full circle. That drawing is what makes §14.3's "readable" real: a
 *   player who leaves the shape before the wind-up ends is not hit, because the
 *   shape drawn here is the shape the server resolves.
 */
const BOSS_COLOR = 0xda3633;
const BOSS_ENRAGED_COLOR = 0xff7b72;
const BOSS_ENRAGED_RING_COLOR = 0xffa198;
const BOSS_TELEGRAPH_COLOR = 0xf85149;
const BOSS_TELEGRAPH_ALPHA = 0.28;
const BOSS_HEALTH_BAR_WIDTH_PX = 90;
const BOSS_HEALTH_BAR_HEIGHT_PX = 8;
const BOSS_HEALTH_BAR_OFFSET_PX = 22;

export class WorldView {
  private readonly graphics: Phaser.GameObjects.Graphics;

  constructor(scene: Phaser.Scene) {
    this.graphics = scene.add.graphics();
  }

  render(
    view: MatchView,
    arena: ArenaDefinition,
    localPlayerId: string | null,
    partyMemberIds: readonly string[] = [],
  ): void {
    this.graphics.clear();

    this.graphics.fillStyle(WALL_COLOR, 1);
    for (const wall of arena.walls) {
      this.graphics.fillRect(wall.x, wall.y, wall.width, wall.height);
    }

    for (const projectile of view.projectiles) {
      this.drawProjectile(projectile);
    }

    this.graphics.fillStyle(GROUND_LOOT_COLOR, 1);
    for (const loot of view.groundLoot) {
      this.graphics.fillCircle(loot.x, loot.y, 8);
    }

    // Skill chips (M3.7): a diamond, visually distinct from ground loot's circle.
    this.graphics.fillStyle(SKILL_CHIP_COLOR, 1);
    for (const chip of view.skillChips) {
      const size = 9;
      this.graphics.beginPath();
      this.graphics.moveTo(chip.x, chip.y - size);
      this.graphics.lineTo(chip.x + size, chip.y);
      this.graphics.lineTo(chip.x, chip.y + size);
      this.graphics.lineTo(chip.x - size, chip.y);
      this.graphics.closePath();
      this.graphics.fillPath();
    }

    this.graphics.lineStyle(3, EXTRACTION_RING_COLOR, 1);
    for (const point of view.extractionPoints) {
      this.graphics.strokeCircle(point.x, point.y, point.radius);
    }
    // Channel progress, drawn as a filling wedge over the point each channelling
    // player is standing in (concept §13.3 "clear extraction effects"; §17.2
    // wants extraction to notify nearby players, so *every* player's channel is
    // drawn, not just the local one).
    this.graphics.fillStyle(EXTRACTION_CHANNEL_FILL_COLOR, EXTRACTION_CHANNEL_FILL_ALPHA);
    for (const player of view.players) {
      if (player.extractionProgressMs <= 0) {
        continue;
      }
      const fraction = Math.min(1, player.extractionProgressMs / EXTRACTION_CHANNEL_MS);
      for (const point of view.extractionPoints) {
        const withinRadius =
          Math.hypot(player.x - point.x, player.y - point.y) < point.radius + player.radius;
        if (!withinRadius) {
          continue;
        }
        this.graphics.slice(
          point.x,
          point.y,
          point.radius,
          -Math.PI / 2,
          -Math.PI / 2 + fraction * Math.PI * 2,
        );
        this.graphics.fillPath();
      }
    }

    for (const enemy of view.enemies) {
      // Stunned (M3.5, `stunning_blows`): a dulled body color plus a small,
      // static "seeing stars" mark above the head — two independent cues so
      // the state reads clearly even for a colorblind-unfriendly palette.
      this.graphics.fillStyle(enemy.stunnedMs > 0 ? ENEMY_STUNNED_COLOR : ENEMY_COLOR, 1);
      this.graphics.fillCircle(enemy.x, enemy.y, enemy.radius);
      if (enemy.stunnedMs > 0) {
        this.drawStunMark(enemy.x, enemy.y - enemy.radius - 20);
      }

      const barX = enemy.x - ENEMY_HEALTH_BAR_WIDTH_PX / 2;
      const barY = enemy.y - enemy.radius - ENEMY_HEALTH_BAR_OFFSET_PX;
      const healthFraction = enemy.maxHealth > 0 ? enemy.health / enemy.maxHealth : 0;
      this.graphics.fillStyle(ENEMY_HEALTH_BAR_BACKGROUND, 1);
      this.graphics.fillRect(barX, barY, ENEMY_HEALTH_BAR_WIDTH_PX, ENEMY_HEALTH_BAR_HEIGHT_PX);
      this.graphics.fillStyle(ENEMY_HEALTH_BAR_FILL, 1);
      this.graphics.fillRect(
        barX,
        barY,
        ENEMY_HEALTH_BAR_WIDTH_PX * healthFraction,
        ENEMY_HEALTH_BAR_HEIGHT_PX,
      );
    }

    if (view.boss !== null) {
      this.drawBoss(view.boss);
    }

    const party = new Set(partyMemberIds);
    for (const player of view.players) {
      this.drawPlayer(player, player.id === localPlayerId, party.has(player.id));
    }
  }

  /** Draw the boss: its committed telegraph, body, phase ring, and health bar (M7). */
  private drawBoss(boss: BossView): void {
    const definition = findBoss(boss.definitionId);

    // The telegraph first, so the body sits on top of the shape rather than
    // under it.
    const attack = definition?.attacks[boss.telegraphAttackIndex];
    if (attack !== undefined && boss.telegraphRemainingMs > 0) {
      this.graphics.fillStyle(BOSS_TELEGRAPH_COLOR, BOSS_TELEGRAPH_ALPHA);
      if (attack.kind === "area") {
        this.graphics.fillCircle(boss.x, boss.y, attack.rangePx);
      } else {
        const halfArcRad = (attack.arcDegrees * Math.PI) / 360;
        this.graphics.slice(
          boss.x,
          boss.y,
          attack.rangePx,
          boss.telegraphFacing - halfArcRad,
          boss.telegraphFacing + halfArcRad,
        );
        this.graphics.fillPath();
      }
    }

    this.graphics.fillStyle(boss.enraged ? BOSS_ENRAGED_COLOR : BOSS_COLOR, 1);
    this.graphics.fillCircle(boss.x, boss.y, boss.radius);
    if (boss.enraged) {
      this.graphics.lineStyle(3, BOSS_ENRAGED_RING_COLOR, 1);
      this.graphics.strokeCircle(boss.x, boss.y, boss.radius + 6);
    }

    const barX = boss.x - BOSS_HEALTH_BAR_WIDTH_PX / 2;
    const barY = boss.y - boss.radius - BOSS_HEALTH_BAR_OFFSET_PX;
    const healthFraction = boss.maxHealth > 0 ? Math.max(0, boss.health / boss.maxHealth) : 0;
    this.graphics.fillStyle(ENEMY_HEALTH_BAR_BACKGROUND, 1);
    this.graphics.fillRect(barX, barY, BOSS_HEALTH_BAR_WIDTH_PX, BOSS_HEALTH_BAR_HEIGHT_PX);
    this.graphics.fillStyle(ENEMY_HEALTH_BAR_FILL, 1);
    this.graphics.fillRect(
      barX,
      barY,
      BOSS_HEALTH_BAR_WIDTH_PX * healthFraction,
      BOSS_HEALTH_BAR_HEIGHT_PX,
    );
  }

  /** Draw one player: their active swing, body, shield ring, party marker, and aim line. */
  private drawPlayer(player: PlayerView, isLocal: boolean, isPartyMember: boolean): void {
    // A player whose run has ended is no longer in the match; drawing their
    // body would suggest otherwise.
    if (player.runOver) {
      return;
    }

    if (player.swingActive) {
      const halfArcRad = (player.swingArcDegrees * Math.PI) / 360;
      this.graphics.fillStyle(MELEE_SWING_COLOR, MELEE_SWING_ALPHA);
      this.graphics.slice(
        player.swingOriginX,
        player.swingOriginY,
        player.swingRangePx,
        player.swingFacing - halfArcRad,
        player.swingFacing + halfArcRad,
      );
      this.graphics.fillPath();
    }

    const bodyColor = isLocal
      ? PLAYER_COLOR
      : player.connected
        ? REMOTE_PLAYER_COLOR
        : DISCONNECTED_PLAYER_COLOR;
    this.graphics.fillStyle(bodyColor, 1);
    this.graphics.fillCircle(player.x, player.y, player.radius);

    // Shield indicator (M3.5, `bulwark_strike`): a ring while any shield remains.
    if (player.shieldHp > 0) {
      this.graphics.lineStyle(3, SHIELD_RING_COLOR, 1);
      this.graphics.strokeCircle(player.x, player.y, player.radius + SHIELD_RING_OFFSET_PX);
    }

    if (isPartyMember) {
      const tipY = player.y - player.radius - PARTY_MARKER_OFFSET_PX;
      this.graphics.fillStyle(PARTY_MARKER_COLOR, 1);
      this.graphics.fillTriangle(
        player.x,
        tipY,
        player.x - PARTY_MARKER_HALF_WIDTH_PX,
        tipY + PARTY_MARKER_HEIGHT_PX,
        player.x + PARTY_MARKER_HALF_WIDTH_PX,
        tipY + PARTY_MARKER_HEIGHT_PX,
      );
    }

    this.graphics.lineStyle(2, AIM_LINE_COLOR, 1);
    this.graphics.lineBetween(
      player.x,
      player.y,
      player.x + Math.cos(player.facing) * AIM_LINE_LENGTH_PX,
      player.y + Math.sin(player.facing) * AIM_LINE_LENGTH_PX,
    );
  }

  /** Draw one projectile, composing the four skill-behavior cues described in the module doc. */
  private drawProjectile(projectile: ProjectileView): void {
    const { x, y } = projectile;
    const coreColor = projectile.homingStrength > 0 ? PROJECTILE_HOMING_COLOR : PROJECTILE_COLOR;

    // Pierce: a short trail opposite the direction of travel.
    if (projectile.piercesRemaining > 0) {
      const speed = Math.hypot(projectile.velocityX, projectile.velocityY);
      if (speed > 0) {
        const trailLength = projectile.radius * 2.5;
        const trailX = x - (projectile.velocityX / speed) * trailLength;
        const trailY = y - (projectile.velocityY / speed) * trailLength;
        this.graphics.lineStyle(2, PROJECTILE_PIERCE_TRAIL_COLOR, 0.85);
        this.graphics.lineBetween(x, y, trailX, trailY);
      }
    }

    // Return: an arrow silhouette along the direction of travel, instead of
    // a plain circle — otherwise the same core color rule applies.
    if (projectile.canReturn) {
      const angle = Math.atan2(projectile.velocityY, projectile.velocityX);
      const size = PROJECTILE_RETURN_ARROW_PX;
      const tip = { x: x + Math.cos(angle) * size, y: y + Math.sin(angle) * size };
      const backLeft = {
        x: x + Math.cos(angle + (Math.PI * 2) / 3) * size,
        y: y + Math.sin(angle + (Math.PI * 2) / 3) * size,
      };
      const backRight = {
        x: x + Math.cos(angle - (Math.PI * 2) / 3) * size,
        y: y + Math.sin(angle - (Math.PI * 2) / 3) * size,
      };
      this.graphics.fillStyle(coreColor, 1);
      this.graphics.beginPath();
      this.graphics.moveTo(tip.x, tip.y);
      this.graphics.lineTo(backLeft.x, backLeft.y);
      this.graphics.lineTo(backRight.x, backRight.y);
      this.graphics.closePath();
      this.graphics.fillPath();
    } else {
      this.graphics.fillStyle(coreColor, 1);
      this.graphics.fillCircle(x, y, projectile.radius);
    }

    // Bounce: an outline ring around the projectile.
    if (projectile.bouncesRemaining > 0) {
      this.graphics.lineStyle(2, PROJECTILE_BOUNCE_RING_COLOR, 1);
      this.graphics.strokeCircle(x, y, projectile.radius + 3);
    }
  }

  /** A small, static "seeing stars" mark (two crossed short lines) — the stun indicator. */
  private drawStunMark(centerX: number, centerY: number): void {
    this.graphics.lineStyle(2, ENEMY_STUN_MARK_COLOR, 1);
    const armPx = 5;
    this.graphics.lineBetween(centerX - armPx, centerY - armPx, centerX + armPx, centerY + armPx);
    this.graphics.lineBetween(centerX - armPx, centerY + armPx, centerX + armPx, centerY - armPx);
  }
}
