/**
 * The headless, fixed-step simulation (M1.1, `docs/M1_EXECUTION_PLAN.md`
 * §2.1, §2.2). This module — via `createSimulation`/`stepSimulation` — is the
 * single seam a host calls into; no game rule runs in Phaser scene code
 * (technical plan §5.1, §9.3). The simulation only ever advances by the fixed
 * `SIMULATION_DT_MS` step, never by an arbitrary render-frame delta.
 *
 * M1 shipped the chaser enemy, player health/death, and dash. M2 (`docs/
 * M2_ISSUES.md`) added the six-slot inventory, the secure slot, carried-loot
 * build effects, ground loot, rotating extraction, and the run result. M3
 * (`docs/M3_ISSUES.md`) added the permanent skill loadout, the wildcard skill
 * chip, per-attack skill-effect aggregation (feeding `combat/pipeline.ts`'s
 * stage 4), stun, and the player shield.
 *
 * **M4 moves this loop behind the authoritative Colyseus room** (`docs/
 * M4_ISSUES.md`): the client no longer calls it at all, the server calls it
 * once per 50 ms tick from each player's latest validated input, and the world
 * holds two to eight players instead of one. That is the only structural change
 * — every rule this file orchestrates (`movement.ts`, `collision.ts`,
 * `combat/*`, `inventory.ts`, `build-effects.ts`, `skill-effects.ts`,
 * `extraction.ts`, `loot-drop.ts`, `skill-chip.ts`, `run-result.ts`) moved
 * without modification, because each was already a pure function over one actor
 * plus world data.
 */
import type {
  EnemyDefinition,
  SkillDefinition,
  WeaponDefinition,
} from "@carry-or-fall/game-content";

import { normalizeAngle } from "./angles";
import { aggregateBuildEffects, effectiveMaxHealth, effectiveMoveSpeed } from "./build-effects";
import { buildWallGrid, resolveAxisMovement, type SpatialGrid } from "./collision";
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
import { canDealContactDamage, nearestLivePlayer, spawnEnemies, stepEnemyMovement } from "./enemy";
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
  Player,
  Projectile,
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

/**
 * The input of a player who is issuing none: no movement, no aim change, no
 * action. Used for a player with no entry in the step's input map — which on
 * the server is exactly a disconnected player, who by technical plan §34.1 must
 * remain "stationary and vulnerable" rather than freezing or vanishing.
 *
 * `aimAngle: Number.NaN` is deliberate, not a placeholder: `stepSimulation`
 * ignores a non-finite aim rather than corrupting facing with it, so a neutral
 * input leaves the player's facing exactly where it was.
 */
export const NEUTRAL_INPUT: InputState = {
  moveX: 0,
  moveY: 0,
  aimAngle: Number.NaN,
  attackPressed: false,
  secondaryAttackPressed: false,
  dashPressed: false,
  interactPressed: false,
  discardSlotIndex: null,
  secureSlotIndex: null,
};

/** How one player enters a world: their identity, where they start, and what they brought. */
export interface PlayerSpawn {
  /** Server-generated (the Colyseus session id); unique within the world. */
  readonly id: string;
  readonly position: Vec2;
  /** The player's equipped melee weapon (left mouse button). */
  readonly meleeWeapon: WeaponDefinition;
  /** The player's equipped ranged weapon (right mouse button). */
  readonly rangedWeapon: WeaponDefinition;
  /**
   * The pre-run permanent skill loadout (M3.2), already validated by
   * `skill-loadout.ts`'s `createSkillLoadout` — an invalid selection never
   * reaches this boundary. Defaults to {@link EMPTY_SKILL_LOADOUT}.
   */
  readonly skillLoadout?: SkillLoadout;
}

