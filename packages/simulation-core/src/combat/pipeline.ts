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
 * `AttackTarget` is a minimal, reusable "damageable circle" shape — not an
 * `Enemy` entity. M1 has no enemy in the running game (that is a later
 * chunk), so hit resolution is exercised only through test fixtures here; the
 * live client always calls it with an empty target list.
 */
import type { WeaponDefinition } from "@carry-or-fall/game-content";

import type { Vec2 } from "../vec2";

/** The minimal actor shape the pipeline needs: where it is and which way it faces. */
export interface AttackActor {
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

/** The attack, fully parameterized from the actor and weapon (stage 3). */
export interface AttackDefinition {
  readonly weapon: WeaponDefinition;
  readonly origin: Vec2;
  readonly facing: number;
}

export type AttackDenialReason = "invalid_actor" | "cooldown";

export type AttackPreparation =
  | { readonly ready: true; readonly definition: AttackDefinition }
  | { readonly ready: false; readonly reason: AttackDenialReason };

/** Stage 1: validate actor. A real check, not a stub — grows at M1.10 to also reject a dead actor. */
export function isValidActor(actor: AttackActor): boolean {
  return (
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
  return { weapon, origin: actor.position, facing: actor.facing };
}

/** Stage 4: apply equipped skills. Pass-through in M1 — M3 adds real skill effects here. */
export function applyEquippedSkills(definition: AttackDefinition): AttackDefinition {
  return definition;
}

/** Stage 5: apply carried-loot modifiers. Pass-through in M1 — M2 adds real loot effects here. */
export function applyCarriedLootModifiers(definition: AttackDefinition): AttackDefinition {
  return definition;
}

/**
 * Runs stages 1-5 and reports whether the attack may proceed. Shared by
 * `combat/melee.ts` and `combat/ranged.ts` so both weapon categories are
 * gated identically, matching invariant 8 ("Real pipeline").
 */
export function prepareAttack(
  actor: AttackActor,
  weapon: WeaponDefinition,
  cooldownRemainingMs: number,
): AttackPreparation {
  if (!isValidActor(actor)) {
    return { ready: false, reason: "invalid_actor" };
  }
  if (!hasCooldownElapsed(cooldownRemainingMs)) {
    return { ready: false, reason: "cooldown" };
  }

  const definition = applyCarriedLootModifiers(
    applyEquippedSkills(buildAttackDefinition(actor, weapon)),
  );
  return { ready: true, definition };
}

/** Apply damage stage, shared by melee and ranged hit resolution. Health never drops below zero. */
export function applyDamage(target: AttackTarget, damage: number): AttackTarget {
  return { ...target, health: Math.max(0, target.health - damage) };
}
