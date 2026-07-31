import { describe, expect, it } from "vitest";

import { basicBow, basicSword } from "@carry-or-fall/game-content";

import { NO_SKILL_EFFECTS } from "../skill-effects";
import {
  applyCarriedLootModifiers,
  applyDamage,
  applyEquippedSkills,
  prepareAttack,
} from "./pipeline";
import type { AttackActor, AttackTarget } from "./pipeline";

const ACTOR: AttackActor = { position: { x: 0, y: 0 }, facing: 0, radius: 16 };

describe("prepareAttack (stages 1-5)", () => {
  it("refuses an actor with a non-finite position or facing (stage 1: validate actor)", () => {
    const badPosition = prepareAttack(
      { position: { x: NaN, y: 0 }, facing: 0, radius: 16 },
      basicSword,
      0,
    );
    expect(badPosition).toEqual({ ready: false, reason: "invalid_actor" });

    const badFacing = prepareAttack(
      { position: { x: 0, y: 0 }, facing: Infinity, radius: 16 },
      basicSword,
      0,
    );
    expect(badFacing).toEqual({ ready: false, reason: "invalid_actor" });
  });

  it("refuses an attack while the cooldown has not elapsed (stage 2: check cooldown)", () => {
    const result = prepareAttack(ACTOR, basicSword, 250);
    expect(result).toEqual({ ready: false, reason: "cooldown" });
  });

  it("builds a definition from the actor and weapon once cooldown has elapsed (stage 3)", () => {
    const result = prepareAttack(ACTOR, basicSword, 0);
    expect(result.ready).toBe(true);
    if (!result.ready) throw new Error("expected ready");
    // Stages 4-5 (equipped skills M3, carried-loot modifiers M2) always
    // return an effective copy, even under the "no effect" defaults, so this
    // is equal-by-value, not the same reference as `basicSword`.
    expect(result.definition.weapon).toEqual(basicSword);
    expect(result.definition.origin).toEqual(ACTOR.position);
    expect(result.definition.facing).toBe(ACTOR.facing);
    expect(result.definition.skillEffects).toEqual(NO_SKILL_EFFECTS);
  });

  it("also allows an attack exactly at zero remaining cooldown (boundary, not just below it)", () => {
    expect(prepareAttack(ACTOR, basicSword, 0).ready).toBe(true);
  });
});

describe("pass-through stages under the 'no effect' defaults", () => {
  it("applyEquippedSkills does not alter the attack definition under NO_SKILL_EFFECTS", () => {
    const result = prepareAttack(ACTOR, basicSword, 0);
    if (!result.ready) throw new Error("expected ready");
    expect(applyEquippedSkills(result.definition)).toEqual(result.definition);
  });

  it("applyCarriedLootModifiers does not alter the attack definition under NO_BUILD_EFFECTS", () => {
    const result = prepareAttack(ACTOR, basicSword, 0);
    if (!result.ready) throw new Error("expected ready");
    expect(applyCarriedLootModifiers(result.definition)).toEqual(result.definition);
  });
});

describe("applyEquippedSkills (stage 4, M3)", () => {
  it("widens a melee weapon's range and arc, and shortens its recovery", () => {
    const result = prepareAttack(ACTOR, basicSword, 0);
    if (!result.ready) throw new Error("expected ready");
    const skillEffects = {
      ...NO_SKILL_EFFECTS,
      rangeMultiplierAdd: 0.5,
      arcDegreesAdd: 20,
      recoveryReductionAdd: 0.5,
    };
    const effective = applyEquippedSkills(result.definition, skillEffects);
    expect(effective.weapon.rangePx).toBeCloseTo(basicSword.rangePx! * 1.5);
    expect(effective.weapon.arcDegrees).toBe(basicSword.arcDegrees! + 20);
    expect(effective.weapon.recoveryMs).toBeCloseTo(basicSword.recoveryMs! * 0.5);
    expect(effective.skillEffects).toEqual(skillEffects);
  });

  it("adds to a ranged weapon's projectile count and leaves melee-only fields untouched", () => {
    const result = prepareAttack(ACTOR, basicBow, 0);
    if (!result.ready) throw new Error("expected ready");
    const skillEffects = { ...NO_SKILL_EFFECTS, projectileCountAdd: 3 };
    const effective = applyEquippedSkills(result.definition, skillEffects);
    expect(effective.weapon.projectileCount).toBe((basicBow.projectileCount ?? 0) + 3);
    expect(effective.weapon.rangePx).toBeUndefined();
  });

  it("clamps the effective stunChance to [0, 1]", () => {
    const swordWithBaseStun = { ...basicSword, stunChance: 0.8 };
    const result = prepareAttack(ACTOR, swordWithBaseStun, 0);
    if (!result.ready) throw new Error("expected ready");
    const skillEffects = { ...NO_SKILL_EFFECTS, stunChanceAdd: 0.5 };
    const effective = applyEquippedSkills(result.definition, skillEffects);
    expect(effective.weapon.stunChance).toBe(1);
  });
});

describe("applyDamage", () => {
  const target: AttackTarget = { id: "t1", position: { x: 10, y: 10 }, radius: 8, health: 20 };

  it("reduces health by the damage amount", () => {
    expect(applyDamage(target, 12).health).toBe(8);
  });

  it("never drops health below zero, even when damage exceeds remaining health", () => {
    expect(applyDamage(target, 999).health).toBe(0);
  });
});
