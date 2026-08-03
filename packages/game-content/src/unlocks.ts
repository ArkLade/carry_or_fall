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
 * **Three sources, not one** (`docs/DECISIONS.md` D67, superseding D48).
 * Concept §19.2-§19.4 names three unlock *sources* — weapon blueprints, armor
 * blueprints, and boss skill cores. M5 could implement none of them, because
 * none existed as content, so it used the source that already had a numeric
 * basis: concept §6.1-§6.5 says of each point category, in as many words, that
 * it is "used to unlock or improve" specific content, so an unlock became a
 * threshold on an accumulated balance.
 *
 * **M7 creates the second source.** Boss skill cores are real content now
 * (`boss.ts`, `loot.ts`), so {@link BOSS_CORE_UNLOCKS} is the thing D48 said it
 * was deferring rather than denying. Blueprints stay unimplemented: there is
 * still no blueprint item kind and no armor system (concept §8.2).
 *
 * Balances are never decremented: concept §6 describes no spending, shop, or
 * refund mechanic, so thresholds are thresholds, not purchases — and a boss
 * unlock is not purchasable at any balance at all.
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

/**
 * How an account comes to hold an unlock (M7).
 *
 * Through M6 this was inferred from `requires`: null meant "default", non-null
 * meant "threshold". Boss cores are a third source (concept §19.4), and
 * inferring three states from one nullable field is how a fourth source becomes
 * a bug. So the discriminator is explicit, and `requires` goes back to meaning
 * only what it says — the threshold, when there is one.
 *
 * - `"default"` — every new account starts with it (concept §5.4).
 * - `"threshold"` — an accumulated point balance grants it (`docs/DECISIONS.md`
 *   D48, superseded in place by D67).
 * - `"boss_core"` — extracting or securing a boss core grants it (concept §11).
 *   Balances never grant one, however large they get.
 */
export type UnlockSource = "default" | "threshold" | "boss_core";

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
  readonly source: UnlockSource;
  /** The balance that grants it, and `null` for every source but `"threshold"`. */
  readonly requires: UnlockRequirement | null;
}

function defaultUnlock(id: string, unlockType: UnlockType): UnlockDefinition {
  return { id, kind: "unlock", unlockType, source: "default", requires: null };
}

/**
 * An unlock no balance can ever buy: it arrives only by surviving a run with the
 * boss core that grants it (concept §11 option 3).
 */
function bossCoreUnlock(id: string, unlockType: UnlockType): UnlockDefinition {
  return { id, kind: "unlock", unlockType, source: "boss_core", requires: null };
}

function thresholdUnlock(
  id: string,
  unlockType: UnlockType,
  category: PointCategory,
  amount: number,
): UnlockDefinition {
  return { id, kind: "unlock", unlockType, source: "threshold", requires: { category, amount } };
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

/**
 * Unlocks that arrive only from a boss core (M7, concept §11/§19.4).
 *
 * This is the source `docs/DECISIONS.md` D48 said did not exist yet and named
 * M7 as the milestone that would create it. D67 supersedes D48 in place rather
 * than leaving two records of the same rule (D62).
 *
 * There is exactly one, because M7 ships exactly one boss and one core. It is
 * `split_return`, the 2-slot rare skill (D65), and no accumulated balance
 * reaches it — which is what makes a core worth the risk decision concept §11
 * describes rather than a shortcut to something patience would have given.
 */
export const BOSS_CORE_UNLOCKS: readonly UnlockDefinition[] = [
  bossCoreUnlock("split_return", "skill"),
] as const;

/** Every unlock the game defines, defaults first. */
export const ALL_UNLOCKS: readonly UnlockDefinition[] = [
  ...DEFAULT_UNLOCKS,
  ...THRESHOLD_UNLOCKS,
  ...BOSS_CORE_UNLOCKS,
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
 * The unlock a boss core grants, or `null` if this core's id names none (M7).
 *
 * Separate from {@link unlocksEarnedAt} on purpose: a boss unlock is not earned
 * by a balance and must never be reachable by accumulating points, however many
 * a player has. The two sources meet only in the settlement's grant list.
 */
export function unlockForBossCore(permanentUnlockId: string): UnlockDefinition | null {
  return BOSS_CORE_UNLOCKS.find((unlock) => unlock.id === permanentUnlockId) ?? null;
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