/** Initial conditions for a fresh simulation world. */
export interface SimulationConfig {
  readonly walls: readonly Wall[];
  /** Everyone starting the match. May be empty; players can also be added later during a lobby. */
  readonly players: readonly PlayerSpawn[];
  /** The enemy content definition every spawned enemy is built from (the chaser). */
  readonly enemyDefinition: EnemyDefinition;
  /**
   * Candidate spawn points; {@link SimulationConfig.enemyCount} of them are
   * chosen — distinctly — via the seeded PRNG (M1.9 requirement 4). Must hold
   * at least `enemyCount` entries.
   */
  readonly enemySpawnPoints: readonly Vec2[];
  /** How many enemies to spawn, each at a distinct `enemySpawnPoints` entry. Defaults to 1. */
  readonly enemyCount?: number;
  /**
   * Ground loot scattered on the map at match start (M2.6), one per point, so
   * a short match has enough loot to exercise the six-slot inventory/secure
   * slot beyond the enemies' own drops. Defaults to none.
   */
  readonly groundLootSpawnPoints?: readonly Vec2[];
  /**
   * Candidate locations extraction points rotate among (M2.7); must have at
   * least `extraction.ts`'s `ACTIVE_EXTRACTION_POINT_COUNT` (2) entries.
   */
  readonly extractionCandidatePoints: readonly Vec2[];
  /**
   * Wildcard skill chips scattered on the map at match start (M3.7), one per
   * point, mirroring `groundLootSpawnPoints`. Defaults to none.
   */
  readonly skillChipSpawnPoints?: readonly Vec2[];
  /** Seeds the PRNG used for enemy spawn/loot/extraction/skill-chip selection (technical plan §9.4). */
  readonly seed: number;
}

/** Build a fresh `Player` from a spawn descriptor. */
export function createPlayer(spawn: PlayerSpawn): Player {
  return {
    id: spawn.id,
    position: spawn.position,
    radius: PLAYER_RADIUS,
    facing: 0,
    health: PLAYER_MAX_HEALTH,
    maxHealth: PLAYER_MAX_HEALTH,
    shieldHp: 0,
    alive: true,
    meleeWeapon: spawn.meleeWeapon,
    rangedWeapon: spawn.rangedWeapon,
    meleeCooldownMs: 0,
    rangedCooldownMs: 0,
    meleeAttack: null,
    dashCooldownMs: 0,
    inventory: createEmptyInventory(),
    secureSlot: null,
    extractionProgressMs: 0,
    skillLoadout: spawn.skillLoadout ?? EMPTY_SKILL_LOADOUT,
    wildcardSkill: null,
    runResult: null,
  };
}

/**
 * Build the initial `World` for a match: every configured player at their
 * spawn, the static map walls, `config.enemyCount` chaser enemies at distinct
 * spawn points, scattered ground loot and skill chips, and the initial active
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
    players: config.players.map(createPlayer),
    walls: config.walls,
    projectiles: [],
    enemies,
    groundLoot,
    skillChips,
    extractionPoints,
    extractionCandidatePoints: config.extractionCandidatePoints,
    rng,
    tick: 0,
  };
}

/** Find a player by id, or `null` if no such player is in the world. */
export function findPlayer(world: World, playerId: string): Player | null {
  return world.players.find((player) => player.id === playerId) ?? null;
}

/**
 * Add a player to an existing world (M4): what happens when someone joins the
 * room's lobby. Appending keeps the existing players' order — and therefore the
 * step order — stable. A duplicate id is refused by returning the world
 * unchanged, so a repeated join cannot produce two bodies for one player.
 */
export function addPlayerToWorld(world: World, spawn: PlayerSpawn): World {
  if (findPlayer(world, spawn.id) !== null) {
    return world;
  }
  return { ...world, players: [...world.players, createPlayer(spawn)] };
}

/**
 * Remove a player from the world (M4): what happens when someone leaves, or
 * when a disconnected player's reconnect window lapses and their run is
 * abandoned (technical plan §34.1).
 *
 * Their carried inventory drops where they stood, exactly as death drops it
 * (concept §15.2: dropped items are "visible and lootable"), so leaving cannot
 * be used to remove contested loot from the match. Their secure slot is not
 * dropped — it is not lootable by anyone (concept §7.2) — and, with no
 * persistence until M5, it is simply lost (`docs/M4_ISSUES.md` §1.8).
 * Everything else in the world, including other players' projectiles, is
 * untouched.
 */
export function removePlayerFromWorld(world: World, playerId: string): World {
  const leaving = findPlayer(world, playerId);
  if (leaving === null) {
    return world;
  }
  const dropped = leaving.inventory
    .filter((item): item is NonNullable<typeof item> => item !== null)
    .map((item, index) =>
      spawnGroundLoot(item, leaving.position, `loot-left-${playerId}-${String(index)}`),
    );
  return {
    ...world,
    players: world.players.filter((player) => player.id !== playerId),
    groundLoot: [...world.groundLoot, ...dropped],
  };
}

/** Whether this player's match is over: they died or extracted, and are now inert. */
function isRunOver(player: Player): boolean {
  return !player.alive || player.runResult !== null;
}

