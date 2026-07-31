import { describe, expect, it } from "vitest";

import { basicSword } from "@carry-or-fall/game-content";

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
    // Stage 5 (carried-loot modifiers, M2) always returns an effective copy,
    // even under NO_BUILD_EFFECTS, so this is equal-by-value, not the same
    // reference as `basicSword`.
    expect(result.definition.weapon).toEqual(basicSword);
    expect(result.definition.origin).toEqual(ACTOR.position);
    expect(result.definition.facing).toBe(ACTOR.facing);
  });

  it("also allows an attack exactly at zero remaining cooldown (boundary, not just below it)", () => {
    expect(prepareAttack(ACTOR, basicSword, 0).ready).toBe(true);
  });
});

describe("pass-through stages (M1 has no skills or carried loot yet)", () => {
  it("applyEquippedSkills does not alter the attack definition", () => {
    const result = prepareAttack(ACTOR, basicSword, 0);
    if (!result.ready) throw new Error("expected ready");
    expect(applyEquippedSkills(result.definition)).toEqual(result.definition);
  });

  it("applyCarriedLootModifiers does not alter the attack definition", () => {
    const result = prepareAttack(ACTOR, basicSword, 0);
    if (!result.ready) throw new Error("expected ready");
    expect(applyCarriedLootModifiers(result.definition)).toEqual(result.definition);
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
