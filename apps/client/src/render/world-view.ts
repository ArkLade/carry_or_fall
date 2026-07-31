/**
 * Renders the simulation `World` (walls, player, aim, an in-flight melee
 * swing, projectiles, enemies, ground loot, skill chips, and extraction
 * points) each frame. This is a pure read of simulation state (technical
 * plan §5.1) — it draws what `simulation-core` already decided and never
 * computes a game rule itself (`docs/M1_EXECUTION_PLAN.md` invariant 2).
 * M3.8 (`docs/M3_ISSUES.md`) adds skill-chip rendering (visually distinct
 * from ground loot) and a shield ring around the player while `shieldHp > 0`.
 *
 * Per-projectile skill-behavior rendering (concept §13.3 "distinguishable...
 * attacks", "obvious damage sources"; must avoid "large opaque effects" and
 * "unreadable projectile spam") uses four independent, composable channels —
 * simple silhouettes and outlines, no particles, no animation — so any
 * combination of bounce/pierce/return/homing on the same projectile (M3.6
 * proved these can all stack) stays readable at a glance:
 *
 * - **homing** → the projectile's core fill color shifts (pink vs. the
 *   default gold).
 * - **return** → the core shape becomes a small arrow pointing along its
 *   direction of travel, instead of a plain circle.
 * - **pierce** → a short trailing line behind the projectile.
 * - **bounce** → an outline ring around the projectile.
 */
import Phaser from "phaser";
import {
  EXTRACTION_CHANNEL_MS,
  meleePhase,
  type Projectile,
  type World,
} from "@carry-or-fall/simulation-core";

const WALL_COLOR = 0x30363d;
const PLAYER_COLOR = 0x58a6ff;
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

    for (const projectile of world.projectiles) {
      this.drawProjectile(projectile);
    }

    this.graphics.fillStyle(GROUND_LOOT_COLOR, 1);
    for (const loot of world.groundLoot) {
      this.graphics.fillCircle(loot.position.x, loot.position.y, 8);
    }

    // Skill chips (M3.7): a diamond, visually distinct from ground loot's circle.
    this.graphics.fillStyle(SKILL_CHIP_COLOR, 1);
    for (const chip of world.skillChips) {
      const { x, y } = chip.position;
      const size = 9;
      this.graphics.beginPath();
      this.graphics.moveTo(x, y - size);
      this.graphics.lineTo(x + size, y);
      this.graphics.lineTo(x, y + size);
      this.graphics.lineTo(x - size, y);
      this.graphics.closePath();
      this.graphics.fillPath();
    }

    this.graphics.lineStyle(3, EXTRACTION_RING_COLOR, 1);
    for (const point of world.extractionPoints) {
      this.graphics.strokeCircle(point.position.x, point.position.y, point.radius);
    }
    // The local player's own channel progress, drawn as a filling wedge over
    // whichever extraction point it applies to (concept §13.3 "clear
    // extraction effects"). `World` has no per-point channeling id (M2 is
    // single-player, so there is at most one channeling player), so this
    // draws on every point the player currently overlaps — in practice at
    // most one, since the two active points do not overlap each other.
    if (world.player.extractionProgressMs > 0) {
      const fraction = Math.min(1, world.player.extractionProgressMs / EXTRACTION_CHANNEL_MS);
      this.graphics.fillStyle(EXTRACTION_CHANNEL_FILL_COLOR, EXTRACTION_CHANNEL_FILL_ALPHA);
      for (const point of world.extractionPoints) {
        const dx = world.player.position.x - point.position.x;
        const dy = world.player.position.y - point.position.y;
        const withinRadius = Math.hypot(dx, dy) < point.radius + world.player.radius;
        if (!withinRadius) {
          continue;
        }
        this.graphics.slice(
          point.position.x,
          point.position.y,
          point.radius,
          -Math.PI / 2,
          -Math.PI / 2 + fraction * Math.PI * 2,
        );
        this.graphics.fillPath();
      }
    }

    for (const enemy of world.enemies) {
      // Stunned (M3.5, `stunning_blows`): a dulled body color plus a small,
      // static "seeing stars" mark above the head — two independent cues so
      // the state reads clearly even for a colorblind-unfriendly palette.
      this.graphics.fillStyle(enemy.stunnedMs > 0 ? ENEMY_STUNNED_COLOR : ENEMY_COLOR, 1);
      this.graphics.fillCircle(enemy.position.x, enemy.position.y, enemy.radius);
      if (enemy.stunnedMs > 0) {
        this.drawStunMark(enemy.position.x, enemy.position.y - enemy.radius - 20);
      }

      const barX = enemy.position.x - ENEMY_HEALTH_BAR_WIDTH_PX / 2;
      const barY = enemy.position.y - enemy.radius - ENEMY_HEALTH_BAR_OFFSET_PX;
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

    // Shield indicator (M3.5, `bulwark_strike`): a ring around the player
    // while any shield remains.
    if (player.shieldHp > 0) {
      this.graphics.lineStyle(3, SHIELD_RING_COLOR, 1);
      this.graphics.strokeCircle(
        player.position.x,
        player.position.y,
        player.radius + SHIELD_RING_OFFSET_PX,
      );
    }

    this.graphics.lineStyle(2, AIM_LINE_COLOR, 1);
    this.graphics.lineBetween(
      player.position.x,
      player.position.y,
      player.position.x + Math.cos(player.facing) * AIM_LINE_LENGTH_PX,
      player.position.y + Math.sin(player.facing) * AIM_LINE_LENGTH_PX,
    );
  }

  /** Draw one projectile, composing the four skill-behavior cues described in the module doc. */
  private drawProjectile(projectile: Projectile): void {
    const { x, y } = projectile.position;
    const coreColor = projectile.homingStrength > 0 ? PROJECTILE_HOMING_COLOR : PROJECTILE_COLOR;

    // Pierce: a short trail opposite the direction of travel.
    if (projectile.piercesRemaining > 0) {
      const speed = Math.hypot(projectile.velocity.x, projectile.velocity.y);
      if (speed > 0) {
        const trailLength = projectile.radius * 2.5;
        const trailX = x - (projectile.velocity.x / speed) * trailLength;
        const trailY = y - (projectile.velocity.y / speed) * trailLength;
        this.graphics.lineStyle(2, PROJECTILE_PIERCE_TRAIL_COLOR, 0.85);
        this.graphics.lineBetween(x, y, trailX, trailY);
      }
    }

    // Return: an arrow silhouette along the direction of travel, instead of
    // a plain circle — otherwise the same core color rule applies.
    if (projectile.canReturn) {
      const angle = Math.atan2(projectile.velocity.y, projectile.velocity.x);
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