/** The result of advancing one fixed step: the new world and any hit events to render. */
export interface StepResult {
  readonly world: World;
  readonly hitEvents: readonly HitEvent[];
}

/**
 * The per-player state carried between the two passes of a step, because
 * pickups and extraction (pass 2) must happen after enemies have moved and
 * dealt contact damage (which is what interrupts an extraction channel).
 */
interface PlayerPass {
  player: Player;
  /**
   * This player’s shield-on-hit value for ranged attacks, carried forward
   * because their projectiles resolve later, in the shared projectile step.
   * Melee needs no equivalent: a swing resolves inside pass 1, where the value
   * is already in hand.
   */
  readonly shieldOnRangedHit: number;
}

/**
 * Advance the world by exactly one fixed step, for every player at once.
 *
 * `inputs` maps player id to that player's latest validated intent; a player
 * with no entry gets {@link NEUTRAL_INPUT} — which is exactly the disconnected
 * player's case (technical plan §34.1: stationary, still vulnerable). A player
 * whose run has ended is skipped entirely and left untouched, while the rest of
 * the match continues around them.
 *
 * The order below is a **rule**, not an implementation detail, because with
 * more than one player a contested outcome has to resolve the same way on every
 * machine replaying the same inputs (`docs/M4_EXECUTION_PLAN.md` §2.2):
 *
 * 1. build the wall grid once;
 * 2. per player, in `world.players` order: inventory intents, build effects,
 *    movement and collision, dash, aim, cooldowns, melee, ranged;
 * 3. step every projectile once, against the shared enemy list;
 * 4. merge enemy health, remove kills, drop their loot;
 * 5. move enemies toward the nearest live player and apply contact damage;
 * 6. per player, in the same order: loot pickup, chip pickup, extraction
 *    channel, run end;
 * 7. `tick += 1`.
 */
