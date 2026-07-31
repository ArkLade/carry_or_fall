import { describe, expect, it } from "vitest";
import type { LootDefinition, WeaponDefinition } from "@carry-or-fall/game-content";
import { basicBow, basicSword } from "@carry-or-fall/game-content";

import {
  aggregateBuildEffects,
  applyBuildEffectsToWeapon,
  effectiveMaxHealth,
  effectiveMoveSpeed,
  MAX_ATTACK_SPEED_BONUS,
  MAX_DAMAGE_ADD,
  MAX_HEALTH_ADD,
  MAX_MOVE_SPEED_BONUS,
  MAX_PROJECTILE_SPEED_ADD,
  NO_BUILD_EFFECTS,
} from "./build-effects";
import { addItemToInventory, createEmptyInventory, type Inventory } from "./inventory";

function lootWithEffects(
  id: string,
  buildEffects: NonNullable<LootDefinition["buildEffects"]> | undefined,
): LootDefinition {
  return {
    id,
    kind: "loot",
    rarity: "common",
    points: { force: 0, precision: 0, motion: 0, guard: 0, signal: 0 },
    ...(buildEffects === undefined ? {} : { buildEffects }),
  };
}

describe("aggregateBuildEffects", () => {
  it("is the no-op value for an empty inventory", () => {
    expect(aggregateBuildEffects(createEmptyInventory())).toEqual(NO_BUILD_EFFECTS);
  });

  it("ignores items with no buildEffects", () => {
    let inventory = createEmptyInventory();
    ({ inventory } = addItemToInventory(inventory, lootWithEffects("no-effects", undefined)));
    expect(aggregateBuildEffects(inventory)).toEqual(NO_BUILD_EFFECTS);
  });

  it("sums a recognized key across multiple items", () => {
    let inventory: Inventory = createEmptyInventory();
    ({ inventory } = addItemToInventory(inventory, lootWithEffects("a", { damageAdd: 3 })));
    ({ inventory } = addItemToInventory(inventory, lootWithEffects("b", { damageAdd: 5 })));
    expect(aggregateBuildEffects(inventory).damageAdd).toBe(8);
  });

  it("caps damageAdd even when six items would exceed it", () => {
    let inventory: Inventory = createEmptyInventory();
    for (let i = 0; i < 6; i += 1) {
      ({ inventory } = addItemToInventory(
        inventory,
        lootWithEffects(`item-${String(i)}`, { damageAdd: 20 }),
      ));
    }
    // 6 * 20 = 120, well past MAX_DAMAGE_ADD.
    expect(aggregateBuildEffects(inventory).damageAdd).toBe(MAX_DAMAGE_ADD);
  });

  it("caps attackSpeedBonus, moveSpeedBonus, projectileSpeedAdd, and maxHealthAdd under stacking", () => {
    let inventory: Inventory = createEmptyInventory();
    for (let i = 0; i < 6; i += 1) {
      ({ inventory } = addItemToInventory(
        inventory,
        lootWithEffects(`item-${String(i)}`, {
          attackSpeedBonus: 1,
          moveSpeedBonus: 1,
          projectileSpeedAdd: 1000,
          maxHealthAdd: 1000,
        }),
      ));
    }
    const effects = aggregateBuildEffects(inventory);
    expect(effects.attackSpeedBonus).toBe(MAX_ATTACK_SPEED_BONUS);
    expect(effects.moveSpeedBonus).toBe(MAX_MOVE_SPEED_BONUS);
    expect(effects.projectileSpeedAdd).toBe(MAX_PROJECTILE_SPEED_ADD);
    expect(effects.maxHealthAdd).toBe(MAX_HEALTH_ADD);
  });
});

describe("applyBuildEffectsToWeapon", () => {
  it("is a no-op under NO_BUILD_EFFECTS", () => {
    expect(applyBuildEffectsToWeapon(basicSword, NO_BUILD_EFFECTS)).toEqual(basicSword);
  });

  it("adds flat damage and shortens the attack interval, without mutating the source weapon", () => {
    const effects = { ...NO_BUILD_EFFECTS, damageAdd: 5, attackSpeedBonus: 1 };
    const effective = applyBuildEffectsToWeapon(basicSword, effects);
    expect(effective.damage).toBe(basicSword.damage + 5);
    expect(effective.attackIntervalMs).toBeCloseTo(basicSword.attackIntervalMs / 2);
    expect(basicSword.damage).toBe(12); // source untouched
  });

  it("increases projectile speed for a ranged weapon that declares one", () => {
    const effects = { ...NO_BUILD_EFFECTS, projectileSpeedAdd: 100 };
    const effective = applyBuildEffectsToWeapon(basicBow, effects);
    expect(effective.projectileSpeed).toBe((basicBow.projectileSpeed ?? 0) + 100);
  });

  it("leaves projectileSpeed undefined for a melee weapon that never declares one", () => {
    const effects = { ...NO_BUILD_EFFECTS, projectileSpeedAdd: 100 };
    const effective: WeaponDefinition = applyBuildEffectsToWeapon(basicSword, effects);
    expect(effective.projectileSpeed).toBeUndefined();
  });
});

describe("effectiveMoveSpeed / effectiveMaxHealth", () => {
  it("applies the fractional move-speed bonus", () => {
    expect(effectiveMoveSpeed(200, { ...NO_BUILD_EFFECTS, moveSpeedBonus: 0.1 })).toBeCloseTo(220);
  });

  it("applies the flat max-health bonus", () => {
    expect(effectiveMaxHealth(100, { ...NO_BUILD_EFFECTS, maxHealthAdd: 15 })).toBe(115);
  });
});
