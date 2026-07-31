/**
 * The five permanent point categories (M2.3, concept §6, `docs/M2_ISSUES.md`
 * M2.3). Pure conversion of loot into a point delta — no persistence of any
 * kind (`docs/DECISIONS.md` D27): the caller decides what to do with the
 * resulting total (M2's caller is `run-result.ts`, which only ever displays
 * it locally).
 */
import type { Inventory } from "./inventory";
import type { LootDefinition } from "@carry-or-fall/game-content";

export interface PointTotals {
  readonly force: number;
  readonly precision: number;
  readonly motion: number;
  readonly guard: number;
  readonly signal: number;
}

export const ZERO_POINTS: PointTotals = {
  force: 0,
  precision: 0,
  motion: 0,
  guard: 0,
  signal: 0,
} as const;

/** Sum two point totals category-by-category. */
export function addPointTotals(a: PointTotals, b: PointTotals): PointTotals {
  return {
    force: a.force + b.force,
    precision: a.precision + b.precision,
    motion: a.motion + b.motion,
    guard: a.guard + b.guard,
    signal: a.signal + b.signal,
  };
}

/** One loot item's fixed point contribution (concept §6.6: no conversion formula, just the values). */
export function pointsFromLoot(item: LootDefinition): PointTotals {
  return item.points;
}

/** The combined point contribution of every non-empty inventory slot. */
export function sumInventoryPoints(inventory: Inventory): PointTotals {
  return inventory.reduce<PointTotals>(
    (total, item) => (item === null ? total : addPointTotals(total, pointsFromLoot(item))),
    ZERO_POINTS,
  );
}
