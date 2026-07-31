import { describe, expect, it } from "vitest";
import type { LootDefinition } from "@carry-or-fall/game-content";

import { createEmptyInventory, type Inventory } from "./inventory";
import { addPointTotals, pointsFromLoot, sumInventoryPoints, ZERO_POINTS } from "./points";

function makeLoot(points: Partial<LootDefinition["points"]>): LootDefinition {
  return {
    id: "test_item",
    kind: "loot",
    rarity: "common",
    points: { force: 0, precision: 0, motion: 0, guard: 0, signal: 0, ...points },
  };
}

describe("addPointTotals", () => {
  it("sums category-by-category, not just a flat total", () => {
    const a = { force: 1, precision: 2, motion: 0, guard: 0, signal: 0 };
    const b = { force: 3, precision: 0, motion: 5, guard: 0, signal: 0 };
    expect(addPointTotals(a, b)).toEqual({
      force: 4,
      precision: 2,
      motion: 5,
      guard: 0,
      signal: 0,
    });
  });

  it("adding ZERO_POINTS is a no-op", () => {
    const a = { force: 1, precision: 2, motion: 3, guard: 4, signal: 5 };
    expect(addPointTotals(a, ZERO_POINTS)).toEqual(a);
  });
});

describe("pointsFromLoot", () => {
  it("reads the item's fixed points unchanged", () => {
    const item = makeLoot({ force: 2, signal: 4 });
    expect(pointsFromLoot(item)).toEqual(item.points);
  });
});

describe("sumInventoryPoints", () => {
  it("is zero for an empty inventory", () => {
    expect(sumInventoryPoints(createEmptyInventory())).toEqual(ZERO_POINTS);
  });

  it("sums exactly across a known set of non-empty slots, skipping empty ones", () => {
    const inventory: Inventory = createEmptyInventory();
    const withItems: Inventory = [
      makeLoot({ force: 2 }),
      null,
      makeLoot({ precision: 3, signal: 1 }),
      null,
      null,
      null,
    ];
    expect(inventory.length).toBe(withItems.length);
    expect(sumInventoryPoints(withItems)).toEqual({
      force: 2,
      precision: 3,
      motion: 0,
      guard: 0,
      signal: 1,
    });
  });
});
