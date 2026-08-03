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

/**
 * What makes a boss core a boss core (M7, concept §11 and §29.4's worked
 * example). Present only on `rarity: "boss"` items.
 *
 * A core is **loot carrying this record**, not a separate inventory type
 * (`docs/M7_ISSUES.md` §1.1, `docs/DECISIONS.md` D65). It is picked up,
 * dropped on death, secured, and converted on extraction by exactly the code
 * that already does those things for ordinary loot; a separate kind would have
 * meant a second implementation of five working paths in order to behave the
 * same.
 */
export interface BossCoreRecord {
  /** The skill this core grants as the wildcard when activated (concept §11 option 1). */
  readonly temporarySkillId: string;
  /** The skill this core permanently unlocks when it survives the run (option 3). */
  readonly permanentUnlockId: string;
  /** Concept §29.4's field. A core the secure slot refuses would be option 3 with no option 3. */
  readonly secureSlotAllowed: boolean;
  /**
   * What a *duplicate* converts into (concept §11: duplicates "convert into
   * progression points or mastery progress"; M7 takes points, D68).
   *
   * This is deliberately **not** the item's `points`. A boss core's `points`
   * are zero, so a first core awards an unlock and nothing else, and only a
   * core whose unlock the account already holds converts — which is what keeps
   * "first" and "duplicate" distinguishable, and therefore demonstrable
   * (technical plan §38 M7's first exit criterion).
   */
  readonly duplicateConversion: LootPoints;
}

export interface LootDefinition extends ContentDefinition {
  readonly kind: "loot";
  readonly rarity: LootRarity;
  readonly points: LootPoints;
  readonly buildEffects?: LootBuildEffects;
  /** Present exactly when `rarity` is `"boss"`; see {@link BossCoreRecord}. */
  readonly bossCore?: BossCoreRecord;
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

/**
 * The one boss core M7 ships (concept §29.4's worked example, realized).
 *
 * Its `points` are zero and its `buildEffects` absent **while carried
 * normally**, which is concept §11 option 2's "may provide passive temporary
 * power" read conservatively: the option permits passive power, it does not
 * require it, and inventing a number for it would have made the carry branch
 * the strongest of the three by default. What option 2 does give — that it stays
 * lootable off your body and can be extracted for the unlock — is real and
 * tested (`docs/M7_ISSUES.md` §11.2).
 *
 * `duplicateConversion` follows §29.4's example proportions (signal-heavy, with
 * a precision component) scaled to this project's point economy, where an
 * ordinary item carries 2-4 points in its leaning category. A duplicate core is
 * worth appreciably more than an ordinary item and appreciably less than a
 * threshold: it should feel like progress, not like a shortcut.
 */
export const splitReturnCore: LootDefinition = {
  id: "split_return_core",
  kind: "loot",
  rarity: "boss",
  points: { force: 0, precision: 0, motion: 0, guard: 0, signal: 0 },
  bossCore: {
    temporarySkillId: "split_return",
    permanentUnlockId: "split_return",
    secureSlotAllowed: true,
    duplicateConversion: { force: 0, precision: 3, motion: 0, guard: 0, signal: 5 },
  },
} as const;

/**
 * Every boss core the game defines.
 *
 * Deliberately **not** part of {@link ALL_LOOT}: that list is the random drop
 * table `loot-drop.ts` picks from, and a core must only ever enter the world
 * from the boss that dropped it. `loot.test.ts` asserts the two lists do not
 * intersect, because "cores come from bosses" is otherwise a property of a
 * table that a later content edit could quietly break.
 */
export const ALL_BOSS_CORES: readonly LootDefinition[] = [splitReturnCore] as const;

/** Whether this definition is a boss core — the one place that test is written. */
export function isBossCore(
  item: LootDefinition,
): item is LootDefinition & { readonly bossCore: BossCoreRecord } {
  return item.bossCore !== undefined;
}

/**
 * Look up one loot item by id. Added in M5 for crash recovery: a
 * `secure_reservations` row stores the item **id**, because the database holds
 * no copy of this table (`docs/DATA_MODEL.md` §3.3), so finalizing a reservation
 * after a server crash means resolving that id back to its point values here.
 */
export function findLoot(lootId: string): LootDefinition | null {
  return (
    ALL_LOOT.find((item) => item.id === lootId) ??
    ALL_BOSS_CORES.find((item) => item.id === lootId) ??
    null
  );
}

/** Every loot definition M2 ships, in a fixed order used for the loot table (`loot-drop.ts`). */
export const ALL_LOOT: readonly LootDefinition[] = [
  honingStone,
  farsightLens,
  quickstepCharm,
  scrapPlating,
  resonantCore,
  warlordsSeal,
] as const;
