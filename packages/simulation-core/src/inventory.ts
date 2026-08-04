/**
 * The six-slot inventory and the secure slot (M2.2/M2.5, concept §7,
 * `docs/M2_ISSUES.md` M2.2/M2.5). Pure functions over a fixed-length array of
 * `LootDefinition | null` — no engine rule (movement, damage, rendering)
 * lives here.
 *
 * The secure slot is deliberately **not** a sixth inventory slot: it is a
 * separate single value (`SecureSlot`) so it can never be iterated alongside
 * ordinary inventory slots by accident, which matters because
 * `build-effects.ts`'s `aggregateBuildEffects` must never read it (concept
 * §7.2: a secured item "stops contributing to the current build").
 */
import {
  findSkill,
  isBossCore,
  type LootDefinition,
  type SkillDefinition,
} from "@carry-or-fall/game-content";

/** Concept §7.1: six normal inventory slots. */
export const INVENTORY_SIZE = 6;

/** A fixed-length-6 array; an empty slot is `null`. */
export type Inventory = readonly (LootDefinition | null)[];

/** A single secure slot (concept §7.2); `null` when empty. */
export type SecureSlot = LootDefinition | null;

/** A fresh, empty six-slot inventory. */
export function createEmptyInventory(): Inventory {
  return Array.from<LootDefinition | null>({ length: INVENTORY_SIZE }).fill(null);
}

export interface InventoryAddResult {
  readonly inventory: Inventory;
  readonly added: boolean;
}

/**
 * Add `item` to the first empty slot. Refuses (does not throw) when every
 * slot is full — concept/technical-plan §32 "full inventory pickup": the item
 * is neither lost nor duplicated, the caller (`loot-drop.ts`) simply leaves
 * the ground loot in place.
 */
export function addItemToInventory(inventory: Inventory, item: LootDefinition): InventoryAddResult {
  const index = inventory.indexOf(null);
  if (index === -1) {
    return { inventory, added: false };
  }
  const next = inventory.slice();
  next[index] = item;
  return { inventory: next, added: true };
}

/** Empty one slot, discarding whatever it held (concept §7.1: "can be discarded"). No-op if already empty. */
export function discardInventorySlot(inventory: Inventory, slotIndex: number): Inventory {
  if (inventory[slotIndex] === undefined || inventory[slotIndex] === null) {
    return inventory;
  }
  const next = inventory.slice();
  next[slotIndex] = null;
  return next;
}

/** Swap the contents of two slots (concept §7.1: "can be rearranged"), including when one or both are empty. */
export function moveInventoryItem(
  inventory: Inventory,
  fromIndex: number,
  toIndex: number,
): Inventory {
  if (
    fromIndex === toIndex ||
    inventory[fromIndex] === undefined ||
    inventory[toIndex] === undefined
  ) {
    return inventory;
  }
  const next = inventory.slice();
  const temp = next[fromIndex] ?? null;
  next[fromIndex] = next[toIndex] ?? null;
  next[toIndex] = temp;
  return next;
}

export interface SecureItemResult {
  readonly inventory: Inventory;
  readonly secureSlot: SecureSlot;
  readonly secured: boolean;
}

/**
 * Move the item in `slotIndex` into the secure slot. Refuses (does not
 * throw), leaving both unchanged, when the slot is empty or the secure slot
 * already holds an item (concept/technical-plan §32 "full secure slot") —
 * there is deliberately no function that removes an item from the secure
 * slot once placed (concept §7.2: "cannot be removed during the run").
 */
export function secureItem(
  inventory: Inventory,
  slotIndex: number,
  secureSlot: SecureSlot,
): SecureItemResult {
  const item = inventory[slotIndex];
  if (item === undefined || item === null || secureSlot !== null) {
    return { inventory, secureSlot, secured: false };
  }
  return {
    inventory: discardInventorySlot(inventory, slotIndex),
    secureSlot: item,
    secured: true,
  };
}

export interface ActivateCoreResult {
  readonly inventory: Inventory;
  /** The skill the activated core grants, or `null` when nothing was activated. */
  readonly skill: SkillDefinition | null;
  readonly activated: boolean;
}

/**
 * Concept §11 option 1: activate a boss core now.
 *
 * **The core leaves the inventory.** That is the whole implementation of
 * "cannot be secured after activation" — `secureItem` moves an item *out of a
 * slot*, and after this there is no item in that slot to move. There is no
 * `activated` flag for a later check to forget to consult, and no message a
 * client could send to un-activate it (`docs/M7_ISSUES.md` §1.3).
 *
 * It is also the whole implementation of "is lost on death": an activated core
 * is not in the inventory, so the death path has nothing to drop, and it is not
 * in the secure slot, so nothing survives.
 *
 * Refuses — does not throw, matching {@link secureItem} — when the slot is
 * empty, holds ordinary loot rather than a core, or names a skill this build
 * does not have. The last case is a content-version disagreement, and refusing
 * is the conservative direction: a core that granted nothing is better than one
 * that granted `undefined`.
 */
export function activateBossCore(inventory: Inventory, slotIndex: number): ActivateCoreResult {
  const item = inventory[slotIndex];
  if (item === undefined || item === null || !isBossCore(item)) {
    return { inventory, skill: null, activated: false };
  }
  const skill = findSkill(item.bossCore.temporarySkillId);
  if (skill === null) {
    return { inventory, skill: null, activated: false };
  }
  return {
    inventory: discardInventorySlot(inventory, slotIndex),
    skill,
    activated: true,
  };
}

/** Every boss core currently in `inventory`, in slot order. */
export function bossCoresIn(inventory: Inventory): readonly LootDefinition[] {
  return inventory.filter((item): item is LootDefinition => item !== null && isBossCore(item));
}
