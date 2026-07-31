import { describe, expect, it } from "vitest";
import type { LootDefinition } from "@carry-or-fall/game-content";

import {
  addItemToInventory,
  createEmptyInventory,
  discardInventorySlot,
  type Inventory,
  INVENTORY_SIZE,
  moveInventoryItem,
  secureItem,
} from "./inventory";

function makeLoot(id: string): LootDefinition {
  return {
    id,
    kind: "loot",
    rarity: "common",
    points: { force: 0, precision: 0, motion: 0, guard: 0, signal: 0 },
  };
}

describe("createEmptyInventory", () => {
  it("has exactly INVENTORY_SIZE slots, all empty", () => {
    const inventory = createEmptyInventory();
    expect(inventory.length).toBe(INVENTORY_SIZE);
    expect(inventory.every((slot) => slot === null)).toBe(true);
  });
});

describe("addItemToInventory", () => {
  it("fills the first empty slot", () => {
    const itemA = makeLoot("a");
    const itemB = makeLoot("b");
    let inventory = createEmptyInventory();
    ({ inventory } = addItemToInventory(inventory, itemA));
    ({ inventory } = addItemToInventory(inventory, itemB));
    expect(inventory[0]).toBe(itemA);
    expect(inventory[1]).toBe(itemB);
  });

  it("fills the first empty slot even when an earlier slot is empty due to a discard", () => {
    let inventory = createEmptyInventory();
    ({ inventory } = addItemToInventory(inventory, makeLoot("a")));
    ({ inventory } = addItemToInventory(inventory, makeLoot("b")));
    inventory = discardInventorySlot(inventory, 0);
    const result = addItemToInventory(inventory, makeLoot("c"));
    expect(result.added).toBe(true);
    expect(result.inventory[0]?.id).toBe("c");
  });

  it("refuses without losing or duplicating anything when every slot is full", () => {
    let inventory: Inventory = createEmptyInventory();
    for (let i = 0; i < INVENTORY_SIZE; i += 1) {
      ({ inventory } = addItemToInventory(inventory, makeLoot(`item-${String(i)}`)));
    }
    const before = inventory;
    const result = addItemToInventory(inventory, makeLoot("overflow"));
    expect(result.added).toBe(false);
    expect(result.inventory).toBe(before);
    expect(result.inventory.some((slot) => slot?.id === "overflow")).toBe(false);
  });
});

describe("discardInventorySlot", () => {
  it("empties a filled slot", () => {
    let inventory = createEmptyInventory();
    ({ inventory } = addItemToInventory(inventory, makeLoot("a")));
    inventory = discardInventorySlot(inventory, 0);
    expect(inventory[0]).toBeNull();
  });

  it("is a no-op on an already-empty slot", () => {
    const inventory = createEmptyInventory();
    expect(discardInventorySlot(inventory, 2)).toEqual(inventory);
  });
});

describe("moveInventoryItem", () => {
  it("swaps the contents of two slots", () => {
    const itemA = makeLoot("a");
    const itemB = makeLoot("b");
    let inventory = createEmptyInventory();
    ({ inventory } = addItemToInventory(inventory, itemA));
    ({ inventory } = addItemToInventory(inventory, itemB));
    inventory = moveInventoryItem(inventory, 0, 1);
    expect(inventory[0]).toBe(itemB);
    expect(inventory[1]).toBe(itemA);
  });

  it("swaps correctly when the target slot is empty", () => {
    const itemA = makeLoot("a");
    let inventory = createEmptyInventory();
    ({ inventory } = addItemToInventory(inventory, itemA));
    inventory = moveInventoryItem(inventory, 0, 3);
    expect(inventory[0]).toBeNull();
    expect(inventory[3]).toBe(itemA);
  });
});

describe("secureItem", () => {
  it("moves the item out of the inventory and into the secure slot", () => {
    const item = makeLoot("a");
    let inventory = createEmptyInventory();
    ({ inventory } = addItemToInventory(inventory, item));
    const result = secureItem(inventory, 0, null);
    expect(result.secured).toBe(true);
    expect(result.secureSlot).toBe(item);
    expect(result.inventory[0]).toBeNull();
  });

  it("refuses and changes nothing when the secure slot is already occupied", () => {
    const alreadySecured = makeLoot("already-secured");
    const item = makeLoot("a");
    let inventory = createEmptyInventory();
    ({ inventory } = addItemToInventory(inventory, item));
    const result = secureItem(inventory, 0, alreadySecured);
    expect(result.secured).toBe(false);
    expect(result.secureSlot).toBe(alreadySecured);
    expect(result.inventory).toBe(inventory);
    expect(result.inventory[0]).toBe(item);
  });

  it("refuses when the source slot is empty", () => {
    const inventory = createEmptyInventory();
    const result = secureItem(inventory, 0, null);
    expect(result.secured).toBe(false);
    expect(result.secureSlot).toBeNull();
  });
});
