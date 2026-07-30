/**
 * The headless, fixed-step local simulation (M1.1, `docs/M1_EXECUTION_PLAN.md`
 * §2.1, §2.2). This module — via `createSimulation`/`stepSimulation` — is the
 * single seam the client calls into; no game rule runs in Phaser scene code
 * (technical plan §5.1, §9.3). The simulation only ever advances by the fixed
 * `SIMULATION_DT_MS` step, never by an arbitrary render-frame delta.
 *
 * This chunk adds aim, and the shared attack pipeline driving the sword
 * (melee) and bow (ranged) — see `combat/pipeline.ts`, `combat/melee.ts`,
 * `combat/ranged.ts`. There is still no enemy, health, death, HUD, or dash;
 * `targets` is supplied by the caller (empty in the live client, non-empty
 * fixtures in tests) since `World` has no enemy collection yet.
 */
import type { WeaponDefinition } from "@carry-or-fall/game-content";

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
import { startRangedAttack, stepProjectiles } from "./combat/ranged";
import { computeMovementDelta } from "./movement";
import type { InputState, Vec2, Wall, World } from "./world";

/** The fixed simulation step, in milliseconds (technical plan §9.3). */
export const SIMULATION_DT_MS = 50;

const SIMULATION_DT_SECONDS = SIMULATION_DT_MS / 1000;

/**
 * Player collision radius, in pixels. Proposed for M1 (not specified
 * numerically in the authoritative documents); balance-deferred like
 * `movement.ts`'s `PLAYER_SPEED`.
 */
export const PLAYER_RADIUS = 16;

/** Initial conditions for a fresh local simulation world. */
export interface SimulationConfig {
  readonly walls: readonly Wall[];
  readonly playerStart: Vec2;
  /** The player's equipped melee weapon (left mouse button; see `PlayScene`). */
  readonly meleeWeapon: WeaponDefinition;
  /** The player's equipped ranged weapon (right mouse button; see `PlayScene`). */
  readonly rangedWeapon: WeaponDefinition;
}

/** Build the initial `World` for a local run: the player at `playerStart`, plus the static map walls. */
export function createSimulation(config: SimulationConfig): World {
  return {
    player: {
      position: config.playerStart,
      radius: PLAYER_RADIUS,
      facing: 0,
      meleeWeapon: config.meleeWeapon,
      rangedWeapon: config.rangedWeapon,
      meleeCooldownMs: 0,
      rangedCooldownMs: 0,
      meleeAttack: null,
    },
    walls: config.walls,
    projectiles: [],
    tick: 0,
  };
}

/** The result of advancing one fixed step: the new world, the (possibly damaged) targets, and any hit events to render. */
export interface StepResult {
  readonly world: World;
  readonly targets: readonly AttackTarget[];
  readonly hitEvents: readonly HitEvent[];
}

/**
 * Advance the world by exactly one fixed step: movement + collision, aim,
 * cooldowns, and the melee/ranged attack pipeline. `targets` defaults to
 * empty — M1 has no enemy in the running game, so hit resolution only ever
 * does something when a caller (a test) supplies fixture targets.
 */
export function stepSimulation(
  world: World,
  input: InputState,
  targets: readonly AttackTarget[] = [],
): StepResult {
  const grid = buildWallGrid(world.walls);
  let player = world.player;

  // Movement + collision (M1.3/M1.5, unchanged from the prior chunk).
  const moveDelta = computeMovementDelta(input, SIMULATION_DT_SECONDS);
  const x = resolveAxisMovement(player.position, "x", moveDelta.x, player.radius, grid);
  const afterX: Vec2 = { x, y: player.position.y };
  const y = resolveAxisMovement(afterX, "y", moveDelta.y, player.radius, grid);
  player = { ...player, position: { x, y } };

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
  };

  const actor: AttackActor = {
    position: player.position,
    facing: player.facing,
    radius: player.radius,
  };
  let workingTargets = targets;
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

  // Advance every live projectile: move, resolve a hit or expire.
  const projectileStep = stepProjectiles(
    projectiles,
    SIMULATION_DT_MS,
    SIMULATION_DT_SECONDS,
    workingTargets,
  );
  projectiles = projectileStep.projectiles;
  workingTargets = projectileStep.updatedTargets;
  hitEvents = [...hitEvents, ...projectileStep.hitEvents];

  return {
    world: { ...world, player, projectiles, tick: world.tick + 1 },
    targets: workingTargets,
    hitEvents,
  };
}
