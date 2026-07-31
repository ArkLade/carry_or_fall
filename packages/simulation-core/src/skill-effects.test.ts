import { describe, expect, it } from "vitest";
import type { SkillDefinition } from "@carry-or-fall/game-content";

import {
  aggregateSkillEffects,
  applyDamageToPlayer,
  grantShield,
  MAX_ARC_DEGREES_ADD,
  MAX_HOMING_STRENGTH,
  MAX_RANGE_MULTIPLIER_ADD,
  MAX_RECOVERY_REDUCTION_ADD,
  MAX_SHIELD_HP,
  MAX_SHIELD_ON_HIT_ADD,
  MAX_STUN_CHANCE_ADD,
  MIN_DAMAGE_AFTER_BOUNCE_MULTIPLIER,
  NO_SKILL_EFFECTS,
} from "./skill-effects";

function makeSkill(
  id: string,
  requiresTags: readonly string[],
  effects: SkillDefinition["effects"],
): SkillDefinition {
  return { id, kind: "skill", slotCost: 1, requiresTags, effects, limits: {} };
}

describe("aggregateSkillEffects", () => {
  it("is the no-op value for no equipped skills", () => {
    expect(aggregateSkillEffects([], ["melee"])).toEqual(NO_SKILL_EFFECTS);
  });

  it("sums a recognized key across multiple compatible skills", () => {
    const a = makeSkill("a", ["projectile"], { bounceCountAdd: 1 });
    const b = makeSkill("b", ["projectile"], { bounceCountAdd: 2 });
    expect(aggregateSkillEffects([a, b], ["projectile"]).bounceCountAdd).toBe(3);
  });

  it("excludes a skill whose requiresTags does not overlap the weapon's tags", () => {
    const rangedOnly = makeSkill("ranged-only", ["projectile"], { bounceCountAdd: 5 });
    const effects = aggregateSkillEffects([rangedOnly], ["melee", "attack"]);
    expect(effects.bounceCountAdd).toBe(0);
  });

  it("includes a skill whose requiresTags overlaps only one of several weapon tags", () => {
    const attackTagged = makeSkill("shield", ["attack"], { shieldOnHitAdd: 4 });
    expect(aggregateSkillEffects([attackTagged], ["melee", "attack"]).shieldOnHitAdd).toBe(4);
    expect(aggregateSkillEffects([attackTagged], ["projectile", "attack"]).shieldOnHitAdd).toBe(4);
  });

  it("aggregates damageAfterBounceMultiplier as a product, not a sum", () => {
    const a = makeSkill("a", ["projectile"], { damageAfterBounceMultiplier: 0.8 });
    const b = makeSkill("b", ["projectile"], { damageAfterBounceMultiplier: 0.8 });
    const effects = aggregateSkillEffects([a, b], ["projectile"]);
    expect(effects.damageAfterBounceMultiplier).toBeCloseTo(0.64, 5);
  });

  it("floors the damageAfterBounceMultiplier product at MIN_DAMAGE_AFTER_BOUNCE_MULTIPLIER", () => {
    const a = makeSkill("a", ["projectile"], { damageAfterBounceMultiplier: 0.1 });
    const b = makeSkill("b", ["projectile"], { damageAfterBounceMultiplier: 0.1 });
    const effects = aggregateSkillEffects([a, b], ["projectile"]);
    expect(effects.damageAfterBounceMultiplier).toBe(MIN_DAMAGE_AFTER_BOUNCE_MULTIPLIER);
  });

  it("caps homingStrengthAdd, rangeMultiplierAdd, arcDegreesAdd, recoveryReductionAdd, stunChanceAdd, shieldOnHitAdd under stacking", () => {
    const stackTags = ["melee", "projectile", "attack"];
    const heavy = makeSkill("heavy", stackTags, {
      homingStrengthAdd: 5,
      rangeMultiplierAdd: 5,
      arcDegreesAdd: 999,
      recoveryReductionAdd: 5,
      stunChanceAdd: 5,
      shieldOnHitAdd: 999,
    });
    const effects = aggregateSkillEffects([heavy, heavy, heavy], stackTags);
    expect(effects.homingStrengthAdd).toBe(MAX_HOMING_STRENGTH);
    expect(effects.rangeMultiplierAdd).toBe(MAX_RANGE_MULTIPLIER_ADD);
    expect(effects.arcDegreesAdd).toBe(MAX_ARC_DEGREES_ADD);
    expect(effects.recoveryReductionAdd).toBe(MAX_RECOVERY_REDUCTION_ADD);
    expect(effects.stunChanceAdd).toBe(MAX_STUN_CHANCE_ADD);
    expect(effects.shieldOnHitAdd).toBe(MAX_SHIELD_ON_HIT_ADD);
  });

  it("does not clamp projectileCountAdd/bounceCountAdd/pierceCountAdd locally (owned by combat/caps.ts downstream)", () => {
    const huge = makeSkill("huge", ["projectile"], {
      projectileCountAdd: 999,
      bounceCountAdd: 999,
      pierceCountAdd: 999,
    });
    const effects = aggregateSkillEffects([huge], ["projectile"]);
    expect(effects.projectileCountAdd).toBe(999);
    expect(effects.bounceCountAdd).toBe(999);
    expect(effects.pierceCountAdd).toBe(999);
  });

  it("ORs returnEnabled across skills rather than counting them", () => {
    const a = makeSkill("a", ["projectile"], { returnEnabled: true });
    const b = makeSkill("b", ["projectile"], { returnEnabled: true });
    expect(aggregateSkillEffects([a, b], ["projectile"]).returnEnabled).toBe(true);
    expect(aggregateSkillEffects([], ["projectile"]).returnEnabled).toBe(false);
  });
});

describe("grantShield", () => {
  it("adds to the current shield, capped at MAX_SHIELD_HP", () => {
    expect(grantShield(0, 4)).toBe(4);
    expect(grantShield(MAX_SHIELD_HP - 1, 10)).toBe(MAX_SHIELD_HP);
  });
});

describe("applyDamageToPlayer", () => {
  it("drains shield before health", () => {
    const result = applyDamageToPlayer({ shieldHp: 10, health: 50 }, 6);
    expect(result).toEqual({ shieldHp: 4, health: 50 });
  });

  it("spills remaining damage into health once shield is exhausted", () => {
    const result = applyDamageToPlayer({ shieldHp: 5, health: 50 }, 12);
    expect(result).toEqual({ shieldHp: 0, health: 43 });
  });

  it("never drops health or shield below zero", () => {
    const result = applyDamageToPlayer({ shieldHp: 0, health: 5 }, 999);
    expect(result).toEqual({ shieldHp: 0, health: 0 });
  });
});
