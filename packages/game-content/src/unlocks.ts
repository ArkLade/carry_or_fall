/**
 * Unlock content definitions (M5.2, `docs/M5_ISSUES.md` §3,
 * `docs/CONTENT_AUTHORING.md` §9). Pure data plus two selectors over this same
 * table — no engine logic, no I/O, and no knowledge that a database exists.
 *
 * An unlock's `id` **is** the content id it grants (`stunning_blows`,
 * `basic_bow`), and `unlockType` says which table to look it up in. That is
 * deliberately the same shape the `unlocks` table stores
 * (`docs/DATA_MODEL.md` §3.3): a row there means only "this account has this
 * id", and what the id grants stays here, in the repository, versioned by
 * {@link CONTENT_VERSION}. The database holds no copy of this table.
 *
 * **Why point thresholds** (`docs/M5_ISSUES.md` §1.1): concept §19.2-§19.4 names
 * three unlock *sources* — weapon blueprints, armor blueprints, boss skill cores
 * — and none of them exists as content. There is no blueprint item kind, no
 * armor system (concept §8.2), and no boss (M7). Inventing them inside a
 * persistence milestone would be adding gameplay. What does have a numeric basis
 * is concept §6.1-§6.5, which says of each point category, in as many words,
 * that it is "used to unlock or improve" specific content. So an unlock is a
 * threshold on an accumulated balance, and each threshold below is mapped to the
 * category whose §6 description names its effect.
 *
 * Balances are never decremented (`docs/DECISIONS.md` D48): concept §6 describes
 * no spending, shop, or refund mechanic, so these are thresholds, not purchases.
 *
 * Provenance: the split between defaults and thresholds is proposed;
 * the threshold *amounts* are proposed and balance-deferred (concept §12.3),
 * like every other unsourced number in this repository. For scale: an ordinary
 * loot item carries 2-4 points in its leaning category (`loot.ts`), and a
 * successful extraction converts up to seven items, so a category-focused player
 * crosses 40 in roughly five to eight successful runs and 100 in something like
 * three times that. Concept §5.1 wants permanent progression to unlock variety
 * over time, not to gate the first hour.
 */
import type { ContentDefinition } from "./index";
import type { LootPoints } from "./loot";

/** Which content table an {@link UnlockDefinition}'s id names. */
export type UnlockType = "skill" | "weapon" | "armor";

/** The five permanent point categories (concept §6). */
export type PointCategory = keyof LootPoints;

/** An accumulated point balance, one number per category — the shape `point_balances` stores. */
export type PointBalances = LootPoints;

/** A single threshold: this much accumulated in this category. */
export interface UnlockRequirement {
  readonly category: PointCategory;
  readonly amount: number;
}

export interface UnlockDefinition extends ContentDefinition {
  readonly kind: "unlock";
  readonly unlockType: UnlockType;
  /**
   * `null` for an unlock every new account starts with (concept §5.4's "viable
   * default set"), otherwise the balance that grants it.
   */
  readonly requires: UnlockRequirement | null;
}

function defaultUnlock(id: string, unlockType: UnlockType): UnlockDefinition {
  return { id, kind: "unlock", unlockType, requires: null };
}

function thresholdUnlock(
  id: string,
  unlockType: UnlockType,
  category: PointCategory,
  amount: number,
): UnlockDefinition {
  return { id, kind: "unlock", unlockType, requires: { category, amount } };
}

/**
 * What a fresh account may bring on its first run (concept §5.4). It must
 * include `ricochet`, `extended_reach`, and `bulwark_strike`, because those are
 * the documented default loadout (`docs/DECISIONS.md` D31) and a default that a
 * new account cannot legally select would be a broken first experience rather
 * than a progression gate.
 *
 * Both weapons are here because M1 equips the player with both and no mechanic
 * chooses between them yet; they are listed rather than assumed so the account's
 * unlock set is the single answer to "what may this player bring".
 */
