/**
 * The permanent skill loadout: up to three pre-run skill slots (M3.2, concept
 * §8.3, `docs/M3_ISSUES.md` M3.2). Pure validation over `ALL_SKILLS` — no
 * engine rule (combat, aggregation) lives here; `skill-effects.ts` consumes
 * the resulting `SkillLoadout`.
 *
 * Structural invalidity (an unknown id, a duplicate id, or a selection whose
 * summed `slotCost` exceeds the budget) is **rejected**, never clamped —
 * there is no sensible "smaller" version of an over-budget or nonsensical
 * selection, the same treatment M2 gave a full inventory or an already-
 * occupied secure slot (refused, not silently trimmed). This is distinct from
 * `skill-effects.ts`'s caps, which clamp a *legal* loadout's summed effect
 * magnitude (`docs/M3_ISSUES.md` §1).
 */
import { ALL_SKILLS, type SkillDefinition } from "@carry-or-fall/game-content";

/** Concept §8.3: three permanent skill slots, same count for every player. */
export const MAX_SKILL_SLOTS = 3;

/** Up to three chosen skills; not required to fill every slot. */
export type SkillLoadout = readonly SkillDefinition[];

/** The no-skills-chosen loadout. */
export const EMPTY_SKILL_LOADOUT: SkillLoadout = [] as const;

export type SkillLoadoutRejectionReason =
  "unknown_skill" | "duplicate_skill" | "slot_budget_exceeded";

export type SkillLoadoutResult =
  | { readonly ok: true; readonly loadout: SkillLoadout }
  | { readonly ok: false; readonly reason: SkillLoadoutRejectionReason };

/**
 * Validate a proposed loadout by skill id. Rejects (does not clamp) an
 * unknown id, a duplicate id, or a selection whose summed `slotCost` exceeds
 * {@link MAX_SKILL_SLOTS}. `availableSkills` defaults to `ALL_SKILLS` but is
 * parameterized for tests.
 */
export function createSkillLoadout(
  skillIds: readonly string[],
  availableSkills: readonly SkillDefinition[] = ALL_SKILLS,
): SkillLoadoutResult {
  const loadout: SkillDefinition[] = [];
  const seenIds = new Set<string>();
  let totalSlotCost = 0;

  for (const id of skillIds) {
    if (seenIds.has(id)) {
      return { ok: false, reason: "duplicate_skill" };
    }
    seenIds.add(id);

    const definition = availableSkills.find((skill) => skill.id === id);
    if (definition === undefined) {
      return { ok: false, reason: "unknown_skill" };
    }

    totalSlotCost += definition.slotCost;
    loadout.push(definition);
  }

  if (totalSlotCost > MAX_SKILL_SLOTS) {
    return { ok: false, reason: "slot_budget_exceeded" };
  }

  return { ok: true, loadout };
}
