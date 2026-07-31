import { ALL_LOOT } from "@carry-or-fall/game-content";
import { describe, expect, it } from "vitest";

import { createEmptyInventory } from "./inventory";
import {
  attemptPickup,
  chooseLootDrop,
  GROUND_LOOT_RADIUS_PX,
  isNearGroundLoot,
  spawnGroundLoot,
} from "./loot-drop";
import { createRng } from "./prng";

describe("chooseLootDrop", () => {
  it("is deterministic for a fixed seed", () => {
    expect(chooseLootDrop(createRng(5))).toBe(chooseLootDrop(createRng(5)));
  });

  it("only ever chooses an item from the table", () => {
    for (let seed = 0; seed < 20; seed += 1) {
      expect(ALL_LOOT).toContain(chooseLootDrop(createRng(seed)));
    }
  });
});

describe("spawnGroundLoot", () => {
  it("places the chosen definition at the given position with a pickup radius", () => {
    const definition = ALL_LOOT[0]!;
    const ground = spawnGroundLoot(definition, { x: 10, y: 20 }, "loot-0");
    expect(ground.definition).toBe(definition);
    expect(ground.position).toEqual({ x: 10, y: 20 });
    expect(ground.radius).toBe(GROUND_LOOT_RADIUS_PX);
    expect(ground.id).toBe("loot-0");
  });
});

describe("isNearGroundLoot", () => {
  const ground = spawnGroundLoot(ALL_LOOT[0]!, { x: 100, y: 100 }, "loot-0");

  it("detects overlap when the actor is close enough", () => {
    expect(isNearGroundLoot({ position: { x: 110, y: 100 }, radius: 16 }, ground)).toBe(true);
  });

  it("detects no overlap when the actor is far away", () => {
    expect(isNearGroundLoot({ position: { x: 10_000, y: 0 }, radius: 16 }, ground)).toBe(false);
  });
});

describe("attemptPickup", () => {
  it("adds the item and reports success when there is space", () => {
    const inventory = createEmptyInventory();
    const ground = spawnGroundLoot(ALL_LOOT[0]!, { x: 0, y: 0 }, "loot-0");
    const result = attemptPickup(inventory, ground);
    expect(result.pickedUp).toBe(true);
    expect(result.inventory[0]).toBe(ALL_LOOT[0]);
  });

  it("refuses and leaves the inventory unchanged when full", () => {
    let inventory = createEmptyInventory();
    for (let i = 0; i < inventory.length; i += 1) {
      inventory = attemptPickup(
        inventory,
        spawnGroundLoot(ALL_LOOT[0]!, { x: 0, y: 0 }, `loot-${String(i)}`),
      ).inventory;
    }
    const ground = spawnGroundLoot(ALL_LOOT[1]!, { x: 0, y: 0 }, "loot-overflow");
    const result = attemptPickup(inventory, ground);
    expect(result.pickedUp).toBe(false);
    expect(result.inventory).toBe(inventory);
  });
});
