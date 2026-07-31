/**
 * Skill effect aggregation and caps (M3.3, `docs/M3_ISSUES.md` M3.3). Fills
 * in `combat/pipeline.ts`'s stage 4, `applyEquippedSkills`, which was a
 * documented pass-through since M1 specifically so this milestone could
 * complete it without reworking the pipeline (`docs/M1_EXECUTION_PLAN.md`
 * §2.4).
 *
 * `aggregateSkillEffects` sums each recognized `SkillEffects` key across the
 * player's **active** skills (permanent loadout plus wildcard — the caller
 * decides which skills are "active"), filtered to only those whose
 * `requiresTags` overlaps the weapon in use (concept §9.3, tag-gating happens
 * per attack, not at loadout-selection time — `docs/M3_ISSUES.md` §1).
 *
 * Three recognized keys (`projectileCountAdd`, `bounceCountAdd`,
 * `pierceCountAdd`) map onto an existing §13.4 cap in `combat/caps.ts`
 * (`clampProjectilesPerAttack`/`clampBounceCount`/`clampPierceCount`) and are
 * summed here without a duplicate local ceiling — that module remains the
 * sole downstream enforcement, so the constant is never defined twice.
 * `returnEnabled` is boolean; the *count* of returns is capped by
 * `combat/caps.ts`'s `MAX_RETURNS_PER_PROJECTILE` regardless of how many
 * equipped skills declare it. Every other key is clamped here (concept
 * §30.2/§31 anti-snowball, extended from loot's `build-effects.ts` to
 * skills).
 */
import type { SkillDefinition } from "@carry-or-fall/game-content";

export interface SkillEffects {
  readonly projectileCountAdd: number;
  readonly bounceCountAdd: number;
  /** Aggregates as a floored **product**, not a sum — see {@link MIN_DAMAGE_AFTER_BOUNCE_MULTIPLIER}. */
  readonly damageAfterBounceMultiplier: number;
  readonly pierceCountAdd: number;
  readonly returnEnabled: boolean;
  readonly homingStrengthAdd: number;
  readonly rangeMultiplierAdd: number;
  readonly arcDegreesAdd: number;
  readonly recoveryReductionAdd: number;
  readonly stunChanceAdd: number;
  readonly shieldOnHitAdd: number;
}

/** The pipeline's pass-through value: no equipped skills, no change to any stat. */
export const NO_SKILL_EFFECTS: SkillEffects = {
  projectileCountAdd: 0,
  bounceCountAdd: 0,
  damageAfterBounceMultiplier: 1,
  pierceCountAdd: 0,
  returnEnabled: false,
  homingStrengthAdd: 0,
  rangeMultiplierAdd: 0,
  arcDegreesAdd: 0,
  recoveryReductionAdd: 0,
  stunChanceAdd: 0,
  shieldOnHitAdd: 0,
} as const;

/** Ceiling on the summed per-step homing steering strength (fraction of velocity direction per step). */
export const MAX_HOMING_STRENGTH = 0.6;
/** Floor on the aggregated (product) post-bounce damage multiplier: damage can never reach zero. */
export const MIN_DAMAGE_AFTER_BOUNCE_MULTIPLIER = 0.3;
/** Ceiling on the summed fractional melee range bonus (range can at most double). */
export const MAX_RANGE_MULTIPLIER_ADD = 1;
/** Ceiling on the summed flat melee arc bonus, in degrees. */
export const MAX_ARC_DEGREES_ADD = 180;
/** Ceiling on the summed fractional melee recovery reduction: recovery never drops below 30% of base. */
export const MAX_RECOVERY_REDUCTION_ADD = 0.7;
/** Ceiling on the summed stun-chance bonus. The effective weapon.stunChance is separately clamped to [0, 1]. */
export const MAX_STUN_CHANCE_ADD = 0.75;
/** Ceiling on the summed per-hit shield grant. */
export const MAX_SHIELD_ON_HIT_ADD = 12;
/** Ceiling on the player's total shield pool. */
export const MAX_SHIELD_HP = 40;
/** Fixed stun duration applied on a successful stun roll (M3.5). */
export const STUN_DURATION_MS = 800;

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/**
 * Sum every recognized `effects` key across `equippedSkills` whose
 * `requiresTags` overlaps `weaponTags`, then clamp each total to its cap
 * (skipping the three keys `combat/caps.ts` already owns — see the module
 * doc). `damageAfterBounceMultiplier` aggregates as a product.
 */
