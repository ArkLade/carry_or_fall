import { describe, expect, it } from "vitest";
import type { SkillDefinition } from "@carry-or-fall/game-content";

import { createSkillLoadout, MAX_SKILL_SLOTS } from "./skill-loadout";

function makeSkill(id: string, slotCost: 1 | 2): SkillDefinition {
  return {
    id,
    kind: "skill",
    slotCost,
    requiresTags: ["melee"],
    effects: { arcDegreesAdd: 1 },
    limits: {},
  };
}

const oneA = makeSkill("one-a", 1);
const oneB = makeSkill("one-b", 1);
const oneC = makeSkill("one-c", 1);
const twoA = makeSkill("two-a", 2);
const AVAILABLE = [oneA, oneB, oneC, twoA];

describe("createSkillLoadout", () => {
  it("accepts an empty selection", () => {
    const result = createSkillLoadout([], AVAILABLE);
    expect(result).toEqual({ ok: true, loadout: [] });
  });

  it("accepts three 1-slot skills (exactly at the budget)", () => {
    const result = createSkillLoadout(["one-a", "one-b", "one-c"], AVAILABLE);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected ok");
    expect(result.loadout).toEqual([oneA, oneB, oneC]);
  });

  it("accepts the one 2-slot skill plus a 1-slot skill (3 total)", () => {
    const result = createSkillLoadout(["two-a", "one-a"], AVAILABLE);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected ok");
    expect(result.loadout).toEqual([twoA, oneA]);
  });

  it("rejects the 2-slot skill plus two 1-slot skills (4 total)", () => {
    const result = createSkillLoadout(["two-a", "one-a", "one-b"], AVAILABLE);
    expect(result).toEqual({ ok: false, reason: "slot_budget_exceeded" });
  });

  it("rejects four 1-slot skills (4 total, over MAX_SKILL_SLOTS)", () => {
    expect(MAX_SKILL_SLOTS).toBe(3);
    const fourth = makeSkill("one-d", 1);
    const result = createSkillLoadout(["one-a", "one-b", "one-c", "one-d"], [...AVAILABLE, fourth]);
    expect(result).toEqual({ ok: false, reason: "slot_budget_exceeded" });
  });

  it("rejects an unknown skill id", () => {
    const result = createSkillLoadout(["does-not-exist"], AVAILABLE);
    expect(result).toEqual({ ok: false, reason: "unknown_skill" });
  });

  it("rejects a duplicate skill id, even if it would fit the budget", () => {
    const result = createSkillLoadout(["one-a", "one-a"], AVAILABLE);
    expect(result).toEqual({ ok: false, reason: "duplicate_skill" });
  });

  it("does not mutate or clamp — a rejected result carries no partial loadout", () => {
    const result = createSkillLoadout(["two-a", "one-a", "one-b"], AVAILABLE);
    expect(result.ok).toBe(false);
    expect("loadout" in result).toBe(false);
  });
});
