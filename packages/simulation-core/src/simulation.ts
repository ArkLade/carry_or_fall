/**
 * The headless, fixed-step local simulation (M1.1, `docs/M1_EXECUTION_PLAN.md`
 * §2.1, §2.2). This module — via `createSimulation`/`stepSimulation` — is the
 * single seam the client calls into; no game rule runs in Phaser scene code
 * (technical plan §5.1, §9.3). The simulation only ever advances by the fixed
 * `SIMULATION_DT_MS` step, never by an arbitrary render-frame delta.
 *
 * M1 shipped the chaser enemy, player health/death, and dash. M2 (`docs/
 * M2_ISSUES.md`) adds the six-slot inventory, the secure slot, carried-loot
 * build effects, ground loot (from kills and scattered at run start),
 * rotating extraction, and the local run result. `World.enemies` is the
 * single source of truth for attack targets — the shared melee/ranged
 * pipeline (`combat/pipeline.ts`) reads it directly since `Enemy` satisfies
 * `AttackTarget` structurally.
 */
import type { EnemyDefinition, WeaponDefinition } from "@carry-or-fall/game-content";

import { normalizeAngle } from "./angles";
import { aggregateBuildEffects, effectiveMaxHealth, effectiveMoveSpeed } from "./build-effects";
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
import { canDealContactDamage, spawnEnemy, stepEnemyMovement } from "./enemy";
import {
  EXTRACTION_CHANNEL_MS,
  findActiveExtractionPoint,
  spawnExtractionPoints,
  stepExtractionPoints,
} from "./extraction";
import { createEmptyInventory, discardInventorySlot, secureItem } from "./inventory";
import { attemptPickup, chooseLootDrop, isNearGroundLoot, spawnGroundLoot } from "./loot-drop";
import { computeMovementDelta, PLAYER_SPEED } from "./movement";
import { createRng } from "./prng";
import { buildDeathResult, buildExtractionResult } from "./run-result";
import type { Enemy, GroundLoot, InputState, RunResult, Vec2, Wall, World } from "./world";

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
  /**
   * Ground loot scattered on the map at run start (M2.6), one per point, so a
   * single short local run has enough loot to exercise the six-slot
   * inventory/secure slot beyond the one chaser's single drop. Defaults to
   * none.
   */
  readonly groundLootSpawnPoints?: readonly Vec2[];
  /**
   * Candidate locations extraction points rotate among (M2.7); must have at
   * least `extraction.ts`'s `ACTIVE_EXTRACTION_POINT_COUNT` (2) entries.
   */
  readonly extractionCandidatePoints: readonly Vec2[];
  /** Seeds the PRNG used for enemy spawn/loot/extraction selection (technical plan §9.4). */
  readonly seed: number;
}

/**
 * Build the initial `World` for a local run: the player at `playerStart`,
 * the static map walls, one chaser enemy, scattered ground loot, and the
 * initial active extraction points — all spawned deterministically from
 * `config.seed`.
 */
export function createSimulation(config: SimulationConfig): World {
  const rng = createRng(config.seed);
  const enemy = spawnEnemy(config.enemyDefinition, config.enemySpawnPoints, rng, ENEMY_RADIUS, 0);
  const groundLootSpawnPoints = config.groundLootSpawnPoints ?? [];
  const groundLoot: GroundLoot[] = groundLootSpawnPoints.map((position, index) =>
    spawnGroundLoot(chooseLootDrop(rng), position, `loot-start-${String(index)}`),
  );
  const extractionPoints = spawnExtractionPoints(config.extractionCandidatePoints, rng);

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
      inventory: createEmptyInventory(),
      secureSlot: null,
      extractionProgressMs: 0,
    },
    walls: config.walls,
    projectiles: [],
    enemies: [enemy],
    groundLoot,
    extractionPoints,
    extractionCandidatePoints: config.extractionCandidatePoints,
    runResult: null,
    rng,
    tick: 0,
  };
}