export function aggregateSkillEffects(
  equippedSkills: readonly SkillDefinition[],
  weaponTags: readonly string[],
): SkillEffects {
  let projectileCountAdd = 0;
  let bounceCountAdd = 0;
  let damageAfterBounceMultiplier = 1;
  let pierceCountAdd = 0;
  let returnEnabled = false;
  let homingStrengthAdd = 0;
  let rangeMultiplierAdd = 0;
  let arcDegreesAdd = 0;
  let recoveryReductionAdd = 0;
  let stunChanceAdd = 0;
  let shieldOnHitAdd = 0;

  for (const skill of equippedSkills) {
    const isCompatible = skill.requiresTags.some((tag) => weaponTags.includes(tag));
    if (!isCompatible) {
      continue;
    }
    const effects = skill.effects;
    projectileCountAdd += effects.projectileCountAdd ?? 0;
    bounceCountAdd += effects.bounceCountAdd ?? 0;
    if (effects.damageAfterBounceMultiplier !== undefined) {
      damageAfterBounceMultiplier *= effects.damageAfterBounceMultiplier;
    }
    pierceCountAdd += effects.pierceCountAdd ?? 0;
    returnEnabled = returnEnabled || (effects.returnEnabled ?? false);
    homingStrengthAdd += effects.homingStrengthAdd ?? 0;
    rangeMultiplierAdd += effects.rangeMultiplierAdd ?? 0;
    arcDegreesAdd += effects.arcDegreesAdd ?? 0;
    recoveryReductionAdd += effects.recoveryReductionAdd ?? 0;
    stunChanceAdd += effects.stunChanceAdd ?? 0;
    shieldOnHitAdd += effects.shieldOnHitAdd ?? 0;
  }

  return {
    projectileCountAdd,
    bounceCountAdd,
    damageAfterBounceMultiplier: clamp(
      damageAfterBounceMultiplier,
      MIN_DAMAGE_AFTER_BOUNCE_MULTIPLIER,
      1,
    ),
    pierceCountAdd,
    returnEnabled,
    homingStrengthAdd: clamp(homingStrengthAdd, 0, MAX_HOMING_STRENGTH),
    rangeMultiplierAdd: clamp(rangeMultiplierAdd, 0, MAX_RANGE_MULTIPLIER_ADD),
    arcDegreesAdd: clamp(arcDegreesAdd, 0, MAX_ARC_DEGREES_ADD),
    recoveryReductionAdd: clamp(recoveryReductionAdd, 0, MAX_RECOVERY_REDUCTION_ADD),
    stunChanceAdd: clamp(stunChanceAdd, 0, MAX_STUN_CHANCE_ADD),
    shieldOnHitAdd: clamp(shieldOnHitAdd, 0, MAX_SHIELD_ON_HIT_ADD),
  };
}

/** Add `amount` to a shield pool, capped at {@link MAX_SHIELD_HP}. Never negative. */
export function grantShield(currentShieldHp: number, amount: number): number {
  return clamp(currentShieldHp + amount, 0, MAX_SHIELD_HP);
}

/** The minimal shape {@link applyDamageToPlayer} needs: a shield pool and health. */
export interface ShieldedHealth {
  readonly shieldHp: number;
  readonly health: number;
}

/**
 * Apply `damage` to a shielded actor: the shield absorbs damage first, and
 * only the remainder (if any) reduces health. Neither value drops below
 * zero. Mirrors `combat/pipeline.ts`'s `applyDamageAmount`, but shield-aware.
 */
export function applyDamageToPlayer(current: ShieldedHealth, damage: number): ShieldedHealth {
  const clampedDamage = Math.max(0, damage);
  const shieldHp = Math.max(0, current.shieldHp - clampedDamage);
  const remainingDamage = Math.max(0, clampedDamage - current.shieldHp);
  const health = Math.max(0, current.health - remainingDamage);
  return { shieldHp, health };
}
