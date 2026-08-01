/**
 * M3.6 (`docs/M3_ISSUES.md` M3.6): the "no recursive effect explosion" exit
 * criterion, driven through the real pipeline (`createSimulation`/
 * `stepSimulation`) under the worst *legal* combination of skills, carried
 * loot, and weapon — not a synthetic fixture that tests a cap in isolation.
 * `STRESS_LOOT` is a fabricated loot item with deliberately extreme
 * `buildEffects`, the same pattern `combat/ranged.test.ts`'s
 * `fabricated_overclaiming_bow` already uses to prove a cap holds regardless
 * of what a content author might someday declare — the cap, not the content,
 * is what must never break.
 */
import { describe, expect, it } from "vitest";
import {
  basicBow,
  basicSword,
  chaser,
  type LootDefinition,
  piercingRounds,
  returningShot,
  ricochet,
  homingArrows,
  extendedReach,
  swiftStrikes,
  stunningBlows,
} from "@carry-or-fall/game-content";

import {
  MAX_ACTIVE_PROJECTILES_PER_PLAYER,
  MAX_BOUNCES,
  MAX_PIERCES,
  MAX_RETURNS_PER_PROJECTILE,
} from "./combat/caps";
import { addItemToInventory, createEmptyInventory, INVENTORY_SIZE } from "./inventory";
import { createSimulation, stepSimulation, type SimulationConfig } from "./simulation";
import {
  aggregateSkillEffects,
  MAX_ARC_DEGREES_ADD,
  MAX_RANGE_MULTIPLIER_ADD,
  MAX_RECOVERY_REDUCTION_ADD,
  MAX_STUN_CHANCE_ADD,
} from "./skill-effects";
import type { SkillLoadout } from "./skill-loadout";
import type { InputState, Player, Wall, World } from "./world";

const NO_INPUT: InputState = {
  moveX: 0,
  moveY: 0,
  aimAngle: 0,
  attackPressed: false,
  secondaryAttackPressed: false,
  dashPressed: false,
  interactPressed: false,
  discardSlotIndex: null,
  secureSlotIndex: null,
};
const FIRE: InputState = { ...NO_INPUT, secondaryAttackPressed: true };
const ATTACK: InputState = { ...NO_INPUT, attackPressed: true };

const FAR_AWAY = { x: 100_000, y: 100_000 };
const FAR_AWAY_EXTRACTION = [FAR_AWAY, { x: 200_000, y: 0 }];

/** A fabricated, deliberately extreme loot item — see the module doc. */
const STRESS_LOOT: LootDefinition = {
  id: "stress_test_loot",
  kind: "loot",
  rarity: "rare",
  points: { force: 0, precision: 0, motion: 0, guard: 0, signal: 0 },
  buildEffects: {
    damageAdd: 999,
    attackSpeedBonus: 999,
    projectileSpeedAdd: 999,
    moveSpeedBonus: 999,
    maxHealthAdd: 999,
  },
};

function fullStressInventory() {
  let inventory = createEmptyInventory();
  for (let i = 0; i < INVENTORY_SIZE; i += 1) {
    ({ inventory } = addItemToInventory(inventory, STRESS_LOOT));
  }
  return inventory;
}

const SOLO = "player-1";

/** The one player in these solo stress worlds (`world.players` replaced `world.player` in M4). */
function solo(world: World): Player {
  const player = world.players[0];
  if (player === undefined) {
    throw new Error("expected a solo world to hold exactly one player");
  }
  return player;
}

/** Advance a solo world one step with `input` for its only player. */
function step(world: World, input: InputState): World {
  return stepSimulation(world, new Map([[SOLO, input]])).world;
}

type StressOverrides = Partial<SimulationConfig> & { readonly skillLoadout?: SkillLoadout };

function baseConfig(overrides: StressOverrides): SimulationConfig {
  const { skillLoadout, ...config } = overrides;
  return {
    walls: [],
    players: [
      {
        id: SOLO,
        position: { x: 0, y: 0 },
        meleeWeapon: basicSword,
        rangedWeapon: basicBow,
        ...(skillLoadout === undefined ? {} : { skillLoadout }),
      },
    ],
    enemyDefinition: chaser,
    enemySpawnPoints: [FAR_AWAY],
    extractionCandidatePoints: FAR_AWAY_EXTRACTION,
    seed: 1,
    ...config,
  };
}

