# Content Authoring

Status: **M1 in progress.** §3 (weapons) and §6 (enemies) are shipped — `basic_sword`, `basic_bow`,
and `chaser` are real data in `@carry-or-fall/game-content`, read by the shared attack pipeline in
`@carry-or-fall/simulation-core`. §4 (skills) and §5 (loot) remain forward-looking (M3/M2). This
document explains how to add a weapon, armor type, skill, loot item, or enemy as a **data
definition** — not as new engine code. This follows the technical plan §7.2 and §43 and the
`docs/DEVELOPMENT_RULES.md` rule that content is data-driven.

> The core rule: **adding an ordinary weapon, skill, or loot item should require a content
> definition plus tests, not a rewrite of the combat engine** (`DEVELOPMENT_RULES.md`, "Content and
> code quality"). Do not hard-code content-specific behavior unless a mechanic genuinely cannot use
> shared primitives.

## 1. Where content lives

- `packages/game-content` (`@carry-or-fall/game-content`) — pure data and types. No
  `@colyseus/schema`, no runtime, no engine logic.
- Shared combat/simulation primitives and their **hard caps** live in `packages/simulation-core`,
  not in content data (technical plan §13.4; concept §9.5). Content selects and parameterizes those
  primitives; it must not be able to raise a safety cap past its shared-code limit.

Only display-safe definitions are shared between client and server (technical plan §7.1). Hidden
server data — loot spawn tables, drop rates, anti-cheat thresholds — is **not** content and does
not belong in this package.

## 2. The base shape

Every content package shares this base:

```ts
// @carry-or-fall/game-content
export type ContentKind = "weapon" | "armor" | "skill" | "loot" | "enemy" | "boss";

export interface ContentDefinition {
  readonly id: string;
  readonly kind: ContentKind;
}
```

Every concrete definition below **extends `ContentDefinition`** with `id` (unique, snake_case) and
`kind`, plus per-kind fields owned by the milestone that implements the mechanic. §3 (weapons) and
§6 (enemies) are shipped, per M1; §4 (skills) and §5 (loot) are still the design target for a later
milestone, not yet shipped.

## 3. Weapons — Basic Sword and Basic Bow (M1, shipped)

M1 ships exactly two weapons. Both are data; the shared attack pipeline (`packages/simulation-core/
src/combat/pipeline.ts`, technical plan §13.1) reads them. Values below follow the concept document
(§8.1, §29.1); exact balance is deferred to playtesting (concept §12.3).

```ts
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

export const basicSword: WeaponDefinition = {
  id: "basic_sword",
  kind: "weapon",
  category: "melee",
  tags: ["melee"],
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

export const basicBow: WeaponDefinition = {
  id: "basic_bow",
  kind: "weapon",
  category: "ranged",
  tags: ["projectile"],
  damage: 10,
  attackIntervalMs: 650,
  projectileSpeed: 600,
  projectileCount: 1,
  spreadDegrees: 0,
  limits: { maxProjectilesPerAttack: 8, maxBounces: 3, maxPierces: 3 },
} as const;
```

Note that a melee weapon still declares projectile limits (all `0`): the caps exist for every
weapon so a later projectile-granting skill cannot uncap it.

## 4. Skills — data-driven, tag-gated (M3)

Skills modify shared combat primitives and declare compatibility through tags rather than custom
code (concept §9.1–§9.3, §29.2):

```ts
export interface SkillDefinition extends ContentDefinition {
  readonly kind: "skill";
  readonly slotCost: 1 | 2;
  readonly requiresTags: readonly string[];
  readonly effects: Readonly<Record<string, number | boolean>>;
  readonly limits: Readonly<Record<string, number>>;
}

export const ricochet: SkillDefinition = {
  id: "ricochet",
  kind: "skill",
  slotCost: 1,
  requiresTags: ["projectile"],
  effects: { bounceCountAdd: 1, damageAfterBounceMultiplier: 0.8 },
  limits: { maximumTotalBounces: 3 },
} as const;
```

A skill's `limits` never override the shared hard caps; they are the skill's own ceiling, clamped
by the engine's global cap.

## 5. Loot items — five-category points (M2)

Ordinary loot has fixed, non-random point values (concept §6.6, §29.3):

```ts
export interface LootDefinition extends ContentDefinition {
  readonly kind: "loot";
  readonly rarity: "common" | "uncommon" | "rare" | "boss";
  readonly points: {
    readonly force: number;
    readonly precision: number;
    readonly motion: number;
    readonly guard: number;
    readonly signal: number;
  };
  readonly buildEffects?: Readonly<Record<string, number>>;
}

export const targetingCore: LootDefinition = {
  id: "targeting_core",
  kind: "loot",
  rarity: "uncommon",
  points: { force: 0, precision: 2, motion: 1, guard: 0, signal: 4 },
  buildEffects: { projectileHomingAdd: 0.05, detectionRadiusAdd: 25 },
} as const;
```

Avoid item-quality randomness, random stat rolls, procedural affixes, and hidden conversion
formulas (concept §6.6). Every item has clear, fixed values.

## 6. Enemies (M1 gets one, shipped)

M1 ships a single enemy definition — the Chaser (concept §14.2) — as data in `game-content`. Its
chasing behavior, health/death transitions, and contact-damage application are engine logic for a
later M1 chunk (M1.9/M1.10) and are not implemented yet; only the stats below exist so far. Enemy
behavior is selected from a small set of shared behaviors, not written per enemy:

```ts
export interface EnemyDefinition extends ContentDefinition {
  readonly kind: "enemy";
  readonly behavior: "chaser" | "ranged" | "heavy";
  readonly health: number;
  readonly moveSpeed: number;
  readonly contactDamage: number;
}

export const chaser: EnemyDefinition = {
  id: "chaser",
  kind: "enemy",
  behavior: "chaser",
  health: 20,
  moveSpeed: 90,
  contactDamage: 5,
} as const;
```

## 7. How to add a content item

Adapted from the technical plan §43. Adding **data** (the common case):

1. Define the item in the appropriate module (e.g. `weapons.ts`, `skills.ts`, `loot.ts`,
   `enemies.ts`) with a unique `id` and the correct `kind`.
2. Validate its tags and compatibility against existing tags — do not invent a new tag unless a
   mechanic needs it.
3. Connect it to an **existing** shared effect primitive; do not add engine code.
4. Add an icon/audio reference (asset delivery is deferred — reference by id/name for now; concept
   §24, technical plan §36).
5. Add balance tests and combination-limit tests (see `docs/TEST_PLAN.md`). Assert real rules
   (e.g. a projectile skill stack cannot exceed the weapon's `maxBounces`), not that a constant
   equals itself.
6. If you introduced a new field or `kind`, update this document.
7. Run all tests (`pnpm test`, and `pnpm test:integration` if server behavior changed).

Adding a **new effect primitive** (rare) is not content work and requires more (technical plan
§43): design approval, server implementation, client visualization, protocol review, anti-recursion
review, a performance test, and automated tests. Prefer reusing primitives so every new skill does
not become a custom subsystem.

## 8. Safety caps are non-negotiable

Hard caps — maximum projectiles per attack, bounces, pierces, child projectiles, active projectiles
per player, homing search radius, status-effect stacks; no recursive return/split; no infinite
on-hit loop — live in shared combat code and are enforced there, not merely in data (concept §9.5,
technical plan §13.4; `DEVELOPMENT_RULES.md`, "Preserve projectile and effect safety caps"). Content
may set a lower ceiling but can never raise one. Never weaken or remove a cap casually.
