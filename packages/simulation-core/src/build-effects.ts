/**
 * Carried-loot build effects (M2.4, `docs/M2_ISSUES.md` M2.4). Aggregates the
 * inventory's `buildEffects` into one capped value and applies it to the
 * weapon actually used for an attack, to player movement speed, and to
 * player max health — this is what fills in `combat/pipeline.ts`'s stage 5,
 * `applyCarriedLootModifiers`, which was a documented pass-through since M1
 * specifically so this milestone could complete it without reworking the
 * pipeline (`docs/M1_EXECUTION_PLAN.md` §2.4).
 *
 * The secure slot is never read here (concept §7.2: a secured item "stops
 * contributing to the current build") — callers pass only `player.inventory`.
 *
 * Each recognized effect is **summed** across the inventory, then **clamped**
 * to a fixed ceiling (concept §30.2 "loot power should... remain capped",
 * §31 anti-snowball), independent of and in addition to the six-slot limit:
 * six items each granting the same effect still cannot exceed the cap.
 * Values are proposed and balance-deferred, like M1's combat caps.
 */
import type { WeaponDefinition } from "@carry-or-fall/game-content";

import type { Inventory } from "./inventory";

export interface BuildEffects {
  readonly damageAdd: number;
  readonly attackSpeedBonus: number;
  readonly projectileSpeedAdd: number;
  readonly moveSpeedBonus: number;
  readonly maxHealthAdd: number;
}

/** The pipeline's pass-through value: no carried loot, no change to any stat. */
export const NO_BUILD_EFFECTS: BuildEffects = {
  damageAdd: 0,
  attackSpeedBonus: 0,
  projectileSpeedAdd: 0,
  moveSpeedBonus: 0,
  maxHealthAdd: 0,
} as const;

/** Ceiling on the summed flat damage bonus. */
export const MAX_DAMAGE_ADD = 40;
/** Ceiling on the summed attack-speed bonus: interval is never shortened past 2x (bonus < 1). */
export const MAX_ATTACK_SPEED_BONUS = 0.5;
/** Ceiling on the summed flat projectile-speed bonus. */
export const MAX_PROJECTILE_SPEED_ADD = 400;
/** Ceiling on the summed fractional move-speed bonus. */
export const MAX_MOVE_SPEED_BONUS = 0.5;
/** Ceiling on the summed flat max-health bonus. */
export const MAX_HEALTH_ADD = 100;

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/**
 * Sum every recognized `buildEffects` key across the inventory's non-empty
 * slots (never the secure slot — see the module doc), then clamp each total
 * to its cap.
 */
export function aggregateBuildEffects(inventory: Inventory): BuildEffects {
  let damageAdd = 0;
  let attackSpeedBonus = 0;
  let projectileSpeedAdd = 0;
  let moveSpeedBonus = 0;
  let maxHealthAdd = 0;

  for (const item of inventory) {
    if (item === null) {
      continue;
    }
    const effects = item.buildEffects;
    if (effects === undefined) {
      continue;
    }
    damageAdd += effects.damageAdd ?? 0;
    attackSpeedBonus += effects.attackSpeedBonus ?? 0;
    projectileSpeedAdd += effects.projectileSpeedAdd ?? 0;
    moveSpeedBonus += effects.moveSpeedBonus ?? 0;
    maxHealthAdd += effects.maxHealthAdd ?? 0;
  }

  return {
    damageAdd: clamp(damageAdd, 0, MAX_DAMAGE_ADD),
    attackSpeedBonus: clamp(attackSpeedBonus, 0, MAX_ATTACK_SPEED_BONUS),
    projectileSpeedAdd: clamp(projectileSpeedAdd, 0, MAX_PROJECTILE_SPEED_ADD),
    moveSpeedBonus: clamp(moveSpeedBonus, 0, MAX_MOVE_SPEED_BONUS),
    maxHealthAdd: clamp(maxHealthAdd, 0, MAX_HEALTH_ADD),
  };
}

/**
 * Returns an effective copy of `weapon` with `effects` applied: flat damage
 * added, attack interval shortened by the attack-speed bonus, and (for a
 * ranged weapon that declares one) projectile speed increased. The
 * underlying content definition is never mutated.
 */
export function applyBuildEffectsToWeapon(
  weapon: WeaponDefinition,
  effects: BuildEffects,
): WeaponDefinition {
  return {
    ...weapon,
    damage: weapon.damage + effects.damageAdd,
    attackIntervalMs: weapon.attackIntervalMs / (1 + effects.attackSpeedBonus),
    ...(weapon.projectileSpeed === undefined
      ? {}
      : { projectileSpeed: weapon.projectileSpeed + effects.projectileSpeedAdd }),
  };
}

/** The player's effective move speed given the base speed and carried effects. */
export function effectiveMoveSpeed(baseSpeedPxPerSecond: number, effects: BuildEffects): number {
  return baseSpeedPxPerSecond * (1 + effects.moveSpeedBonus);
}

/** The player's effective max health given the base max health and carried effects. */
export function effectiveMaxHealth(baseMaxHealth: number, effects: BuildEffects): number {
  return baseMaxHealth + effects.maxHealthAdd;
}
