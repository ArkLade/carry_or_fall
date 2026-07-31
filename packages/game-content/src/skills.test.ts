import { describe, expect, it } from "vitest";

import { ALL_SKILLS, type SkillDefinition, type SkillEffects } from "./skills";

const RECOGNIZED_EFFECT_KEYS: readonly (keyof SkillEffects)[] = [
  "projectileCountAdd",
  "bounceCountAdd",
  "damageAfterBounceMultiplier",
  "pierceCountAdd",
  "returnEnabled",
  "homingStrengthAdd",
  "rangeMultiplierAdd",
  "arcDegreesAdd",
  "recoveryReductionAdd",
  "stunChanceAdd",
  "shieldOnHitAdd",
];

const KNOWN_TAGS = ["melee", "projectile", "attack"];

describe("ALL_SKILLS", () => {
  it("has between 8 and 10 skills (technical plan §38 M3)", () => {
    expect(ALL_SKILLS.length).toBeGreaterThanOrEqual(8);
    expect(ALL_SKILLS.length).toBeLessThanOrEqual(10);
  });

  it("every skill satisfies the shared skill shape", () => {
    for (const skill of ALL_SKILLS) {
      expect(skill.kind).toBe("skill");
      expect(skill.id.length).toBeGreaterThan(0);
      expect([1, 2]).toContain(skill.slotCost);
      expect(skill.requiresTags.length).toBeGreaterThan(0);
      for (const tag of skill.requiresTags) {
        expect(KNOWN_TAGS).toContain(tag);
      }
    }
  });

  it("has unique ids", () => {
    const ids = ALL_SKILLS.map((skill) => skill.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("every effects key present is one the engine recognizes", () => {
    for (const skill of ALL_SKILLS) {
      for (const key of Object.keys(skill.effects)) {
        expect(RECOGNIZED_EFFECT_KEYS).toContain(key);
      }
    }
  });

  it("every skill declares at least one effect", () => {
    for (const skill of ALL_SKILLS) {
      expect(Object.keys(skill.effects).length).toBeGreaterThan(0);
    }
  });

  it("exactly one skill costs two slots (the one rare skill, docs/M3_ISSUES.md §1)", () => {
    const twoSlotSkills = ALL_SKILLS.filter((skill) => skill.slotCost === 2);
    expect(twoSlotSkills).toHaveLength(1);
    expect(twoSlotSkills[0]!.id).toBe("returning_shot");
  });

  it("has at least one skill requiring each known tag", () => {
    for (const tag of KNOWN_TAGS) {
      expect(ALL_SKILLS.some((skill) => skill.requiresTags.includes(tag))).toBe(true);
    }
  });

  it("has a producer for every recognized effect key", () => {
    for (const key of RECOGNIZED_EFFECT_KEYS) {
      const hasProducer = ALL_SKILLS.some((skill) =>
        Object.prototype.hasOwnProperty.call(skill.effects, key),
      );
      expect(hasProducer).toBe(true);
    }
  });

  it("ricochet matches concept §29.2's worked example exactly", () => {
    const ricochet = ALL_SKILLS.find((skill) => skill.id === "ricochet");
    expect(ricochet).toBeDefined();
    const definition = ricochet as SkillDefinition;
    expect(definition.slotCost).toBe(1);
    expect(definition.requiresTags).toEqual(["projectile"]);
    expect(definition.effects.bounceCountAdd).toBe(1);
    expect(definition.effects.damageAfterBounceMultiplier).toBe(0.8);
    expect(definition.limits.maximumTotalBounces).toBe(3);
  });
});