describe("M3.6: hard caps hold under the worst legal combination (recursive-effect-explosion)", () => {
  it("ricochet + piercing_rounds + homing_arrows (3 slots) plus a fully stacked loot inventory hold caps 1, 2, 3, and 7 over hundreds of steps of continuous fire, without throwing or growing unboundedly", () => {
    let world = createSimulation(
      baseConfig({ skillLoadout: [ricochet, piercingRounds, homingArrows], seed: 11 }),
    );
    world = { ...world, players: [{ ...solo(world), inventory: fullStressInventory() }] };

    for (let i = 0; i < 400; i += 1) {
      world = step(world, FIRE);

      // Cap 1 / 7: per-attack and per-player active-projectile ceilings.
      expect(world.projectiles.length).toBeLessThanOrEqual(MAX_ACTIVE_PROJECTILES_PER_PLAYER);

      for (const projectile of world.projectiles) {
        // Cap 2: bounces.
        expect(projectile.bouncesRemaining).toBeGreaterThanOrEqual(0);
        expect(projectile.bouncesRemaining).toBeLessThanOrEqual(MAX_BOUNCES);
        // Cap 3: pierces.
        expect(projectile.piercesRemaining).toBeGreaterThanOrEqual(0);
        expect(projectile.piercesRemaining).toBeLessThanOrEqual(MAX_PIERCES);
        // Cap 4: returns (no return skill equipped here, so always 0, but the
        // field itself must never exceed the shared ceiling).
        expect(projectile.returnsSoFar).toBeLessThanOrEqual(MAX_RETURNS_PER_PROJECTILE);
        // Every numeric field stays finite: no NaN/Infinity from repeated
        // homing steering or stacked multipliers ("does not degrade").
        expect(Number.isFinite(projectile.position.x)).toBe(true);
        expect(Number.isFinite(projectile.position.y)).toBe(true);
        expect(Number.isFinite(projectile.damage)).toBe(true);
      }
    }
  });

  it("extended_reach + swift_strikes + stunning_blows (3 slots), stacked again via an identical wildcard, keeps every melee skill-effect ceiling", () => {
    const loadout = [extendedReach, swiftStrikes, stunningBlows];
    // A wildcard duplicating a permanent skill is legal (`docs/M3_ISSUES.md`
    // §1 does not forbid it) and is the worst case for additive stacking.
    const activeSkills = [...loadout, extendedReach, swiftStrikes, stunningBlows];
    const effects = aggregateSkillEffects(activeSkills, basicSword.tags);
    expect(effects.rangeMultiplierAdd).toBeLessThanOrEqual(MAX_RANGE_MULTIPLIER_ADD);
    expect(effects.arcDegreesAdd).toBeLessThanOrEqual(MAX_ARC_DEGREES_ADD);
    expect(effects.recoveryReductionAdd).toBeLessThanOrEqual(MAX_RECOVERY_REDUCTION_ADD);
    expect(effects.recoveryReductionAdd).toBeLessThan(1); // recovery can never collapse to zero
    expect(effects.stunChanceAdd).toBeLessThanOrEqual(MAX_STUN_CHANCE_ADD);
  });

  it("the same worst-legal melee combination, driven through the real pipeline over many attacks, keeps landing hits and never lets the cooldown go negative", () => {
    // A tanky, stationary enemy so many attacks land instead of one-shotting
    // it — this test is about the attack cadence/caps holding over repeated
    // swings, not about damage output (already covered elsewhere).
    const tankyStationaryChaser = { ...chaser, health: 100_000, moveSpeed: 0 };
    let world = createSimulation(
      baseConfig({
        enemyDefinition: tankyStationaryChaser,
        enemySpawnPoints: [{ x: 40, y: 0 }],
        skillLoadout: [extendedReach, swiftStrikes, stunningBlows],
        seed: 12,
      }),
    );

    let hitCount = 0;
    let previousHealth = tankyStationaryChaser.health;
    for (let i = 0; i < 300; i += 1) {
      const input = solo(world).meleeAttack === null ? ATTACK : NO_INPUT;
      world = step(world, input);
      expect(solo(world).meleeCooldownMs).toBeGreaterThanOrEqual(0);
      const currentHealth = world.enemies[0]!.health;
      if (currentHealth < previousHealth) {
        hitCount += 1;
      }
      previousHealth = currentHealth;
    }
    // With swift_strikes shortening recovery, several swings should have
    // landed in 300 steps (15s); a degraded/broken cooldown would land at
    // most one.
    expect(hitCount).toBeGreaterThan(1);
  });

  it("returning_shot (2-slot) plus ricochet (1-slot) — the full 3-slot budget — never returns a projectile more than once even while it also bounces", () => {
    const bounceWall: Wall = { x: 200, y: -200, width: 20, height: 400 };
    let world = createSimulation(
      baseConfig({
        walls: [bounceWall],
        skillLoadout: [returningShot, ricochet],
        seed: 13,
      }),
    );
    world = step(world, FIRE);

    for (let i = 0; i < 300; i += 1) {
      world = step(world, NO_INPUT);
      for (const projectile of world.projectiles) {
        expect(projectile.returnsSoFar).toBeLessThanOrEqual(MAX_RETURNS_PER_PROJECTILE);
        expect(projectile.bouncesRemaining).toBeGreaterThanOrEqual(0);
        expect(projectile.bouncesRemaining).toBeLessThanOrEqual(MAX_BOUNCES);
      }
    }
  });
});
