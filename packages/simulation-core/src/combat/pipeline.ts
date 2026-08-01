/**
 * The shared attack pipeline (technical plan §13.1, `docs/M1_EXECUTION_PLAN.md`
 * §2.4). Every attack — melee or ranged — flows through the same stages:
 *
 * ```
 * validate actor -> check cooldown -> build attack definition
 *   -> apply equipped skills (pass-through in M1) -> apply carried-loot
 *   modifiers (pass-through in M1) -> enforce hard caps -> create melee shape
 *   or projectiles -> resolve hits -> apply damage/status -> emit visual event
 * ```
 *
 * This module implements the category-agnostic stages (1-5) plus the shared
 * `applyDamage` helper used by both categories' hit resolution. The
 * category-specific stages — enforce caps, create the shape, resolve hits,
 * emit the event — are `combat/melee.ts` (arc/windup/active/recovery, whose
 * hit resolution runs during the active window across later steps, not
 * synchronously here) and `combat/ranged.ts` (spawn, then travel/hit/expire
 * across later steps). The skill (M3) and carried-loot (M2) stages are
 * explicit pass-throughs, matching `docs/M1_EXECUTION_PLAN.md` §2.4: keeping
 * them as real stages now avoids reworking the pipeline later.
 *
 * `AttackTarget` is a minimal, reusable "damageable circle" shape. `Enemy`
 * (`world.ts`) satisfies it structurally (same id/position/radius/health
 * fields, plus its own stats), so `simulation.ts` passes `world.enemies`
 * directly wherever an `AttackTarget[]` is expected — no separate enemy
 * combat path was written.
 *
 * M3 (`docs/M3_ISSUES.md` M3.3) fills in stage 4, `applyEquippedSkills`: the
 * weapon-shape effects (range, arc, recovery, projectile count, stun chance)
 * are applied to an effective `WeaponDefinition` copy here, exactly like
 * stage 5 already does for carried loot; the non-weapon-shape effects
 * (bounce/pierce/return/homing are per-projectile runtime state; shield-on-
 * hit is a player-level effect) are carried forward on
 * `AttackDefinition.skillEffects` for `combat/ranged.ts` and `simulation.ts`
 * to read.
 */
import type { WeaponDefinition } from "@carry-or-fall/game-content";

import { applyBuildEffectsToWeapon, type BuildEffects, NO_BUILD_EFFECTS } from "../build-effects";
import { NO_SKILL_EFFECTS, type SkillEffects } from "../skill-effects";
import type { Vec2 } from "../vec2";

/**
 * The minimal actor shape the pipeline needs: who it is, where it is, and which
 * way it faces. `id` (M4) travels onto the swing state and onto every spawned
 * projectile, so an attack can be attributed to its owner in a world holding
 * more than one attacker.
 */
export interface AttackActor {
  readonly id: string;
  readonly position: Vec2;
  readonly facing: number;
  readonly radius: number;
}

/**
 * A minimal, reusable "damageable circle" — anything hit resolution can apply
 * damage to. Not the `Enemy` content/runtime type; see the module doc above.
 */
export interface AttackTarget {
  readonly id: string;
  readonly position: Vec2;
  readonly radius: number;
  readonly health: number;
}

/**
 * The attack, fully parameterized from the actor and weapon (stage 3).
 * `skillEffects` starts as {@link NO_SKILL_EFFECTS} at stage 3 and is set to
 * the real aggregated value by stage 4 (`applyEquippedSkills`); later stages
 * and callers (`combat/ranged.ts`, `simulation.ts`) read it for the effects
 * that are not weapon-shape mutations.
 */
export interface AttackDefinition {
  readonly weapon: WeaponDefinition;
  readonly origin: Vec2;
  readonly facing: number;
  readonly skillEffects: SkillEffects;
}

export type AttackDenialReason = "invalid_actor" | "cooldown";

export type AttackPreparation =
  | { readonly ready: true; readonly definition: AttackDefinition }
  | { readonly ready: false; readonly reason: AttackDenialReason };

/**
 * Stage 1: validate actor. A real check, not a stub. Whether the actor is
 * *alive* is checked by the caller before this pipeline ever runs (M1.10 —
 * `simulation.ts` skips all attack processing for a dead player), since
 * `AttackActor` is a minimal shape with no health/alive concept of its own.
 */
export function isValidActor(actor: AttackActor): boolean {
  return (
    actor.id.length > 0 &&
    Number.isFinite(actor.position.x) &&
    Number.isFinite(actor.position.y) &&
    Number.isFinite(actor.facing) &&
    actor.radius > 0
  );
}

/** Stage 2: check cooldown. Real and meaningful: an attack during recovery is refused. */
export function hasCooldownElapsed(cooldownRemainingMs: number): boolean {
  return cooldownRemainingMs <= 0;
}

