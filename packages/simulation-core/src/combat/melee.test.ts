import { describe, expect, it } from "vitest";

import { basicSword } from "@carry-or-fall/game-content";

import {
  advanceMeleeAttack,
  isMeleeAttackFinished,
  isWithinMeleeArc,
  meleePhase,
  resolveMeleeHits,
  startMeleeAttack,
} from "./melee";
import type { AttackActor, AttackTarget } from "./pipeline";

const ACTOR: AttackActor = { position: { x: 100, y: 100 }, facing: 0, radius: 16 };

describe("startMeleeAttack", () => {
  it("refuses to start while the sword's cooldown has not elapsed", () => {
    const result = startMeleeAttack(ACTOR, basicSword, 100);
    expect(result).toEqual({ started: false, reason: "cooldown" });
  });

  it("starts a swing at the actor's current position and facing once cooldown has elapsed", () => {
    const result = startMeleeAttack(ACTOR, basicSword, 0);
    expect(result.started).toBe(true);
    if (!result.started) throw new Error("expected started");
    expect(result.state).toEqual({
      weapon: basicSword,
      origin: ACTOR.position,
      facing: ACTOR.facing,
      elapsedMs: 0,
      hasResolvedHits: false,
    });
  });
});

describe("windup / active / recovery phase timing (M1.7)", () => {
  it("stays in windup until windupMs has elapsed", () => {
    const result = startMeleeAttack(ACTOR, basicSword, 0);
    if (!result.started) throw new Error("expected started");
    let state = result.state;
    expect(meleePhase(state)).toBe("windup");
    state = advanceMeleeAttack(state, basicSword.windupMs! - 10);
    expect(meleePhase(state)).toBe("windup");
  });

  it("enters active once windup elapses, and stays active for activeMs", () => {
    const result = startMeleeAttack(ACTOR, basicSword, 0);
    if (!result.started) throw new Error("expected started");
    const state = advanceMeleeAttack(result.state, basicSword.windupMs!);
    expect(meleePhase(state)).toBe("active");
  });

  it("enters recovery once windup + active elapses", () => {
    const result = startMeleeAttack(ACTOR, basicSword, 0);
    if (!result.started) throw new Error("expected started");
    const state = advanceMeleeAttack(result.state, basicSword.windupMs! + basicSword.activeMs!);
    expect(meleePhase(state)).toBe("recovery");
  });

  it("is finished only once windup + active + recovery has fully elapsed", () => {
    const result = startMeleeAttack(ACTOR, basicSword, 0);
    if (!result.started) throw new Error("expected started");
    const totalMs = basicSword.windupMs! + basicSword.activeMs! + basicSword.recoveryMs!;
    const notYet = advanceMeleeAttack(result.state, totalMs - 1);
    expect(isMeleeAttackFinished(notYet)).toBe(false);
    const finished = advanceMeleeAttack(result.state, totalMs);
    expect(isMeleeAttackFinished(finished)).toBe(true);
  });
});

describe("isWithinMeleeArc", () => {
  const origin = { x: 0, y: 0 };

  it("is true for a target directly ahead, within range", () => {
    const target: AttackTarget = { id: "a", position: { x: 40, y: 0 }, radius: 5, health: 10 };
    expect(isWithinMeleeArc(origin, 0, 56, 90, target)).toBe(true);
  });

  it("is false for a target beyond range", () => {
    const target: AttackTarget = { id: "a", position: { x: 1000, y: 0 }, radius: 5, health: 10 };
    expect(isWithinMeleeArc(origin, 0, 56, 90, target)).toBe(false);
  });

  it("is false for a target within range but outside the arc (directly behind)", () => {
    const target: AttackTarget = { id: "a", position: { x: -40, y: 0 }, radius: 5, health: 10 };
    expect(isWithinMeleeArc(origin, 0, 56, 90, target)).toBe(false);
  });
});

describe("resolveMeleeHits (stages 8-9: resolve hits, apply damage/status)", () => {
  it("damages and knocks back a target within the swing's arc and range", () => {
    const result = startMeleeAttack(ACTOR, basicSword, 0);
    if (!result.started) throw new Error("expected started");
    const target: AttackTarget = {
      id: "enemy-1",
      position: { x: 140, y: 100 },
      radius: 8,
      health: 20,
    };

    const { updatedTargets, hitEvents } = resolveMeleeHits(result.state, [target]);

    expect(updatedTargets).toHaveLength(1);
    expect(updatedTargets[0]!.health).toBe(20 - basicSword.damage);
    // Knocked directly away from the origin (which is to the left of the target).
    expect(updatedTargets[0]!.position.x).toBeGreaterThan(target.position.x);
    expect(hitEvents).toEqual([
      { targetId: "enemy-1", damage: basicSword.damage, position: target.position },
    ]);
  });

  it("does not damage a target outside the swing's arc", () => {
    const result = startMeleeAttack(ACTOR, basicSword, 0);
    if (!result.started) throw new Error("expected started");
    const target: AttackTarget = {
      id: "enemy-1",
      position: { x: 60, y: 100 },
      radius: 8,
      health: 20,
    };

    const { updatedTargets, hitEvents } = resolveMeleeHits(result.state, [target]);

    expect(updatedTargets).toEqual([target]);
    expect(hitEvents).toEqual([]);
  });
});
