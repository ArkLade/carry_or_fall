/**
 * Skill content definitions (M3.1, `docs/CONTENT_AUTHORING.md` §4). Pure data —
 * `@carry-or-fall/simulation-core`'s `skill-effects.ts` reads `effects`; no
 * engine logic lives here. Skills declare compatibility through tags rather
 * than custom per-skill code (concept §9.1-§9.3): `requiresTags` is matched
 * against a weapon's `tags` with "any overlap" semantics at attack time, not
 * at loadout-selection time (`docs/M3_ISSUES.md` §1).
 *
 * `effects` is a typed shape (`SkillEffects`), not a free-form bag: it only
 * recognizes the keys `skill-effects.ts`'s `aggregateSkillEffects` actually
 * sums, so a mistyped key is a compile error instead of a silently inert
 * field — the same correction M2 made for loot's `buildEffects`
 * (`docs/M2_EXECUTION_PLAN.md` §5.10).
 *
 * Provenance (`docs/M3_EXECUTION_PLAN.md` §4): `ricochet` matches concept
 * §29.2's worked example exactly. The other nine realize concept §9.4's four
 * example combinations; none of them appear by name in either authoritative
 * document, and their numeric values are proposed and balance-deferred
 * (concept §12.3), like M1's weapon numbers and M2's loot numbers.
 */
import type { ContentDefinition } from "./index";

/**
 * The ten recognized effect keys `skill-effects.ts` aggregates and caps. All
 * optional: a skill declares only the keys relevant to it. Values are
 * per-skill contributions summed (or, for `damageAfterBounceMultiplier`,
 * multiplied) across the player's active skills, then capped in shared code
 * (`docs/M3_ISSUES.md` M3.3) — never applied per item without a defined
 * aggregation rule.
 */
export interface SkillEffects {
  /** Flat bonus added to a ranged weapon's per-attack projectile count. */
  readonly projectileCountAdd?: number;
  /** Flat bonus added to a projectile's bounce count. */
  readonly bounceCountAdd?: number;
  /** Fractional damage multiplier applied each time a projectile bounces. */
  readonly damageAfterBounceMultiplier?: number;
  /** Flat bonus added to a projectile's pierce count. */
  readonly pierceCountAdd?: number;
  /** Whether an equipped skill grants a projectile one return after expiry. */
  readonly returnEnabled?: boolean;
  /**
   * How many children a projectile bursts into when a target consumes it (M7).
   *
   * The one primitive concept §11 reserves for boss skill cores, and the reason
   * technical plan §13.4's caps 5 and 6 existed with nothing reaching them until
   * now: a child may not split again, and a child may not return. Both are
   * enforced in `combat/ranged.ts` against `combat/caps.ts`, never here — a
   * content table cannot raise a cap (`docs/DEVELOPMENT_RULES.md`).
   */
  readonly splitCountAdd?: number;
  /** Fractional per-step homing steering strength added. */
  readonly homingStrengthAdd?: number;
  /** Fractional bonus to a melee weapon's range. */
  readonly rangeMultiplierAdd?: number;
  /** Flat bonus (degrees) added to a melee weapon's arc. */
  readonly arcDegreesAdd?: number;
  /** Fractional reduction applied to a melee weapon's recovery time. */
  readonly recoveryReductionAdd?: number;
  /** Flat bonus added to a melee weapon's stun chance. */
  readonly stunChanceAdd?: number;
  /** Flat shield granted to the player per landed hit, either weapon category. */
  readonly shieldOnHitAdd?: number;
}

export interface SkillDefinition extends ContentDefinition {
  readonly kind: "skill";
  readonly slotCost: 1 | 2;
  readonly requiresTags: readonly string[];
  readonly effects: SkillEffects;
  readonly limits: Readonly<Record<string, number>>;
}

/**
 * The rare boss skill (M7, concept §11 and §29.4's `split_return`).
 *
 * Two slots, because concept §11 says in as many words that "strong boss skills
 * may require two permanent skill slots when equipped before a future run", and
 * §34 lists that as an open question. It is answered here rather than left open
 * (`docs/DECISIONS.md` D65): this is the strongest projectile skill in the game
 * — it splits *and* returns — and D29 already built the two-slot path for
 * `returning_shot`, so the cost is expressible and already validated at the
 * loadout boundary.
 *
 * Available two ways, which is the whole point of a core: temporarily, as the
 * wildcard, by activating a core mid-run (concept §11 option 1); or permanently,
 * by extracting one and unlocking it (option 3).
 */
