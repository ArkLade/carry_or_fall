import { describe, expect, it } from "vitest";

import { ALL_BOSS_CORES } from "./loot";
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
  "splitCountAdd",
];

const KNOWN_TAGS = ["melee", "projectile", "attack"];

describe("ALL_SKILLS", () => {
  it("ships M3's eight-to-ten ordinary skills, plus one boss skill per milestone", () => {
    // Technical plan §38 M3's "8 to 10" scoped *that* milestone, not the game's
    // total skill count (`docs/DECISIONS.md` D33), and §38 M7 sets no count at
    // all. So the invariant worth asserting is the one that still means
    // something: every skill beyond M3's ten arrived with a boss core, and there
    // is exactly one boss core per boss.
    const bossSkillIds = new Set(ALL_BOSS_CORES.map((core) => core.bossCore!.temporarySkillId));
    const ordinary = ALL_SKILLS.filter((skill) => !bossSkillIds.has(skill.id));

    expect(ordinary.length).toBeGreaterThanOrEqual(8);
    expect(ordinary.length).toBeLessThanOrEqual(10);
    expect(ALL_SKILLS.length).toBe(ordinary.length + bossSkillIds.size);
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

  it("costs two slots only for skills strong enough to have earned it", () => {
    // M3 shipped exactly one (`docs/DECISIONS.md` D29). M7 adds the second, and
    // it is the boss skill: concept §11 says "strong boss skills may require two
    // permanent skill slots", and §34 listed that as open until D65 answered it.
    // The assertion is the *set*, not the count, so a third two-slot skill has to
    // be a deliberate edit here rather than a number quietly ticking up.
    const twoSlotIds = ALL_SKILLS.filter((skill) => skill.slotCost === 2).map((skill) => skill.id);
    expect([...twoSlotIds].sort()).toEqual(["returning_shot", "split_return"]);
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
