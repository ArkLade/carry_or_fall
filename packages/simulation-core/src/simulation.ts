/**
 * The headless, fixed-step local simulation (M1.1, `docs/M1_EXECUTION_PLAN.md`
 * §2.1, §2.2). This module — via `createSimulation`/`stepSimulation` — is the
 * single seam the client calls into; no game rule runs in Phaser scene code
 * (technical plan §5.1, §9.3). The simulation only ever advances by the fixed
 * `SIMULATION_DT_MS` step, never by an arbitrary render-frame delta.
 *
 * This chunk completes M1: the chaser enemy, player health/death, and dash.
 * `World.enemies` is now the single source of truth for attack targets — the
 * shared melee/ranged pipeline (`combat/pipeline.ts`) reads it directly since
 * `Enemy` satisfies `AttackTarget` structurally.
 */
import type { EnemyDefinition, WeaponDefinition } from "@carry-or-fall/game-content";

import { normalizeAngle } from "./angles";
import { buildWallGrid, resolveAxisMovement } from "./collision";
import {
  advanceMeleeAttack,
  isMeleeAttackFinished,
  meleePhase,
  resolveMeleeHits,
  startMeleeAttack,
} from "./combat/melee";
import type { HitEvent } from "./combat/events";
import type { AttackActor, AttackTarget } from "./combat/pipeline";
import { applyDamageAmount } from "./combat/pipeline";
import { startRangedAttack, stepProjectiles } from "./combat/ranged";
import { computeDashDelta, DASH_COOLDOWN_MS } from "./dash";
import {
  canDealContactDamage,
  CONTACT_DAMAGE_COOLDOWN_MS,
  spawnEnemy,
  stepEnemyMovement,
} from "./enemy";
import { computeMovementDelta } from "./movement";
import { createRng } from "./prng";
import type { Enemy, InputState, Vec2, Wall, World } from "./world";

/** The fixed simulation step, in milliseconds (technical plan §9.3). */
export const SIMULATION_DT_MS = 50;

const SIMULATION_DT_SECONDS = SIMULATION_DT_MS / 1000;

/**
 * Player collision radius, in pixels. Proposed for M1 (not specified
 * numerically in the authoritative documents); balance-deferred like
 * `movement.ts`'s `PLAYER_SPEED`.
 */
export const PLAYER_RADIUS = 16;

/** Player starting/maximum health. Proposed and balance-deferred (M1.10). */
export const PLAYER_MAX_HEALTH = 100;

/** Enemy collision radius, in pixels. Proposed and balance-deferred (M1.9), like {@link PLAYER_RADIUS}. */
export const ENEMY_RADIUS = 18;

/** Initial conditions for a fresh local simulation world. */
export interface SimulationConfig {
  readonly walls: readonly Wall[];
  readonly playerStart: Vec2;
  /** The player's equipped melee weapon (left mouse button; see `PlayScene`). */
  readonly meleeWeapon: WeaponDefinition;
  /** The player's equipped ranged weapon (right mouse button; see `PlayScene`). */
  readonly rangedWeapon: WeaponDefinition;
  /** The one M1 enemy's content definition (the chaser). */
  readonly enemyDefinition: EnemyDefinition;
  /** Candidate spawn points; one is chosen via the seeded PRNG (M1.9 requirement 4). */
  readonly enemySpawnPoints: readonly Vec2[];
  /** Seeds the PRNG used for enemy spawn selection, for reproducibility (technical plan §9.4). */
  readonly seed: number;
}

/**
 * Build the initial `World` for a local run: the player at `playerStart`,
 * the static map walls, and one chaser enemy spawned deterministically from
 * `config.seed`.
 */
export function createSimulation(config: SimulationConfig): World {
  const rng = createRng(config.seed);
  const enemy = spawnEnemy(config.enemyDefinition, config.enemySpawnPoints, rng, ENEMY_RADIUS, 0);

  return {
    player: {
      position: config.playerStart,
      radius: PLAYER_RADIUS,
      facing: 0,
      health: PLAYER_MAX_HEALTH,
      maxHealth: PLAYER_MAX_HEALTH,
      alive: true,
      meleeWeapon: config.meleeWeapon,
      rangedWeapon: config.rangedWeapon,
      meleeCooldownMs: 0,
      rangedCooldownMs: 0,
      meleeAttack: null,
      dashCooldownMs: 0,
    },
    walls: config.walls,
    projectiles: [],
    enemies: [enemy],
    tick: 0,
  };
}

/** The result of advancing one fixed step: the new world and any hit events to render. */
export interface StepResult {
  readonly world: World;
  readonly hitEvents: readonly HitEvent[];
}

/**
 * Advance the world by exactly one fixed step: movement + collision, dash,
 * aim, cooldowns, the melee/ranged attack pipeline against `world.enemies`,
 * and the chaser's own movement + contact damage. Once the player's health
 * reaches zero, every subsequent call is a full no-op (M1.10: "stop
 * movement/attack processing, and end the run") — the caller (`PlayScene`)
 * is expected to stop calling this once `!world.player.alive`, but the
 * engine enforces it either way.
 */