export function stepSimulation(world: World, inputs: ReadonlyMap<string, InputState>): StepResult {
  const grid = buildWallGrid(world.walls);

  let workingTargets: readonly AttackTarget[] = world.enemies;
  let projectiles = world.projectiles;
  let hitEvents: HitEvent[] = [];
  let stunnedTargetIds: string[] = [];

  // ---- Pass 1: per-player intents, movement, and attacks. -----------------
  const passes: PlayerPass[] = [];
  for (const original of world.players) {
    if (isRunOver(original)) {
      passes.push({ player: original, shieldOnRangedHit: 0 });
      continue;
    }
    const input = inputs.get(original.id) ?? NEUTRAL_INPUT;
    const attacked = stepPlayerAttacks(original, input, grid, {
      targets: workingTargets,
      projectiles,
      rng: world.rng,
      tick: world.tick,
    });
    workingTargets = attacked.targets;
    projectiles = attacked.projectiles;
    hitEvents = [...hitEvents, ...attacked.hitEvents];
    stunnedTargetIds = [...stunnedTargetIds, ...attacked.stunnedTargetIds];
    passes.push({ player: attacked.player, shieldOnRangedHit: attacked.shieldOnRangedHit });
  }

  // ---- Step every live projectile once, against the shared enemy list. ----
  // Steering (homing), movement, wall resolution (bounce or stop, swept per
  // axis — D-1/M3.4), target hits (pierce or consume), and expiry (or one
  // return, M3.4) are unchanged from M3; the only difference is that the
  // projectiles in flight now belong to several owners.
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

  // Shield-on-hit (M3.5) for ranged hits, credited to the projectile's owner —
  // which is why `HitEvent` carries `ownerId` (M4).
  const shieldFromRanged = new Map<string, number>();
  for (const event of projectileStep.hitEvents) {
    const pass = passes.find((candidate) => candidate.player.id === event.ownerId);
    if (pass === undefined || pass.shieldOnRangedHit <= 0) {
      continue;
    }
    shieldFromRanged.set(
      event.ownerId,
      (shieldFromRanged.get(event.ownerId) ?? 0) + pass.shieldOnRangedHit,
    );
  }
  for (const pass of passes) {
    const granted = shieldFromRanged.get(pass.player.id);
    if (granted !== undefined) {
      pass.player = { ...pass.player, shieldHp: grantShield(pass.player.shieldHp, granted) };
    }
  }

  // ---- Merge combat-resolved enemy health, remove kills, drop their loot. --
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

  // ---- Enemy movement and contact damage. ---------------------------------
  // Each chaser targets the nearest live player, re-chosen every step, and can
  // damage whichever player it is actually touching. Enemies killed above are
  // already removed, so a dead enemy cannot also deal contact damage this step.
  // A stunned enemy still deals contact damage on touch (`docs/M3_ISSUES.md`
  // M3.5: stun disables aggression, not hurtbox/hitbox presence).
  const damagedThisStep = new Set<string>();
  enemies = enemies.map((enemy) => {
    const target = nearestLivePlayer(
      enemy.position,
      passes.map((pass) => pass.player),
    );
    // With no live player left, the enemy is asked to chase its own position:
    // `stepEnemyMovement` treats a zero-distance target as "nowhere to go" and
    // still ticks its cooldown and stun down, so there is no second code path
    // to keep in step with the first.
    const moved = stepEnemyMovement(
      enemy,
      target?.position ?? enemy.position,
      SIMULATION_DT_MS,
      SIMULATION_DT_SECONDS,
      grid,
    );

    const touched = passes.find(
      (pass) => !isRunOver(pass.player) && canDealContactDamage(moved, pass.player),
    );
    if (touched === undefined) {
      return moved;
    }

    const damaged = applyDamageToPlayer(
      { shieldHp: touched.player.shieldHp, health: touched.player.health },
      moved.contactDamage,
    );
    touched.player = {
      ...touched.player,
      shieldHp: damaged.shieldHp,
      health: damaged.health,
      alive: damaged.health > 0,
    };
    damagedThisStep.add(touched.player.id);
    return { ...moved, contactCooldownMs: moved.contactDamageIntervalMs };
  });

  // ---- Rotating extraction points (M2.7): advance the rotation timer. ------
  const extractionPoints = stepExtractionPoints(
    world.extractionPoints,
    SIMULATION_DT_MS,
    world.extractionCandidatePoints,
    world.rng,
  );

  // ---- Pass 2: per-player pickups, extraction, and run end. ----------------
  let skillChips = world.skillChips;
  const players: Player[] = [];
  for (const pass of passes) {
    let player = pass.player;
    // Already finished before this step. A player who died *during* this step
    // still has a null result and falls through, so their death is settled and
    // their loot dropped below.
    if (player.runResult !== null) {
      players.push(player);
      continue;
    }
    const input = inputs.get(player.id) ?? NEUTRAL_INPUT;

    // Ground-loot pickup (M2.6): while interact is held and the player overlaps
    // a ground-loot entity, attempt to add it to the inventory; refused (item
    // stays put) when the inventory is full. Players are processed in order, so
    // two players reaching for the same item on the same step resolve
    // deterministically: the earlier one takes it.
    if (input.interactPressed && player.alive) {
      const nearby = groundLoot.find((loot) => isNearGroundLoot(player, loot));
      if (nearby !== undefined) {
        const pickup = attemptPickup(player.inventory, nearby);
        if (pickup.pickedUp) {
          player = { ...player, inventory: pickup.inventory };
          groundLoot = groundLoot.filter((loot) => loot.id !== nearby.id);
        }
      }
    }

    // Wildcard skill-chip pickup (M3.7): a chip always replaces the current
    // wildcard skill (concept §10) — unlike loot pickup, there is no refusal.
    if (input.interactPressed && player.alive) {
      const nearbyChip = skillChips.find((chip) => isNearSkillChip(player, chip));
      if (nearbyChip !== undefined) {
        player = { ...player, wildcardSkill: nearbyChip.definition };
        skillChips = skillChips.filter((chip) => chip.id !== nearbyChip.id);
      }
    }

    // Extraction channel (M2.7/concept §17): interrupted by this step's contact
    // damage, by leaving the radius, or by releasing interact.
    const withinExtractionPoint = findActiveExtractionPoint(player, extractionPoints);
    const isChanneling =
      player.alive &&
      !damagedThisStep.has(player.id) &&
      input.interactPressed &&
      withinExtractionPoint !== null;
    const extractionProgressMs = isChanneling ? player.extractionProgressMs + SIMULATION_DT_MS : 0;
    player = { ...player, extractionProgressMs };

    // Run ending (M2.8): death or a completed extraction channel both end this
    // player's run, converting carried loot differently. Either way the
    // wildcard skill and shield are cleared (concept §10: the wildcard "drops
    // or disappears on death"; nothing persists past a run yet, M5/M7).
    if (!player.alive) {
      const runResult = buildDeathResult(player.inventory, player.secureSlot);
      groundLoot = [
        ...groundLoot,
        ...player.inventory
          .filter((item): item is NonNullable<typeof item> => item !== null)
          .map((item, index) =>
            spawnGroundLoot(item, player.position, `loot-death-${player.id}-${String(index)}`),
          ),
      ];
      player = {
        ...player,
        runResult,
        inventory: createEmptyInventory(),
        secureSlot: null,
        wildcardSkill: null,
        shieldHp: 0,
      };
    } else if (extractionProgressMs >= EXTRACTION_CHANNEL_MS) {
      player = {
        ...player,
        runResult: buildExtractionResult(player.inventory, player.secureSlot),
        inventory: createEmptyInventory(),
        secureSlot: null,
        wildcardSkill: null,
        shieldHp: 0,
      };
    }

    players.push(player);
  }

  return {
    world: {
      ...world,
      players,
      projectiles,
      enemies,
      groundLoot,
      skillChips,
      extractionPoints,
      tick: world.tick + 1,
    },
    hitEvents,
  };
}

