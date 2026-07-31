/**
 * The headless, fixed-step local simulation (M1.1, `docs/M1_EXECUTION_PLAN.md`
 * §2.1, §2.2). This module — via `createSimulation`/`stepSimulation` — is the
 * single seam the client calls into; no game rule runs in Phaser scene code
 * (technical plan §5.1, §9.3). The simulation only ever advances by the fixed
 * `SIMULATION_DT_MS` step, never by an arbitrary render-frame delta.
 *
 * M1 shipped the chaser enemy, player health/death, and dash. M2 (`docs/
 * M2_ISSUES.md`) added the six-slot inventory, the secure slot, carried-loot
 * build effects, ground loot, rotating extraction, and the local run result.
 * M3 (`docs/M3_ISSUES.md`) adds the permanent skill loadout, the wildcard
 * skill chip, per-attack skill-effect aggregation (feeding
 * `combat/pipeline.ts`'s stage 4), stun, and the player shield. `World.enemies`
 * is the single source of truth for attack targets — the shared melee/ranged
 * pipeline (`combat/pipeline.ts`) reads it directly since `Enemy` satisfies
 * `AttackTarget` structurally.
 */
import type {
  EnemyDefinition,
  SkillDefinition,
  WeaponDefinition,
} from "@carry-or-fall/game-content";

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
import { startRangedAttack, stepProjectiles } from "./combat/ranged";
import { computeDashDelta, DASH_COOLDOWN_MS } from "./dash";
import { canDealContactDamage, spawnEnemies, stepEnemyMovement } from "./enemy";
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
import { chooseSkillChipDrop, isNearSkillChip, spawnSkillChip } from "./skill-chip";
import {
  aggregateSkillEffects,
  applyDamageToPlayer,
  grantShield,
  STUN_DURATION_MS,
} from "./skill-effects";
import { EMPTY_SKILL_LOADOUT, type SkillLoadout } from "./skill-loadout";
import type {
  Enemy,
  GroundLoot,
  InputState,
  RunResult,
  SkillChip,
  Vec2,
  Wall,
  World,
} from "./world";

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
  /** The enemy content definition every spawned enemy is built from (the chaser). */
  readonly enemyDefinition: EnemyDefinition;
  /**
   * Candidate spawn points; {@link SimulationConfig.enemyCount} of them are
   * chosen — distinctly — via the seeded PRNG (M1.9 requirement 4). Must hold
   * at least `enemyCount` entries.
   */
  readonly enemySpawnPoints: readonly Vec2[];
  /**
   * How many enemies to spawn, each at a distinct `enemySpawnPoints` entry.
   * Defaults to 1, preserving M1's single-chaser world for every existing
   * caller. Raised to 3 by the local test map (`PlayScene`) for M4 prep,
   * because one enemy left combat too thin to exercise skills, stun, or
   * shield in a playtest.
   */
  readonly enemyCount?: number;
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
  /**
   * The player's pre-run permanent skill loadout (M3.2), already validated by
   * `skill-loadout.ts`'s `createSkillLoadout` — an invalid selection never
   * reaches this boundary. Defaults to {@link EMPTY_SKILL_LOADOUT}.
   */
  readonly skillLoadout?: SkillLoadout;
  /**
   * Wildcard skill chips scattered on the map at run start (M3.7), one per
   * point, mirroring `groundLootSpawnPoints`. Defaults to none.
   */
  readonly skillChipSpawnPoints?: readonly Vec2[];
  /** Seeds the PRNG used for enemy spawn/loot/extraction/skill-chip selection (technical plan §9.4). */
  readonly seed: number;
}

/**
 * Build the initial `World` for a local run: the player at `playerStart`,
 * the static map walls, `config.enemyCount` chaser enemies at distinct spawn
 * points, scattered ground loot and skill chips, and the initial active
 * extraction points — all spawned deterministically from `config.seed`.
 */