export const splitReturn: SkillDefinition = {
  id: "split_return",
  kind: "skill",
  slotCost: 2,
  requiresTags: ["projectile"],
  effects: { splitCountAdd: 2, returnEnabled: true },
  limits: { maximumChildrenPerSplit: 2, maximumTotalReturns: 1 },
} as const;

/** Ranged, matches concept §29.2's worked example exactly. */
export const ricochet: SkillDefinition = {
  id: "ricochet",
  kind: "skill",
  slotCost: 1,
  requiresTags: ["projectile"],
  effects: { bounceCountAdd: 1, damageAfterBounceMultiplier: 0.8 },
  limits: { maximumTotalBounces: 3 },
} as const;

/** Ranged: concept §9.4's "Additional Projectiles" / "Multishot". */
export const multishot: SkillDefinition = {
  id: "multishot",
  kind: "skill",
  slotCost: 1,
  requiresTags: ["projectile"],
  effects: { projectileCountAdd: 2 },
  limits: { maximumProjectilesPerAttack: 8 },
} as const;

/** Ranged: concept §9.4's "Pierce". */
export const piercingRounds: SkillDefinition = {
  id: "piercing_rounds",
  kind: "skill",
  slotCost: 1,
  requiresTags: ["projectile"],
  effects: { pierceCountAdd: 2 },
  limits: { maximumTotalPierces: 3 },
} as const;

/** Ranged, rare: concept §9.4's "Returning Projectiles" — the one 2-slot skill (`docs/M3_ISSUES.md` §1). */
export const returningShot: SkillDefinition = {
  id: "returning_shot",
  kind: "skill",
  slotCost: 2,
  requiresTags: ["projectile"],
  effects: { returnEnabled: true },
  limits: { maximumReturns: 1 },
} as const;

/** Ranged: concept §9.4's "Homing". */
export const homingArrows: SkillDefinition = {
  id: "homing_arrows",
  kind: "skill",
  slotCost: 1,
  requiresTags: ["projectile"],
  effects: { homingStrengthAdd: 0.35 },
  limits: { maximumSearchRadiusPx: 300 },
} as const;

/** Melee: concept §9.4's "Extended Reach". */
export const extendedReach: SkillDefinition = {
  id: "extended_reach",
  kind: "skill",
  slotCost: 1,
  requiresTags: ["melee"],
  effects: { rangeMultiplierAdd: 0.35 },
  limits: {},
} as const;

/** Melee: concept §9.4's "Faster Recovery". */
export const swiftStrikes: SkillDefinition = {
  id: "swift_strikes",
  kind: "skill",
  slotCost: 1,
  requiresTags: ["melee"],
  effects: { recoveryReductionAdd: 0.4 },
  limits: {},
} as const;

/** Melee: concept §9.4's "Stun Impact". */
export const stunningBlows: SkillDefinition = {
  id: "stunning_blows",
  kind: "skill",
  slotCost: 1,
  requiresTags: ["melee"],
  effects: { stunChanceAdd: 0.35 },
  limits: {},
} as const;

/** Melee: concept §9.4's "Wide Arc". */
export const wideArc: SkillDefinition = {
  id: "wide_arc",
  kind: "skill",
  slotCost: 1,
  requiresTags: ["melee"],
  effects: { arcDegreesAdd: 45 },
  limits: {},
} as const;

/**
 * Generic: concept §9.4's "Shield on Attack". Requires either weapon
 * category's tag (both `basicSword`/`basicBow` also carry `attack`, per M3.1)
 * so it applies regardless of which weapon lands the hit.
 */
export const bulwarkStrike: SkillDefinition = {
  id: "bulwark_strike",
  kind: "skill",
  slotCost: 1,
  requiresTags: ["attack"],
  effects: { shieldOnHitAdd: 4 },
  limits: {},
} as const;

/**
 * Every skill definition, in a fixed order used for the wildcard chip table
 * (`skill-chip.ts`) and for the loadout screen's key bindings.
 *
 * M3 shipped ten. M7 appends `splitReturn`, which is not one of them in the
 * sense that matters: it is the boss core's skill, reachable only by carrying a
 * core out of a run, and `boss.test.ts` asserts the ordinary set stays inside
 * technical plan §38 M3's "8 to 10" without counting it.
 */
export const ALL_SKILLS: readonly SkillDefinition[] = [
  multishot,
  ricochet,
  piercingRounds,
  returningShot,
  homingArrows,
  extendedReach,
  swiftStrikes,
  stunningBlows,
  wideArc,
  bulwarkStrike,
  splitReturn,
] as const;

/** Look up one skill by id, or `null` if the id is unknown. */
export function findSkill(skillId: string): SkillDefinition | null {
  return ALL_SKILLS.find((skill) => skill.id === skillId) ?? null;
}