/** Stage 3: build attack definition from the actor's current position/facing and the weapon. */
export function buildAttackDefinition(
  actor: AttackActor,
  weapon: WeaponDefinition,
): AttackDefinition {
  return { weapon, origin: actor.position, facing: actor.facing, skillEffects: NO_SKILL_EFFECTS };
}

/**
 * Stage 4: apply equipped skills (M3, `docs/M3_ISSUES.md` M3.3). Applies the
 * weapon-shape effects to an effective `WeaponDefinition` copy — only the
 * fields the weapon's category actually declares are touched, so a ranged
 * weapon never gains melee-only fields or vice versa — and carries the full
 * `skillEffects` value forward for later stages/callers to read. Defaults to
 * {@link NO_SKILL_EFFECTS} so a caller with no equipped skills is a no-op.
 */
export function applyEquippedSkills(
  definition: AttackDefinition,
  skillEffects: SkillEffects = NO_SKILL_EFFECTS,
): AttackDefinition {
  const { weapon } = definition;
  const effectiveWeapon: WeaponDefinition = {
    ...weapon,
    ...(weapon.rangePx === undefined
      ? {}
      : { rangePx: weapon.rangePx * (1 + skillEffects.rangeMultiplierAdd) }),
    ...(weapon.arcDegrees === undefined
      ? {}
      : { arcDegrees: weapon.arcDegrees + skillEffects.arcDegreesAdd }),
    ...(weapon.recoveryMs === undefined
      ? {}
      : { recoveryMs: weapon.recoveryMs * (1 - skillEffects.recoveryReductionAdd) }),
    ...(weapon.stunChance === undefined
      ? {}
      : { stunChance: Math.min(1, Math.max(0, weapon.stunChance + skillEffects.stunChanceAdd)) }),
    ...(weapon.projectileCount === undefined
      ? {}
      : { projectileCount: weapon.projectileCount + skillEffects.projectileCountAdd }),
  };
  return { ...definition, weapon: effectiveWeapon, skillEffects };
}

/**
 * Stage 5: apply carried-loot modifiers (M2, `docs/M2_ISSUES.md` M2.4). The
 * player's current `BuildEffects` (aggregated from their inventory —
 * `build-effects.ts` — never the secure slot) are applied to the weapon this
 * attack actually uses. Defaults to {@link NO_BUILD_EFFECTS} so an M1-era
 * call site with no carried loot behaves exactly as the M1 pass-through did.
 */
export function applyCarriedLootModifiers(
  definition: AttackDefinition,
  carriedEffects: BuildEffects = NO_BUILD_EFFECTS,
): AttackDefinition {
  return { ...definition, weapon: applyBuildEffectsToWeapon(definition.weapon, carriedEffects) };
}

/**
 * Runs stages 1-5 and reports whether the attack may proceed. Shared by
 * `combat/melee.ts` and `combat/ranged.ts` so both weapon categories are
 * gated identically, matching invariant 8 ("Real pipeline"). `carriedEffects`
 * defaults to {@link NO_BUILD_EFFECTS} for callers with no carried loot;
 * `skillEffects` defaults to {@link NO_SKILL_EFFECTS} for callers with no
 * equipped skills (M3). Skills (stage 4) apply before carried loot (stage 5),
 * matching technical plan §13.1's pipeline order.
 */
export function prepareAttack(
  actor: AttackActor,
  weapon: WeaponDefinition,
  cooldownRemainingMs: number,
  carriedEffects: BuildEffects = NO_BUILD_EFFECTS,
  skillEffects: SkillEffects = NO_SKILL_EFFECTS,
): AttackPreparation {
  if (!isValidActor(actor)) {
    return { ready: false, reason: "invalid_actor" };
  }
  if (!hasCooldownElapsed(cooldownRemainingMs)) {
    return { ready: false, reason: "cooldown" };
  }

  const definition = applyCarriedLootModifiers(
    applyEquippedSkills(buildAttackDefinition(actor, weapon), skillEffects),
    carriedEffects,
  );
  return { ready: true, definition };
}

/**
 * Apply damage stage: clamp a health value after taking `damage`, never below
 * zero. Shared by {@link applyDamage} (melee/ranged hit resolution) and the
 * enemy's contact damage against the player (`enemy.ts`, M1.9/M1.10), which
 * has no `AttackTarget` to apply {@link applyDamage} to directly.
 */
export function applyDamageAmount(health: number, damage: number): number {
  return Math.max(0, health - damage);
}

/** Apply damage stage, shared by melee and ranged hit resolution. Health never drops below zero. */
export function applyDamage(target: AttackTarget, damage: number): AttackTarget {
  return { ...target, health: applyDamageAmount(target.health, damage) };
}