/** The result of advancing one fixed step: the new world and any hit events to render. */
export interface StepResult {
  readonly world: World;
  readonly hitEvents: readonly HitEvent[];
}

/**
 * Advance the world by exactly one fixed step: inventory intents, movement +
 * collision, dash, aim, cooldowns, the melee/ranged attack pipeline (with
 * carried-loot build effects applied) against `world.enemies`, the chaser's
 * own movement + contact damage, ground-loot pickup, extraction-point
 * rotation and channeling, and run-ending. Once the player's health reaches
 * zero or a `runResult` has been recorded, every subsequent call is a full
 * no-op (M1.10/M2.8) — the caller (`PlayScene`) is expected to stop calling
 * this once the run has ended, but the engine enforces it either way.
 */
export function stepSimulation(world: World, input: InputState): StepResult {
  if (!world.player.alive || world.runResult !== null) {
    return { world, hitEvents: [] };
  }

  const grid = buildWallGrid(world.walls);
  let player = world.player;

  // Inventory intents (M2.2/M2.5): one-shot discard/secure requests, applied
  // before this step's build effects are aggregated so a change takes effect
  // the same step it was requested.
  if (input.discardSlotIndex !== null) {
    player = {
      ...player,
      inventory: discardInventorySlot(player.inventory, input.discardSlotIndex),
    };
  }
  if (input.secureSlotIndex !== null) {
    const secureResult = secureItem(player.inventory, input.secureSlotIndex, player.secureSlot);
    player = { ...player, inventory: secureResult.inventory, secureSlot: secureResult.secureSlot };
  }

  // Carried-loot build effects (M2.4): aggregated once per step from the
  // inventory (never the secure slot) and applied to movement, max health,
  // and this step's attacks.
  const buildEffects = aggregateBuildEffects(player.inventory);
  const maxHealth = effectiveMaxHealth(PLAYER_MAX_HEALTH, buildEffects);
  player = { ...player, maxHealth, health: Math.min(player.health, maxHealth) };

  // Movement + collision (M1.3/M1.5), at the carried-loot-adjusted move speed.
  const speed = effectiveMoveSpeed(PLAYER_SPEED, buildEffects);
  const moveDelta = computeMovementDelta(input, SIMULATION_DT_SECONDS, speed);
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

  // Melee (M1.6/M1.7, carried-loot effects M2.4): start a new swing, or
  // advance an in-flight one and resolve its hits exactly once, when it
  // first enters the active window.
  if (player.meleeAttack === null) {
    if (input.attackPressed) {
      const startResult = startMeleeAttack(
        actor,
        player.meleeWeapon,
        player.meleeCooldownMs,
        buildEffects,
      );
      if (startResult.started) {
        player = {
          ...player,
          meleeAttack: startResult.state,
          // The effective (post-carried-loot) interval, so an attack-speed
          // bonus actually shortens the next cooldown (`docs/M2_ISSUES.md` M2.4).
          meleeCooldownMs: startResult.state.weapon.attackIntervalMs,
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

  // Ranged (M1.6/M1.8, carried-loot effects M2.4): fire a new volley; the
  // shared hard caps (`caps.ts`) are enforced inside `startRangedAttack`.
  if (input.secondaryAttackPressed) {
    const fireResult = startRangedAttack(
      actor,
      player.rangedWeapon,
      player.rangedCooldownMs,
      projectiles.length,
      world.tick,
      buildEffects,
    );
    if (fireResult.started) {
      projectiles = [...projectiles, ...fireResult.projectiles];
      player = { ...player, rangedCooldownMs: fireResult.attackIntervalMs };
    }
  }

  // Advance every live projectile: move, resolve against a wall (swept,
  // D-1) or a target, or expire.
  const projectileStep = stepProjectiles(
    projectiles,
    SIMULATION_DT_MS,
    SIMULATION_DT_SECONDS,
    workingTargets,
    grid,
  );
  projectiles = projectileStep.projectiles;
  workingTargets = projectileStep.updatedTargets;
  hitEvents = [...hitEvents, ...projectileStep.hitEvents];

  // Merge combat-resolved health back into the enemy collection, split into
  // survivors and this step's kills (M1.9 requirement 3: "dies ... and is
  // removed"; M2.6: a kill drops loot).
  const mergedEnemies: Enemy[] = world.enemies.map((enemy) => {
    const updated = workingTargets.find((target) => target.id === enemy.id);
    return updated ? { ...enemy, health: updated.health } : enemy;
  });
  const killedThisStep = mergedEnemies.filter((enemy) => enemy.health <= 0);
  let enemies: Enemy[] = mergedEnemies.filter((enemy) => enemy.health > 0);

  let groundLoot = world.groundLoot;
  for (const killed of killedThisStep) {
    const definition = chooseLootDrop(world.rng);
    groundLoot = [...groundLoot, spawnGroundLoot(definition, killed.position, `loot-${killed.id}`)];
  }

  // Chaser movement + contact damage (M1.9/M1.10). Enemies killed above are
  // already removed, so a dead enemy cannot also deal contact damage this step.
  let playerHealth = player.health;
  let playerAlive = player.alive;
  let tookContactDamageThisStep = false;
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
      tookContactDamageThisStep = true;
      if (playerHealth <= 0) {
        playerAlive = false;
      }
      return { ...moved, contactCooldownMs: moved.contactDamageIntervalMs };
    }
    return moved;
  });
  player = { ...player, health: playerHealth, alive: playerAlive };

  // Ground-loot pickup (M2.6): while interact is held and the player
  // overlaps a ground-loot entity, attempt to add it to the inventory;
  // refused (item stays put) when the inventory is full.
  if (input.interactPressed && playerAlive) {
    const nearby = groundLoot.find((loot) => isNearGroundLoot(player, loot));
    if (nearby !== undefined) {
      const pickup = attemptPickup(player.inventory, nearby);
      if (pickup.pickedUp) {
        player = { ...player, inventory: pickup.inventory };
        groundLoot = groundLoot.filter((loot) => loot.id !== nearby.id);
      }
    }
  }

  // Rotating extraction points (M2.7): advance the rotation timer, then
  // determine whether the player is channeling this step.
  const extractionPoints = stepExtractionPoints(
    world.extractionPoints,
    SIMULATION_DT_MS,
    world.extractionCandidatePoints,
    world.rng,
  );
  const withinExtractionPoint = findActiveExtractionPoint(player, extractionPoints);
  const isChanneling =
    playerAlive &&
    !tookContactDamageThisStep &&
    input.interactPressed &&
    withinExtractionPoint !== null;
  const extractionProgressMs = isChanneling ? player.extractionProgressMs + SIMULATION_DT_MS : 0;
  player = { ...player, extractionProgressMs };

  // Run ending (M2.8): death or a completed extraction channel both end the
  // run, converting carried loot differently.
  let runResult: RunResult | null = world.runResult;
  if (!playerAlive) {
    runResult = buildDeathResult(player.inventory, player.secureSlot);
    groundLoot = [
      ...groundLoot,
      ...player.inventory
        .filter((item): item is NonNullable<typeof item> => item !== null)
        .map((item, index) =>
          spawnGroundLoot(item, player.position, `loot-death-${String(index)}`),
        ),
    ];
    player = { ...player, inventory: createEmptyInventory(), secureSlot: null };
  } else if (extractionProgressMs >= EXTRACTION_CHANNEL_MS) {
    runResult = buildExtractionResult(player.inventory, player.secureSlot);
    player = { ...player, inventory: createEmptyInventory(), secureSlot: null };
  }

  return {
    world: {
      ...world,
      player,
      projectiles,
      enemies,
      groundLoot,
      extractionPoints,
      runResult,
      tick: world.tick + 1,
    },
    hitEvents,
  };
}