export const DEFAULT_UNLOCKS: readonly UnlockDefinition[] = [
  defaultUnlock("basic_sword", "weapon"),
  defaultUnlock("basic_bow", "weapon"),
  defaultUnlock("ricochet", "skill"),
  defaultUnlock("multishot", "skill"),
  defaultUnlock("extended_reach", "skill"),
  defaultUnlock("wide_arc", "skill"),
  defaultUnlock("bulwark_strike", "skill"),
] as const;

/**
 * Earned unlocks, each traced to the concept §6 sentence that names its effect:
 *
 * - Force §6.1 "stun strength", "heavy melee skills" → `stunning_blows`
 * - Precision §6.2 "penetration" → `piercing_rounds`
 * - Motion §6.3 "attack speed", "recovery speed" → `swift_strikes`
 * - Signal §6.5 "homing projectiles" → `homing_arrows`
 * - Signal §6.5 "unusual targeting" → `returning_shot`, the one 2-slot rare
 *   skill (`docs/DECISIONS.md` D29), hence the highest threshold.
 *
 * **Guard has no unlock, and that is a recorded gap, not an oversight**
 * (`docs/M5_ISSUES.md` §1.1). Concept §6.4's unlock targets are "armor types,
 * shield skills, defensive melee behavior": armor is unimplemented, and the one
 * shield skill is `bulwark_strike`, which is a default because D31's loadout
 * needs it. Guard points still accumulate and still count; there is simply
 * nothing yet for them to open. The milestone that adds armor closes this.
 */
export const THRESHOLD_UNLOCKS: readonly UnlockDefinition[] = [
  thresholdUnlock("stunning_blows", "skill", "force", 40),
  thresholdUnlock("piercing_rounds", "skill", "precision", 40),
  thresholdUnlock("swift_strikes", "skill", "motion", 40),
  thresholdUnlock("homing_arrows", "skill", "signal", 40),
  thresholdUnlock("returning_shot", "skill", "signal", 100),
] as const;

/** Every unlock the game defines, defaults first. */
export const ALL_UNLOCKS: readonly UnlockDefinition[] = [
  ...DEFAULT_UNLOCKS,
  ...THRESHOLD_UNLOCKS,
] as const;

/** The ids a new account is provisioned with (`docs/DATA_MODEL.md` §4.1). */
export const DEFAULT_UNLOCK_IDS: readonly string[] = DEFAULT_UNLOCKS.map((unlock) => unlock.id);

/** Look up one unlock definition by the content id it grants. */
export function findUnlock(unlockId: string): UnlockDefinition | null {
  return ALL_UNLOCKS.find((unlock) => unlock.id === unlockId) ?? null;
}

/**
 * Every threshold unlock a balance satisfies — inclusive at the threshold, so a
 * balance of exactly 40 earns the 40-point unlock.
 *
 * The caller passes this to settlement, which inserts the ids with
 * `on conflict do nothing`, so re-earning an unlock the account already holds is
 * a no-op rather than an error. That is why this function returns *everything*
 * satisfied rather than trying to compute a difference: a difference would
 * depend on state this pure function does not have, and would be wrong after a
 * partially-applied settlement.
 */
export function unlocksEarnedAt(balances: PointBalances): readonly UnlockDefinition[] {
  return THRESHOLD_UNLOCKS.filter(
    (unlock) =>
      unlock.requires !== null && balances[unlock.requires.category] >= unlock.requires.amount,
  );
}

/**
 * Which of `requestedIds` this account may **not** use — the technical plan §19
 * check, expressed as data rather than as a rule the caller has to remember.
 *
 * An id with no unlock definition at all is reported as locked. That is the
 * conservative direction: content nobody defined an unlock for should not be
 * silently available, and `unlocks.test.ts` asserts every shipped skill has
 * exactly one definition, so the case is unreachable for real content.
 */
export function lockedContentIds(
  requestedIds: readonly string[],
  unlockedIds: readonly string[],
): readonly string[] {
  const owned = new Set(unlockedIds);
  return requestedIds.filter((id) => !owned.has(id));
}
