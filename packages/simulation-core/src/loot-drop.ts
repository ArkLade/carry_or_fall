/**
 * Ground loot: choosing what a kill drops, placing it in the world, and
 * picking it up (M2.6, `docs/M2_ISSUES.md` M2.6). `ALL_LOOT` (`@carry-or-fall
 * /game-content`) is the fixed loot table M2 ships; no rarity weighting is
 * applied (a flat, uniform choice) — weighting is a balance concern deferred
 * to playtesting, like every other proposed number this milestone.
 */
import { ALL_LOOT, type LootDefinition } from "@carry-or-fall/game-content";

import { circleIntersectsCircle } from "./collision";
import { addItemToInventory } from "./inventory";
import type { Inventory } from "./inventory";
import type { Rng } from "./prng";
import type { GroundLoot, Vec2 } from "./world";

/** Proposed pickup radius for a ground-loot entity, in pixels. */
export const GROUND_LOOT_RADIUS_PX = 20;

/** Choose one loot definition from `table` via the seeded RNG (no `Math.random`). */
export function chooseLootDrop(
  rng: Rng,
  table: readonly LootDefinition[] = ALL_LOOT,
): LootDefinition {
  return table[rng.nextInt(table.length)]!;
}

/**
 * Place `definition` on the ground at `position` under the caller-supplied
 * `id` — the caller decides the id (e.g. derived from the enemy that dropped
 * it, or the scattered-placement index) so it stays unique and stable
 * without a hidden module-level counter (matching `enemy.ts`'s `spawnEnemy`
 * pattern).
 */
export function spawnGroundLoot(
  definition: LootDefinition,
  position: Vec2,
  id: string,
  radius: number = GROUND_LOOT_RADIUS_PX,
): GroundLoot {
  return { id, definition, position, radius };
}

/** Whether `actor` (the player) currently overlaps `groundLoot`'s pickup radius. */
export function isNearGroundLoot(
  actor: { readonly position: Vec2; readonly radius: number },
  groundLoot: GroundLoot,
): boolean {
  return circleIntersectsCircle(
    { position: actor.position, radius: actor.radius },
    { position: groundLoot.position, radius: groundLoot.radius },
  );
}

export interface PickupResult {
  readonly inventory: Inventory;
  readonly pickedUp: boolean;
}

/**
 * Attempt to add `groundLoot`'s item to `inventory`. Refused (not thrown)
 * when the inventory is full — the caller (`simulation.ts`) leaves the
 * ground entity in place on refusal (§32 "full inventory pickup").
 */
export function attemptPickup(inventory: Inventory, groundLoot: GroundLoot): PickupResult {
  const { inventory: next, added } = addItemToInventory(inventory, groundLoot.definition);
  return { inventory: next, pickedUp: added };
}
