/**
 * Loot content definitions (M2.1, `docs/CONTENT_AUTHORING.md` §5). Pure data —
 * `@carry-or-fall/simulation-core`'s `build-effects.ts` reads `points` and
 * `buildEffects`; no engine logic lives here. Ordinary loot has fixed,
 * non-random point values (concept §6.6): no item-quality randomness, no
 * random stat rolls, no procedural affixes.
 *
 * `buildEffects` only recognizes the five keys `build-effects.ts` actually
 * aggregates — a typed shape, not a free-form bag, so a mistyped key is a
 * compile error instead of a silently inert field (`docs/M2_ISSUES.md`
 * invariant, `docs/M2_EXECUTION_PLAN.md` §5.10). `signal`-leaning loot may
 * carry points with no `buildEffects` at all: homing/detection mechanics that
 * would consume a signal-flavored effect are M3/later, not this milestone
 * (`docs/M2_ISSUES.md` M2.4).
 *
 * Provenance (`docs/M2_EXECUTION_PLAN.md` §4): none of these six items appear
 * by name in either authoritative document. Concept §6.1-§6.5 describes each
 * point category qualitatively; concept §6.6 gives one worked example
 * (`Ancient Targeting Core`) whose shape this file's `LootDefinition` follows.
 * All point values, rarities, and `buildEffects` below are proposed and
 * balance-deferred (concept §12.3), like M1's weapon/enemy numbers.
 */
import type { ContentDefinition } from "./index";

export type LootRarity = "common" | "uncommon" | "rare" | "boss";

/**
 * The five permanent point categories (concept §6). Every ordinary loot item
 * contributes a fixed, non-negative amount to each.
 */
export interface LootPoints {
  readonly force: number;
  readonly precision: number;
  readonly motion: number;
  readonly guard: number;
  readonly signal: number;
}

/**
 * The build-effect keys `build-effects.ts` aggregates and caps. All optional:
 * an item may declare none, one, or several. Values are per-item
 * contributions summed across the carried inventory, then capped in shared
 * code (`docs/M2_ISSUES.md` M2.4) — never a multiplier applied per item, so
 * summing is well-defined regardless of stacking order.
 */
export interface LootBuildEffects {
  /** Flat bonus added to the weapon's damage for the attack actually used. */
  readonly damageAdd?: number;
  /** Fractional bonus that shortens the weapon's attack interval (0.1 = 10% faster). */
  readonly attackSpeedBonus?: number;
  /** Flat bonus added to a ranged weapon's projectile speed. */
  readonly projectileSpeedAdd?: number;
  /** Fractional bonus to the player's move speed (0.1 = 10% faster). */
  readonly moveSpeedBonus?: number;
  /** Flat bonus added to the player's max health. */
  readonly maxHealthAdd?: number;
}

export interface LootDefinition extends ContentDefinition {
  readonly kind: "loot";
  readonly rarity: LootRarity;
  readonly points: LootPoints;
  readonly buildEffects?: LootBuildEffects;
}

/** Common, force-leaning: modest flat damage. */
export const honingStone: LootDefinition = {
  id: "honing_stone",
  kind: "loot",
  rarity: "common",
  points: { force: 2, precision: 0, motion: 0, guard: 0, signal: 0 },
  buildEffects: { damageAdd: 3 },
} as const;

/** Uncommon, precision-leaning: faster projectiles. */
export const farsightLens: LootDefinition = {
  id: "farsight_lens",
  kind: "loot",
  rarity: "uncommon",
  points: { force: 0, precision: 3, motion: 0, guard: 0, signal: 1 },
  buildEffects: { projectileSpeedAdd: 80 },
} as const;

/** Common, motion-leaning: faster movement. */
export const quickstepCharm: LootDefinition = {
  id: "quickstep_charm",
  kind: "loot",
  rarity: "common",
  points: { force: 0, precision: 0, motion: 2, guard: 0, signal: 0 },
  buildEffects: { moveSpeedBonus: 0.08 },
} as const;

/** Common, guard-leaning: more max health. */
export const scrapPlating: LootDefinition = {
  id: "scrap_plating",
  kind: "loot",
  rarity: "common",
  points: { force: 0, precision: 0, motion: 0, guard: 2, signal: 0 },
  buildEffects: { maxHealthAdd: 15 },
} as const;

/**
 * Uncommon, signal-leaning: points only. Signal's active mechanics (homing,
 * detection) are not implemented this milestone (`docs/M2_ISSUES.md` M2.4),
 * so this item has no `buildEffects` — a loot item is not required to declare
 * one.
 */
export const resonantCore: LootDefinition = {
  id: "resonant_core",
  kind: "loot",
  rarity: "uncommon",
  points: { force: 0, precision: 1, motion: 0, guard: 0, signal: 3 },
} as const;

/** Rare, mixed: a high point total across every category, meant as secure-slot bait. */
export const warlordsSeal: LootDefinition = {
  id: "warlords_seal",
  kind: "loot",
  rarity: "rare",
  points: { force: 2, precision: 2, motion: 1, guard: 1, signal: 1 },
  buildEffects: { damageAdd: 5, attackSpeedBonus: 0.05 },
} as const;

/** Every loot definition M2 ships, in a fixed order used for the loot table (`loot-drop.ts`). */
export const ALL_LOOT: readonly LootDefinition[] = [
  honingStone,
  farsightLens,
  quickstepCharm,
  scrapPlating,
  resonantCore,
  warlordsSeal,
] as const;
