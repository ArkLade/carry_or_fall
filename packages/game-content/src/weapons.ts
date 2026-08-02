/**
 * Weapon content definitions (M1.2, `docs/CONTENT_AUTHORING.md` §3). Pure data —
 * the shared attack pipeline in `@carry-or-fall/simulation-core` reads these; no
 * engine logic lives here. `limits` are a ceiling this weapon may never exceed;
 * the engine's own hard caps (`combat/caps.ts`) can clamp it further but this
 * weapon can never raise a shared cap (`docs/DEVELOPMENT_RULES.md`, "Preserve
 * projectile and effect safety caps").
 *
 * Provenance (`docs/M1_EXECUTION_PLAN.md` §4):
 * - `basicBow` traces to concept §29.1 (id, ranged, tag `Projectile`, damage,
 *   attack interval, projectile speed/count/spread, hard limits).
 * - `basicSword` does not appear in concept §29.1 (only described qualitatively,
 *   concept §8.1); its numbers are proposed and balance-deferred (concept §12.3).
 */
import type { ContentDefinition } from "./index";

export interface WeaponLimits {
  readonly maxProjectilesPerAttack: number;
  readonly maxBounces: number;
  readonly maxPierces: number;
}

export interface WeaponDefinition extends ContentDefinition {
  readonly kind: "weapon";
  readonly category: "melee" | "ranged";
  readonly tags: readonly string[];
  readonly damage: number;
  readonly attackIntervalMs: number;
  // Ranged-only:
  readonly projectileSpeed?: number;
  readonly projectileCount?: number;
  readonly spreadDegrees?: number;
  // Melee-only:
  readonly rangePx?: number;
  readonly arcDegrees?: number;
  readonly windupMs?: number;
  readonly activeMs?: number;
  readonly recoveryMs?: number;
  readonly knockback?: number;
  readonly stunChance?: number;
  // Hard caps for skill/loot-driven combinations (never exceeded at runtime):
  readonly limits: WeaponLimits;
}

/** Proposed, balance-deferred (concept §8.1 is qualitative only; no numeric source). */
export const basicSword: WeaponDefinition = {
  id: "basic_sword",
  kind: "weapon",
  category: "melee",
  // "attack" (concept §9.3's suggested generic tag) lets an M3 skill declare
  // compatibility with either weapon category (e.g. `bulwark_strike`)
  // without inventing a workaround (`docs/M3_ISSUES.md` M3.1).
  tags: ["melee", "attack"],
  damage: 12,
  attackIntervalMs: 500,
  rangePx: 56,
  arcDegrees: 90,
  windupMs: 80,
  activeMs: 120,
  recoveryMs: 180,
  knockback: 120,
  stunChance: 0,
  limits: { maxProjectilesPerAttack: 0, maxBounces: 0, maxPierces: 0 },
} as const;

/** Traces to concept §29.1. */
export const basicBow: WeaponDefinition = {
  id: "basic_bow",
  kind: "weapon",
  category: "ranged",
  tags: ["projectile", "attack"],
  damage: 10,
  attackIntervalMs: 650,
  projectileSpeed: 600,
  projectileCount: 1,
  spreadDegrees: 0,
  limits: { maxProjectilesPerAttack: 8, maxBounces: 3, maxPierces: 3 },
} as const;

/**
 * Every weapon definition the game ships, mirroring `ALL_SKILLS`/`ALL_LOOT`.
 * Added in M5 so `unlocks.ts` can assert that a weapon unlock names a weapon
 * that exists, rather than repeating the list a third time.
 */
export const ALL_WEAPONS: readonly WeaponDefinition[] = [basicSword, basicBow] as const;