/** Everything pass 1 needs from, and returns to, the shared world. */
interface AttackPassContext {
  readonly targets: readonly AttackTarget[];
  readonly projectiles: readonly Projectile[];
  readonly rng: World["rng"];
  readonly tick: number;
}

interface AttackPassResult {
  readonly player: Player;
  readonly targets: readonly AttackTarget[];
  readonly projectiles: readonly Projectile[];
  readonly hitEvents: readonly HitEvent[];
  readonly stunnedTargetIds: readonly string[];
  readonly shieldOnRangedHit: number;
}

/**
 * One player's half of a step: inventory intents, carried-loot build effects,
 * skill aggregation, movement, dash, aim, cooldowns, and both attack
 * categories. Extracted from {@link stepSimulation} so the multi-player loop
 * reads as a loop rather than a wall of interleaved state.
 */
function stepPlayerAttacks(
  initial: Player,
  input: InputState,
  grid: SpatialGrid<Wall>,
  context: AttackPassContext,
): AttackPassResult {
  let player = initial;

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
  // pickup — a newly-found chip applies starting next step, the same treatment
  // M2 gives a newly-picked-up loot item's build effects). Aggregated
  // separately per weapon category, since tag-gating happens per attack, not at
  // loadout-selection time (`docs/M3_ISSUES.md` §1).
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

  // Dash (M1.S1): an instant displacement resolved through the same wall-aware
  // movement, on top of the ordinary move this same step.
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
  // rather than corrupting facing with it (which is also what makes
  // NEUTRAL_INPUT leave a disconnected player's facing alone).
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
    id: player.id,
    position: player.position,
    facing: player.facing,
    radius: player.radius,
  };
  let targets = context.targets;
  let hitEvents: readonly HitEvent[] = [];
  let stunnedTargetIds: readonly string[] = [];
  let shieldHp = player.shieldHp;

  // Melee (M1.6/M1.7, carried-loot effects M2.4, skill effects M3.3): start a
  // new swing, or advance an in-flight one and resolve its hits exactly once,
  // when it first enters the active window.
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
          // attack-speed/recovery bonus actually shortens the next cooldown.
          meleeCooldownMs: startResult.state.weapon.attackIntervalMs,
        };
      }
    }
  } else {
    let meleeAttack = advanceMeleeAttack(player.meleeAttack, SIMULATION_DT_MS);
    if (!meleeAttack.hasResolvedHits && meleePhase(meleeAttack) === "active") {
      const resolved = resolveMeleeHits(meleeAttack, targets, context.rng);
      targets = resolved.updatedTargets;
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
  // `startRangedAttack`. The active-projectile cap counts only this player's
  // own live projectiles (§13.4 cap 7 is per player).
  let projectiles = context.projectiles;
  if (input.secondaryAttackPressed) {
    const ownedProjectileCount = projectiles.filter(
      (projectile) => projectile.ownerId === player.id,
    ).length;
    const fireResult = startRangedAttack(
      actor,
      player.rangedWeapon,
      player.rangedCooldownMs,
      ownedProjectileCount,
      context.tick,
      buildEffects,
      rangedSkillEffects,
    );
    if (fireResult.started) {
      projectiles = [...projectiles, ...fireResult.projectiles];
      player = { ...player, rangedCooldownMs: fireResult.attackIntervalMs };
    }
  }

  player = { ...player, shieldHp };

  return {
    player,
    targets,
    projectiles,
    hitEvents,
    stunnedTargetIds,
    shieldOnRangedHit: rangedSkillEffects.shieldOnHitAdd,
  };
}
