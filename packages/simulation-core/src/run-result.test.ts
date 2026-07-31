import { describe, expect, it } from "vitest";
import type { LootDefinition } from "@carry-or-fall/game-content";

import { addItemToInventory, createEmptyInventory, type Inventory } from "./inventory";
import { buildDeathResult, buildExtractionResult } from "./run-result";

function makeLoot(id: string, points: Partial<LootDefinition["points"]>): LootDefinition {
  return {
    id,
    kind: "loot",
    rarity: "common",
    points: { force: 0, precision: 0, motion: 0, guard: 0, signal: 0, ...points },
  };
}

function filledInventory(): Inventory {
  let inventory = createEmptyInventory();
  ({ inventory } = addItemToInventory(inventory, makeLoot("a", { force: 2 })));
  ({ inventory } = addItemToInventory(inventory, makeLoot("b", { precision: 3 })));
  return inventory;
}

const SECURED = makeLoot("secured", { signal: 4 });

describe("buildDeathResult", () => {
  it("converts only the secure slot; the inventory is lost, not converted", () => {
    const result = buildDeathResult(filledInventory(), SECURED);
    expect(result.outcome).toBe("died");
    expect(result.pointsGained).toEqual({ force: 0, precision: 0, motion: 0, guard: 0, signal: 4 });
    expect(result.itemsConverted).toBe(1);
    expect(result.itemsLost).toBe(2);
  });

  it("reports zero converted and zero lost when both are empty", () => {
    const result = buildDeathResult(createEmptyInventory(), null);
    expect(result.pointsGained).toEqual({ force: 0, precision: 0, motion: 0, guard: 0, signal: 0 });
    expect(result.itemsConverted).toBe(0);
    expect(result.itemsLost).toBe(0);
  });
});

describe("buildExtractionResult", () => {
  it("converts both the secure slot and every inventory item", () => {
    const result = buildExtractionResult(filledInventory(), SECURED);
    expect(result.outcome).toBe("extracted");
    expect(result.pointsGained).toEqual({ force: 2, precision: 3, motion: 0, guard: 0, signal: 4 });
    expect(result.itemsConverted).toBe(3);
    expect(result.itemsLost).toBe(0);
  });
});

describe("death vs. extraction differ correctly (M2 exit criterion)", () => {
  it("the same starting state produces a different outcome and point total", () => {
    const inventory = filledInventory();
    const death = buildDeathResult(inventory, SECURED);
    const extraction = buildExtractionResult(inventory, SECURED);
    expect(death.outcome).not.toBe(extraction.outcome);
    expect(death.pointsGained).not.toEqual(extraction.pointsGained);
    expect(death.itemsLost).toBeGreaterThan(extraction.itemsLost);
  });
});