export function stepSimulation(world: World, input: InputState): StepResult {
  if (!world.player.alive) {
    return { world, hitEvents: [] };
  }

  const grid = buildWallGrid(world.walls);
  let player = world.player;

  // Movement + collision (M1.3/M1.5, unchanged from the prior chunk).
  const moveDelta = computeMovementDelta(input, SIMULATION_DT_SECONDS);
  const movedX = resolveAxisMovement(player.position, "x", moveDelta.x, player.radius, grid);
  const afterMoveX: Vec2 = { x: movedX, y: player.position.y };
  const movedY = resolveAxisMovement(afterMoveX, "y", moveDelta.y, player.radius, grid);
  player = { ...player, position: { x: movedX, y: movedY } };

  // Dash (M1.S1): an instant displacement resolved through the same
  // wall-aware movement, on top of the ordinary move this same step.
  if (input.dashPressed && player.dashCooldownMs <= 0) {
    const dashDelta = computeDashDelta(input, player.facing);
    const dashedX = resolveAxisMovement(player.position, "x", dashDelta.x, player.radius, grid);
    const afterDashX: Vec2 = { x: dashedX, y: player.position.y };
    const dashedY = resolveAxisMovement(afterDashX, "y", dashDelta.y, player.radius, grid);
    player = {
      ...player,
      position: { x: dashedX, y: dashedY },
      dashCooldownMs: DASH_COOLDOWN_MS,
    };
  }

  // Aim/facing (M1.4): normalize to a bounded range; ignore a non-finite input
  // rather than corrupting facing with it.
  if (Number.isFinite(input.aimAngle)) {
    player = { ...player, facing: normalizeAngle(input.aimAngle) };
  }

  // Cooldowns tick down every step regardless of input.
  player = {
    ...player,
    meleeCooldownMs: Math.max(0, player.meleeCooldownMs - SIMULATION_DT_MS),
    rangedCooldownMs: Math.max(0, player.rangedCooldownMs - SIMULATION_DT_MS),
    dashCooldownMs: Math.max(0, player.dashCooldownMs - SIMULATION_DT_MS),
  };

  const actor: AttackActor = {
    position: player.position,
    facing: player.facing,
    radius: player.radius,
  };
  // `Enemy` satisfies `AttackTarget` structurally (id/position/radius/health
  // plus its own stats), so the live enemy collection is the target list.
  let workingTargets: readonly AttackTarget[] = world.enemies;
  let hitEvents: readonly HitEvent[] = [];
  let projectiles = world.projectiles;

  // Melee (M1.6/M1.7): start a new swing, or advance an in-flight one and
  // resolve its hits exactly once, when it first enters the active window.
  if (player.meleeAttack === null) {
    if (input.attackPressed) {
      const startResult = startMeleeAttack(actor, player.meleeWeapon, player.meleeCooldownMs);
      if (startResult.started) {
        player = {
          ...player,
          meleeAttack: startResult.state,
          meleeCooldownMs: player.meleeWeapon.attackIntervalMs,
        };
      }
    }
  } else {
    let meleeAttack = advanceMeleeAttack(player.meleeAttack, SIMULATION_DT_MS);
    if (!meleeAttack.hasResolvedHits && meleePhase(meleeAttack) === "active") {
      const resolved = resolveMeleeHits(meleeAttack, workingTargets);
      workingTargets = resolved.updatedTargets;
      hitEvents = [...hitEvents, ...resolved.hitEvents];
      meleeAttack = { ...meleeAttack, hasResolvedHits: true };
    }
    player = { ...player, meleeAttack: isMeleeAttackFinished(meleeAttack) ? null : meleeAttack };
  }

  // Ranged (M1.6/M1.8): fire a new volley; the shared hard caps (`caps.ts`)
  // are enforced inside `startRangedAttack`.
  if (input.secondaryAttackPressed) {
    const fireResult = startRangedAttack(
      actor,
      player.rangedWeapon,
      player.rangedCooldownMs,
      projectiles.length,
      world.tick,
    );
    if (fireResult.started) {
      projectiles = [...projectiles, ...fireResult.projectiles];
      player = { ...player, rangedCooldownMs: player.rangedWeapon.attackIntervalMs };
    }
  }

  // Advance every live projectile: move, resolve a hit or expire. Projectiles
  // do not collide with walls — a known, deliberately deferred defect
  // (`docs/M1_ISSUES.md` D-1); not fixed or worked around here.
  const projectileStep = stepProjectiles(
    projectiles,
    SIMULATION_DT_MS,
    SIMULATION_DT_SECONDS,
    workingTargets,
  );
  projectiles = projectileStep.projectiles;
  workingTargets = projectileStep.updatedTargets;
  hitEvents = [...hitEvents, ...projectileStep.hitEvents];

  // Merge combat-resolved health back into the enemy collection and remove
  // anything at zero health (M1.9 requirement 3: "dies ... and is removed").
  let enemies: Enemy[] = world.enemies
    .map((enemy) => {
      const updated = workingTargets.find((target) => target.id === enemy.id);
      return updated ? { ...enemy, health: updated.health } : enemy;
    })
    .filter((enemy) => enemy.health > 0);

  // Chaser movement + contact damage (M1.9/M1.10). Enemies killed above are
  // already removed, so a dead enemy cannot also deal contact damage this step.
  let playerHealth = player.health;
  let playerAlive = player.alive;
  enemies = enemies.map((enemy) => {
    const moved = stepEnemyMovement(
      enemy,
      player.position,
      SIMULATION_DT_MS,
      SIMULATION_DT_SECONDS,
      grid,
    );
    if (playerAlive && canDealContactDamage(moved, player)) {
      playerHealth = applyDamageAmount(playerHealth, moved.contactDamage);
      if (playerHealth <= 0) {
        playerAlive = false;
      }
      return { ...moved, contactCooldownMs: CONTACT_DAMAGE_COOLDOWN_MS };
    }
    return moved;
  });
  player = { ...player, health: playerHealth, alive: playerAlive };

  return {
    world: { ...world, player, projectiles, enemies, tick: world.tick + 1 },
    hitEvents,
  };
}
