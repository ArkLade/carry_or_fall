/**
 * Ending a local run (M2.8, `docs/M2_ISSUES.md` M2.8). Death and a successful
 * extraction both end the run but convert carried loot differently (concept
 * §4.3 vs §4.4) — this is the M2 exit criterion "death and extraction differ
 * correctly":
 *
 * - **Death:** only the secure slot converts to points; every non-empty
 *   inventory slot drops on the ground instead (dropped, not converted).
 * - **Extraction:** both the secure slot and every inventory item convert.
 *
 * The result is never persisted (`docs/DECISIONS.md` D27) — the caller
 * (`simulation.ts`) only ever stores it on `World.runResult` for the client
 * to display once.
 */
import type { Inventory, SecureSlot } from "./inventory";
import { addPointTotals, pointsFromLoot, sumInventoryPoints, ZERO_POINTS } from "./points";
import type { RunResult } from "./world";

function countNonEmpty(inventory: Inventory): number {
  return inventory.filter((item) => item !== null).length;
}

/** Build the `RunResult` for a death: only the secure slot converts; the inventory is lost, not converted. */
export function buildDeathResult(inventory: Inventory, secureSlot: SecureSlot): RunResult {
  const secureSlotPoints = secureSlot === null ? ZERO_POINTS : pointsFromLoot(secureSlot);
  return {
    outcome: "died",
    pointsGained: secureSlotPoints,
    itemsConverted: secureSlot === null ? 0 : 1,
    itemsLost: countNonEmpty(inventory),
  };
}

/** Build the `RunResult` for a successful extraction: both the secure slot and the inventory convert. */
export function buildExtractionResult(inventory: Inventory, secureSlot: SecureSlot): RunResult {
  const secureSlotPoints = secureSlot === null ? ZERO_POINTS : pointsFromLoot(secureSlot);
  return {
    outcome: "extracted",
    pointsGained: addPointTotals(secureSlotPoints, sumInventoryPoints(inventory)),
    itemsConverted: (secureSlot === null ? 0 : 1) + countNonEmpty(inventory),
    itemsLost: 0,
  };
}