export function createSimulation(config: SimulationConfig): World {
  const rng = createRng(config.seed);
  const enemies = spawnEnemies(
    config.enemyDefinition,
    config.enemySpawnPoints,
    rng,
    ENEMY_RADIUS,
    config.enemyCount ?? 1,
  );
  const groundLootSpawnPoints = config.groundLootSpawnPoints ?? [];
  const groundLoot: GroundLoot[] = groundLootSpawnPoints.map((position, index) =>
    spawnGroundLoot(chooseLootDrop(rng), position, `loot-start-${String(index)}`),
  );
  const skillChipSpawnPoints = config.skillChipSpawnPoints ?? [];
  const skillChips: SkillChip[] = skillChipSpawnPoints.map((position, index) =>
    spawnSkillChip(chooseSkillChipDrop(rng), position, `chip-start-${String(index)}`),
  );
  const extractionPoints = spawnExtractionPoints(config.extractionCandidatePoints, rng);

  return {
    player: {
      position: config.playerStart,
      radius: PLAYER_RADIUS,
      facing: 0,
      health: PLAYER_MAX_HEALTH,
      maxHealth: PLAYER_MAX_HEALTH,
      shieldHp: 0,
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
      skillLoadout: config.skillLoadout ?? EMPTY_SKILL_LOADOUT,
      wildcardSkill: null,
    },
    walls: config.walls,
    projectiles: [],
    enemies,
    groundLoot,
    skillChips,
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
 * per-attack skill-effect aggregation and carried-loot build effects
 * applied) against `world.enemies`, the chaser's own movement + shield-aware
 * contact damage, ground-loot/skill-chip pickup, extraction-point rotation
 * and channeling, and run-ending. Once the player's health reaches zero or a
 * `runResult` has been recorded, every subsequent call is a full no-op
 * (M1.10/M2.8) — the caller (`PlayScene`) is expected to stop calling this
 * once the run has ended, but the engine enforces it either way.
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

  // Skill-effect aggregation (M3.3): the player's active skills are the
  // permanent loadout plus the wildcard (if any, from *before* this step's
  // pickup — a newly-found chip applies starting next step, the same
  // treatment M2 gives a newly-picked-up loot item's build effects).
  // Aggregated separately per weapon category, since tag-gating happens per
  // attack, not at loadout-selection time (`docs/M3_ISSUES.md` §1).
  const activeSkills: readonly SkillDefinition[] =
    player.wildcardSkill === null
      ? player.skillLoadout
      : [...player.skillLoadout, player.wildcardSkill];
  const meleeSkillEffects = aggregateSkillEffects(activeSkills, player.meleeWeapon.tags);
  const rangedSkillEffects = aggregateSkillEffects(activeSkills, player.rangedWeapon.tags);

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
  let stunnedTargetIds: readonly string[] = [];
  let shieldHp = player.shieldHp;

  // Melee (M1.6/M1.7, carried-loot effects M2.4, skill effects M3.3): start a
  // new swing, or advance an in-flight one and resolve its hits exactly
  // once, when it first enters the active window.
  if (player.meleeAttack === null) {
    if (input.attackPressed) {
      const startResult = startMeleeAttack(
        actor,
        player.meleeWeapon,
        player.meleeCooldownMs,
        buildEffects,
        meleeSkillEffects,
      );
      if (startResult.started) {
        player = {
          ...player,
          meleeAttack: startResult.state,
          // The effective (post-skill, post-carried-loot) interval, so an
          // attack-speed/recovery bonus actually shortens the next cooldown
          // (`docs/M2_ISSUES.md` M2.4, `docs/M3_ISSUES.md` M3.3).
          meleeCooldownMs: startResult.state.weapon.attackIntervalMs,
        };
      }
    }
  } else {
    let meleeAttack = advanceMeleeAttack(player.meleeAttack, SIMULATION_DT_MS);
    if (!meleeAttack.hasResolvedHits && meleePhase(meleeAttack) === "active") {
      const resolved = resolveMeleeHits(meleeAttack, workingTargets, world.rng);
      workingTargets = resolved.updatedTargets;
      hitEvents = [...hitEvents, ...resolved.hitEvents];
      stunnedTargetIds = resolved.stunnedTargetIds;
      // Shield-on-hit (M3.5): granted once per melee hit landed this step.
      if (meleeSkillEffects.shieldOnHitAdd > 0) {
        resolved.hitEvents.forEach(() => {
          shieldHp = grantShield(shieldHp, meleeSkillEffects.shieldOnHitAdd);
        });
      }
      meleeAttack = { ...meleeAttack, hasResolvedHits: true };
    }
    player = { ...player, meleeAttack: isMeleeAttackFinished(meleeAttack) ? null : meleeAttack };
  }

  // Ranged (M1.6/M1.8, carried-loot effects M2.4, skill effects M3.3): fire a
  // new volley; the shared hard caps (`caps.ts`) are enforced inside
  // `startRangedAttack`.
  if (input.secondaryAttackPressed) {
    const fireResult = startRangedAttack(
      actor,
      player.rangedWeapon,
      player.rangedCooldownMs,
      projectiles.length,
      world.tick,
      buildEffects,
      rangedSkillEffects,
    );
    if (fireResult.started) {
      projectiles = [...projectiles, ...fireResult.projectiles];
      player = { ...player, rangedCooldownMs: fireResult.attackIntervalMs };
    }
  }

  // Advance every live projectile: steer (homing), move, resolve against a
  // wall (bounce or stop, swept per axis — D-1/M3.4) or a target (pierce or
  // consume), or expire (or return once, M3.4).
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
  // Shield-on-hit (M3.5): granted once per ranged hit landed this step.
  if (rangedSkillEffects.shieldOnHitAdd > 0) {
    projectileStep.hitEvents.forEach(() => {
      shieldHp = grantShield(shieldHp, rangedSkillEffects.shieldOnHitAdd);
    });
  }
  player = { ...player, shieldHp };

  // Merge combat-resolved health (and any melee-inflicted stun, M3.5) back
  // into the enemy collection, split into survivors and this step's kills
  // (M1.9 requirement 3: "dies ... and is removed"; M2.6: a kill drops loot).
  const mergedEnemies: Enemy[] = world.enemies.map((enemy) => {
    const updated = workingTargets.find((target) => target.id === enemy.id);
    const withHealth = updated ? { ...enemy, health: updated.health } : enemy;
    return stunnedTargetIds.includes(enemy.id)
      ? { ...withHealth, stunnedMs: STUN_DURATION_MS }
      : withHealth;
  });
  const killedThisStep = mergedEnemies.filter((enemy) => enemy.health <= 0);
  let enemies: Enemy[] = mergedEnemies.filter((enemy) => enemy.health > 0);

  let groundLoot = world.groundLoot;
  for (const killed of killedThisStep) {
    const definition = chooseLootDrop(world.rng);
    groundLoot = [...groundLoot, spawnGroundLoot(definition, killed.position, `loot-${killed.id}`)];
  }

  // Chaser movement + shield-aware contact damage (M1.9/M1.10, shield M3.5).
  // Enemies killed above are already removed, so a dead enemy cannot also
  // deal contact damage this step. A stunned enemy still deals contact
  // damage on touch (`docs/M3_ISSUES.md` M3.5: stun disables aggression, not
  // hurtbox/hitbox presence).
  let playerHealth = player.health;
  let playerShieldHp = player.shieldHp;
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
      const damaged = applyDamageToPlayer(
        { shieldHp: playerShieldHp, health: playerHealth },
        moved.contactDamage,
      );
      playerShieldHp = damaged.shieldHp;
      playerHealth = damaged.health;
      tookContactDamageThisStep = true;
      if (playerHealth <= 0) {
        playerAlive = false;
      }
      return { ...moved, contactCooldownMs: moved.contactDamageIntervalMs };
    }
    return moved;
  });
  player = { ...player, health: playerHealth, shieldHp: playerShieldHp, alive: playerAlive };

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

  // Wildcard skill-chip pickup (M3.7): while interact is held and the player
  // overlaps a chip, it always replaces the current wildcard skill (concept
  // §10: "a new chip may replace the current one") — unlike loot pickup,
  // there is no refusal case.
  let skillChips = world.skillChips;
  if (input.interactPressed && playerAlive) {
    const nearbyChip = skillChips.find((chip) => isNearSkillChip(player, chip));
    if (nearbyChip !== undefined) {
      player = { ...player, wildcardSkill: nearbyChip.definition };
      skillChips = skillChips.filter((chip) => chip.id !== nearbyChip.id);
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
  // run, converting carried loot differently. Either way, the wildcard skill
  // and shield are cleared (concept §10: the wildcard "drops or disappears
  // on death"; nothing persists past a run yet, M5/M7).
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
    player = {
      ...player,
      inventory: createEmptyInventory(),
      secureSlot: null,
      wildcardSkill: null,
      shieldHp: 0,
    };
  } else if (extractionProgressMs >= EXTRACTION_CHANNEL_MS) {
    runResult = buildExtractionResult(player.inventory, player.secureSlot);
    player = {
      ...player,
      inventory: createEmptyInventory(),
      secureSlot: null,
      wildcardSkill: null,
      shieldHp: 0,
    };
  }

  return {
    world: {
      ...world,
      player,
      projectiles,
      enemies,
      groundLoot,
      skillChips,
      extractionPoints,
      runResult,
      tick: world.tick + 1,
    },
    hitEvents,
  };
}
