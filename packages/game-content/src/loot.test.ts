import { describe, expect, it } from "vitest";

import { ALL_LOOT, type LootBuildEffects, type LootDefinition } from "./loot";

const RECOGNIZED_BUILD_EFFECT_KEYS: readonly (keyof LootBuildEffects)[] = [
  "damageAdd",
  "attackSpeedBonus",
  "projectileSpeedAdd",
  "moveSpeedBonus",
  "maxHealthAdd",
];

function expectValidPoints(item: LootDefinition): void {
  for (const value of Object.values(item.points)) {
    expect(Number.isInteger(value)).toBe(true);
    expect(value).toBeGreaterThanOrEqual(0);
  }
}

describe("ALL_LOOT", () => {
  it("has at least one item", () => {
    expect(ALL_LOOT.length).toBeGreaterThan(0);
  });

  it("every item satisfies the shared loot shape", () => {
    for (const item of ALL_LOOT) {
      expect(item.kind).toBe("loot");
      expect(item.id.length).toBeGreaterThan(0);
      expect(["common", "uncommon", "rare", "boss"]).toContain(item.rarity);
      expectValidPoints(item);
    }
  });

  it("has unique ids", () => {
    const ids = ALL_LOOT.map((item) => item.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("declares no boss-rarity items (blueprints/boss cores are out of M2 scope)", () => {
    for (const item of ALL_LOOT) {
      expect(item.rarity).not.toBe("boss");
    }
  });

  it("every buildEffects key present is one the engine recognizes", () => {
    for (const item of ALL_LOOT) {
      if (item.buildEffects === undefined) {
        continue;
      }
      for (const key of Object.keys(item.buildEffects)) {
        expect(RECOGNIZED_BUILD_EFFECT_KEYS).toContain(key);
      }
    }
  });

  it("has at least one item contributing to each of the five point categories", () => {
    for (const category of ["force", "precision", "motion", "guard", "signal"] as const) {
      const hasContributor = ALL_LOOT.some((item) => item.points[category] > 0);
      expect(hasContributor).toBe(true);
    }
  });

  it("has at least one rare item with a higher total point value (secure-slot bait)", () => {
    const totalPoints = (item: LootDefinition): number => {
      const { force, precision, motion, guard, signal } = item.points;
      return force + precision + motion + guard + signal;
    };
    const commonTotals = ALL_LOOT.filter((item) => item.rarity === "common").map(totalPoints);
    const rareTotals = ALL_LOOT.filter((item) => item.rarity === "rare").map(totalPoints);
    expect(rareTotals.length).toBeGreaterThan(0);
    expect(Math.max(...rareTotals)).toBeGreaterThan(Math.max(...commonTotals));
  });
});
