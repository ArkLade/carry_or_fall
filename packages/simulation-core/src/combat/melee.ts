/**
 * Melee attack resolution (M1.7, `docs/M1_EXECUTION_PLAN.md` §9). Drives an
 * arc/wind-up/active/recovery attack from a `WeaponDefinition` through the
 * shared pipeline (`pipeline.ts`). The attack interval (cooldown) gates a new
 * swing; hits are resolved only once per swing, only during its active
 * window, against overlapping targets within range and arc.
 */
import type { WeaponDefinition } from "@carry-or-fall/game-content";

import { angleDifference, degToRad } from "../angles";
import { type BuildEffects, NO_BUILD_EFFECTS } from "../build-effects";
import type { MeleeAttackState, Vec2 } from "../world";
import type { AttackActor, AttackDenialReason, AttackTarget } from "./pipeline";
import { applyDamage, prepareAttack } from "./pipeline";
import type { HitEvent } from "./events";

export type MeleePhase = "windup" | "active" | "recovery";

export type MeleeStartResult =
  | { readonly started: true; readonly state: MeleeAttackState }
  | { readonly started: false; readonly reason: AttackDenialReason };

/**
 * Attempt to start a new swing. Refused if the actor is invalid or the
 * weapon's cooldown has not elapsed. `carriedEffects` (M2, `docs/
 * M2_ISSUES.md` M2.4) defaults to {@link NO_BUILD_EFFECTS} for no carried
 * loot; the resulting `state.weapon` is the effective, post-loot weapon, so
 * its `attackIntervalMs` is what the caller should use to set the next
 * cooldown.
 */
export function startMeleeAttack(
  actor: AttackActor,
  weapon: WeaponDefinition,
  cooldownRemainingMs: number,
  carriedEffects: BuildEffects = NO_BUILD_EFFECTS,
): MeleeStartResult {
  const preparation = prepareAttack(actor, weapon, cooldownRemainingMs, carriedEffects);
  if (!preparation.ready) {
    return { started: false, reason: preparation.reason };
  }

  return {
    started: true,
    state: {
      weapon: preparation.definition.weapon,
      origin: preparation.definition.origin,
      facing: preparation.definition.facing,
      elapsedMs: 0,
      hasResolvedHits: false,
    },
  };
}

/** Advance the in-flight swing by one simulation step. */
export function advanceMeleeAttack(state: MeleeAttackState, dtMs: number): MeleeAttackState {
  return { ...state, elapsedMs: state.elapsedMs + dtMs };
}

/** Which phase of windup/active/recovery the swing is currently in. */
export function meleePhase(state: MeleeAttackState): MeleePhase {
  const windupMs = state.weapon.windupMs ?? 0;
  const activeMs = state.weapon.activeMs ?? 0;
  if (state.elapsedMs < windupMs) {
    return "windup";
  }
  if (state.elapsedMs < windupMs + activeMs) {
    return "active";
  }
  return "recovery";
}

/** Whether the swing (including recovery) has fully finished and its state can be discarded. */
export function isMeleeAttackFinished(state: MeleeAttackState): boolean {
  const windupMs = state.weapon.windupMs ?? 0;
  const activeMs = state.weapon.activeMs ?? 0;
  const recoveryMs = state.weapon.recoveryMs ?? 0;
  return state.elapsedMs >= windupMs + activeMs + recoveryMs;
}

/** Whether `target` is within the swing's range and arc, centered on `facing`. */
export function isWithinMeleeArc(
  origin: Vec2,
  facing: number,
  rangePx: number,
  arcDegrees: number,
  target: AttackTarget,
): boolean {
  const dx = target.position.x - origin.x;
  const dy = target.position.y - origin.y;
  const distance = Math.hypot(dx, dy);
  if (distance > rangePx + target.radius) {
    return false;
  }
  const angleToTarget = Math.atan2(dy, dx);
  const halfArc = degToRad(arcDegrees) / 2;
  return Math.abs(angleDifference(angleToTarget, facing)) <= halfArc;
}

/**
 * Resolve hits for one swing against `targets`: overlapping targets take the
 * weapon's damage and are knocked back (an instant positional displacement
 * away from the swing's origin — M1 has no ongoing-force/velocity system for
 * a target to receive, since neither the enemy nor player physics state
 * exists yet). Called once, when the swing enters its active window.
 */
export function resolveMeleeHits(
  state: MeleeAttackState,
  targets: readonly AttackTarget[],
): { readonly updatedTargets: readonly AttackTarget[]; readonly hitEvents: readonly HitEvent[] } {
  const rangePx = state.weapon.rangePx ?? 0;
  const arcDegrees = state.weapon.arcDegrees ?? 0;
  const knockbackPx = state.weapon.knockback ?? 0;

  const updatedTargets: AttackTarget[] = [];
  const hitEvents: HitEvent[] = [];

  for (const target of targets) {
    if (!isWithinMeleeArc(state.origin, state.facing, rangePx, arcDegrees, target)) {
      updatedTargets.push(target);
      continue;
    }

    const damaged = applyDamage(target, state.weapon.damage);
    const knockedBack = applyKnockback(damaged, state.origin, knockbackPx);
    updatedTargets.push(knockedBack);
    hitEvents.push({ targetId: target.id, damage: state.weapon.damage, position: target.position });
  }

  return { updatedTargets, hitEvents };
}

function applyKnockback(target: AttackTarget, origin: Vec2, knockbackPx: number): AttackTarget {
  if (knockbackPx <= 0) {
    return target;
  }
  const dx = target.position.x - origin.x;
  const dy = target.position.y - origin.y;
  const distance = Math.hypot(dx, dy);
  if (distance === 0) {
    return target;
  }
  return {
    ...target,
    position: {
      x: target.position.x + (dx / distance) * knockbackPx,
      y: target.position.y + (dy / distance) * knockbackPx,
    },
  };
}
