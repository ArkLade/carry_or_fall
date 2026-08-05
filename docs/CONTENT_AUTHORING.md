# Content Authoring

Status: **M7 shipped.** The content package contains 11 skills, six ordinary loot definitions,
one ordinary enemy, the arena, the Warden/core content, and unlock definitions covering
default, threshold, and boss-core sources. These are real data in
`@carry-or-fall/game-content`, read by the shared attack pipeline, `build-effects.ts`, and
`skill-effects.ts` in `@carry-or-fall/simulation-core`. This document explains how to add a
weapon, armor type, skill, loot item, or enemy as a **data definition** — not as new engine code.
This follows the technical plan §7.2 and §43 and the `docs/DEVELOPMENT_RULES.md` rule that content
is data-driven.

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

## 4. Skills — data-driven, tag-gated (M3, shipped)

Skills modify shared combat primitives and declare compatibility through tags rather than custom
code (concept §9.1–§9.3, §29.2). `effects` is a **typed shape** (`SkillEffects`), not a free-form
bag: it only recognizes the eleven keys `packages/simulation-core/src/skill-effects.ts`'s
`aggregateSkillEffects` actually sums (or, for `damageAfterBounceMultiplier`, multiplies) and caps,
so a mistyped key is a compile error, not a silently inert field — the same discipline §5 already
applies to loot's `buildEffects`.

```ts
export interface SkillEffects {
  readonly projectileCountAdd?: number;
  readonly bounceCountAdd?: number;
  readonly damageAfterBounceMultiplier?: number;
  readonly pierceCountAdd?: number;
  readonly returnEnabled?: boolean;
  readonly homingStrengthAdd?: number;
  readonly rangeMultiplierAdd?: number;
  readonly arcDegreesAdd?: number;
  readonly recoveryReductionAdd?: number;
  readonly stunChanceAdd?: number;
  readonly shieldOnHitAdd?: number;
}

export interface SkillDefinition extends ContentDefinition {
  readonly kind: "skill";
  readonly slotCost: 1 | 2;
  readonly requiresTags: readonly string[];
  readonly effects: SkillEffects;
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

`requiresTags` is matched against a weapon's `tags` with "any overlap" semantics, checked **per
attack** (`combat/pipeline.ts` stage 4), not at loadout-selection time: a skill whose tags don't
match the weapon currently in use is legally selected but contributes nothing to that attack. Both
`basicSword` and `basicBow` (§3) carry a shared `attack` tag alongside their category tag, so a
skill meant to apply to either weapon (e.g. `bulwark_strike`) can require `["attack"]` instead of
listing every category tag.

A skill's `limits` never override the shared hard caps; they are the skill's own documented ceiling,
informational alongside the actual enforcement point. Three `SkillEffects` keys
(`projectileCountAdd`, `bounceCountAdd`, `pierceCountAdd`) map onto an existing `combat/caps.ts` §13.4
cap and are never given a second, duplicate ceiling in `skill-effects.ts`; every other key is capped
there (anti-snowball, concept §30.2/§31, extended from loot's `build-effects.ts` to skills).

`ALL_SKILLS` (`packages/game-content/src/skills.ts`) ships ten skills: `multishot`, `ricochet`,
`piercing_rounds`, `returning_shot` (the one 2-slot rare skill, `docs/DECISIONS.md`), and
`homing_arrows` (`projectile`-tagged); `extended_reach`, `swift_strikes`, `stunning_blows`, and
`wide_arc` (`melee`-tagged); `bulwark_strike` (`attack`-tagged). `ricochet` matches concept §29.2's
worked example exactly; the other nine realize concept §9.4's four example combinations and are
proposed, balance-deferred values (concept §12.3), like every other content number in this document.

The permanent skill loadout is validated, not clamped: `packages/simulation-core/src/
skill-loadout.ts`'s `createSkillLoadout(skillIds)` rejects an unknown id, a duplicate id, or a
selection whose summed `slotCost` exceeds `MAX_SKILL_SLOTS` (3) — a structural invalidity has no
sensible smaller version, so it is refused, matching M2's precedent for a full inventory or an
already-occupied secure slot. By contrast, a *legal* loadout's summed effect magnitude is clamped in
`skill-effects.ts`, exactly like M2's `build-effects.ts` clamps carried loot.

## 5. Loot items — five-category points (M2, shipped)

Ordinary loot has fixed, non-random point values (concept §6.6, §29.3). `buildEffects` is a typed
shape, not a free-form bag: it only recognizes the keys `packages/simulation-core/src/
build-effects.ts`'s `aggregateBuildEffects` actually sums and caps, so a mistyped key is a compile
error, not a silently inert field. An item may declare none, one, or several of these keys — a
loot item with points but no active-build role (e.g. `signal`-leaning loot) is valid. M3's
`homing_arrows` skill (§4) is the real homing mechanic; `LootBuildEffects` still has no
signal-flavored key of its own, since loot and skills are two separate, parallel capped pipelines
(`docs/M3_EXECUTION_PLAN.md` §2.3) and no loot item currently declares one.

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
  readonly buildEffects?: {
    readonly damageAdd?: number;
    readonly attackSpeedBonus?: number;
    readonly projectileSpeedAdd?: number;
    readonly moveSpeedBonus?: number;
    readonly maxHealthAdd?: number;
  };
}

export const honingStone: LootDefinition = {
  id: "honing_stone",
  kind: "loot",
  rarity: "common",
  points: { force: 2, precision: 0, motion: 0, guard: 0, signal: 0 },
  buildEffects: { damageAdd: 3 },
} as const;
```

M2 shipped six ordinary items (`ALL_LOOT` in `packages/game-content/src/loot.ts`): `honing_stone`,
`farsight_lens`, `quickstep_charm`, `scrap_plating`, `resonant_core`, and `warlords_seal` (rare,
mixed-category, meant as secure-slot bait). M7 added `split_return_core`, a `boss`-rarity item held
in `ALL_BOSS_CORES` rather than `ALL_LOOT`; the separate registries keep ordinary loot tables from
spawning a boss reward. Weapon and armor blueprints remain unimplemented.

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
  /** How often a touching enemy re-applies `contactDamage`, in milliseconds. */
  readonly contactDamageIntervalMs: number;
}

export const chaser: EnemyDefinition = {
  id: "chaser",
  kind: "enemy",
  behavior: "chaser",
  health: 100,
  moveSpeed: 90,
  contactDamage: 5,
  contactDamageIntervalMs: 500,
} as const;
```

`health` was raised from `20` to `100` during M4 preparation: at `20` a chaser died to a single
`basic_sword` swing, so no fight lasted long enough for skill effects, stun, or shield to be
observable in a playtest. Like every other number in this document it stays proposed and
balance-deferred (concept §12.3). The number of enemies a match spawns is **not** a property of the
enemy definition — it belongs to the map's encounter design, and since M4 it lives on the arena
definition below as `enemyCount`.

## 6.1 Arenas (M4, shipped)

The map a match is played on is content. It was a client constant through M3, and had to move at M4:
the server now owns the map — the authoritative simulation collides against these walls and spawns
from these points — while the client draws the same geometry. Two ends needing the same data means
one definition, and a definition consumed by both ends is content (technical plan §7.1 shares
definitions, never authority).

```ts
export interface ArenaDefinition extends ContentDefinition {
  readonly kind: "arena";
  readonly width: number;
  readonly height: number;
  readonly walls: readonly ArenaWall[];      // axis-aligned boxes (technical plan §12.1)
  readonly playerSpawnPoints: readonly ArenaPoint[]; // at least 8: a full room must not stack
  readonly enemySpawnPoints: readonly ArenaPoint[];
  readonly enemyCount: number;               // distinct candidates chosen per match by the seeded RNG
  readonly groundLootSpawnPoints: readonly ArenaPoint[];
  readonly skillChipSpawnPoints: readonly ArenaPoint[];
  readonly extractionCandidatePoints: readonly ArenaPoint[]; // more than the two active at once
  readonly openLaneY: number;                // a full-width lane with no wall across it
}
```

`testArena` is the one arena the game ships (concept §21.1's "initial map"); `ALL_ARENAS` and
`findArena(id)` are how both ends resolve the `arenaId` the server publishes in match state.

Rules when adding or changing one:

- **No spawn point may sit inside a wall or outside the bounds.** An actor spawned inside geometry is
  stuck for the whole match: its own collision resolution will not move it out.
  `arena.test.ts` enforces this for every arena in `ALL_ARENAS`, so a new one is checked for free.
- **At least eight distinct player spawns**, far enough apart not to overlap — a room holds eight
  (technical plan §8.1).
- **More extraction candidates than the two active at once**, because concept §17.1 requires a point
  to "reopen elsewhere".
- **Changing arena geometry is a content-version change** (`docs/DECISIONS.md` D34): a client with
  the old walls would draw a map the server does not collide against.

## 6.2 Unlocks — three sources (M5–M7, shipped)

`packages/game-content/src/unlocks.ts`. An unlock says which content an account may bring into a run;
the join gate refuses anything the account does not hold (technical plan §19,
`docs/DECISIONS.md` D48).

```ts
export interface UnlockDefinition extends ContentDefinition {
  readonly kind: "unlock";
  readonly unlockType: "skill" | "weapon" | "armor";
  readonly source: "default" | "threshold" | "boss_core";
  /** The granting balance, and `null` for every source except `"threshold"`. */
  readonly requires: { readonly category: PointCategory; readonly amount: number } | null;
}
```

Rules for authoring one:

- **The `id` *is* the content id it grants** (`stunning_blows`, `basic_bow`), and `unlockType` says
  which table to look it up in. This is the same shape the `unlocks` table stores
  (`docs/DATA_MODEL.md` §3.3): a row there means only "this account has this id", and what the id
  grants lives here, in the repository.
- **Every shipped skill needs exactly one unlock definition, from exactly one `source`.** The three
  sources are `"default"` (concept §5.4's starting set), `"threshold"` (a point total), and
  `"boss_core"` (M7 — earned by carrying a core out, never by any balance). A skill in none could
  never be selected by any account; a skill in two would be earnable after already being granted.
  `unlocks.test.ts` asserts the partition, and `boss.test.ts` asserts that no balance, however
  large, grants a boss-core unlock.
- **Only `threshold` sources have a non-null `requires`.** `default` and `boss_core` unlocks are
  granted by their own server-owned events (`docs/DECISIONS.md` D67).
- **A threshold must trace to a concept §6 sentence.** Each category says what it is "used to unlock
  or improve"; map the skill to the category whose description names its effect, and say which
  sentence in the comment.
- **Balances are never spent** (D48). A threshold is a level on an accumulating total, not a price.
- **The defaults must keep D31's default loadout legal**, or a brand-new account is refused at its
  first join.
- Amounts are proposed and balance-deferred like every other unsourced number (concept §12.3).
- Adding or removing an unlock is a **`CONTENT_VERSION` bump**: the client marks skills locked from
  its own copy of this table while the server gates on its copy, so a stale client would offer a
  selection the server refuses.

Guard currently has no threshold unlock, and that gap is asserted by a test rather than left
silent — §6.4's unlock targets are armor types and shield skills, armor is unimplemented, and the one
shield skill is a default. The milestone that adds armor closes it.

## 6.3 Bosses (M7, shipped)

`packages/game-content/src/boss.ts`. A boss is a definition, not engine code:
`packages/simulation-core/src/boss.ts` implements the three states (dormant, engaged, returning),
the telegraph, and the leash, and contains **nothing specific to `warden`**. A second boss is a
definition plus tests.

```ts
export interface BossAttack {
  readonly id: string;
  readonly kind: "arc" | "area";
  readonly damage: number;
  readonly rangePx: number;
  readonly arcDegrees: number;   // ignored by "area"
  readonly telegraphMs: number;  // wind-up before the damage lands
  readonly intervalMs: number;
}

export interface BossDefinition extends ContentDefinition {
  readonly kind: "boss";
  readonly health: number;
  readonly radius: number;
  readonly moveSpeed: number;
  readonly aggroRadiusPx: number;  // measured from the lair, not from the boss
  readonly leashRadiusPx: number;  // the circle it cannot leave
  /** Concept §14.3's "two normal attacks plus one area attack", in priority order. */
  readonly attacks: readonly [BossAttack, BossAttack, BossAttack];
  readonly enrageBelowHealthFraction: number;
  readonly enrageIntervalMultiplier: number;
  readonly coreLootId: string;
}
```

Rules for authoring one:

- **Exactly three attacks, scanned in order.** The first ready attack whose shape would land is the
  one that starts, which is deterministic — a random choice would make a replay diverge. Listing the
  area attack last, on the longest interval, is what makes it the exception rather than the habit
  (concept §14.3).
- **`telegraphMs` is the contract with the player.** Concept §14.3's "readable" means a player who
  reacts to the wind-up can leave before the hit. A telegraph shorter than a player's reaction plus
  a round trip is a delay, not a tell. The client draws the shape from this definition, so the shape
  a player dodges is the shape the server resolves.
- **`aggroRadiusPx` is measured from the lair and `leashRadiusPx` bounds the boss's position from
  it**, so `leashRadiusPx > aggroRadiusPx`. That pairing is what makes the boss "attract nearby
  players" (§14.3) rather than roam: there is a circle it cannot leave, and everything outside that
  circle is exactly as dangerous as it was before the boss existed (`docs/DECISIONS.md` D66).
- **No projectile attacks.** A boss projectile that damaged a player would be the first projectile
  in the game not owned by a player, and every §13.4 cap counts per owner. D66 defers it rather than
  quietly widening the cap model.
- **Where the lair goes is a decision about the whole map**, not a flavour choice: `bossSpawnPoint`
  on the arena decides which existing routes become dangerous. `testArena`'s comment records the
  measured distance from the lair to every route the browser suite walks, so the boss cannot erode
  those timing margins by construction (`docs/M7_ISSUES.md` §1.8).
- Every number here is proposed and balance-deferred (concept §12.3).

## 6.4 Boss cores — the loot a boss drops (M7, shipped)

A boss core is **loot that carries a record**, not a new inventory kind (`docs/DECISIONS.md` D65).
That shape is the whole reason pickup, death-drop, looting off another player's body, securing, and
extraction all work for a core with no new code:

```ts
export interface BossCoreRecord {
  readonly temporarySkillId: string;   // concept §11 option 1: activate now
  readonly permanentUnlockId: string;  // concept §11 option 3: secure it
  readonly secureSlotAllowed: boolean;
  readonly duplicateConversion: LootPoints; // concept §11's duplicate rule
}

// on LootDefinition:
readonly bossCore?: BossCoreRecord;
```

Rules for authoring one:

- **A core's own `points` are zero.** An ordinary item converts to points; a core converts to an
  *unlock*, and only a duplicate converts to points. Zero keeps the two categorically distinct, so
  "first core" and "duplicate core" can never be confused for a bigger and smaller payout.
- **Cores are not in `ALL_LOOT`.** They are not part of any random drop table — a core exists
  because a boss died. `findLoot` searches both tables, so every id-resolving path still finds one.
- **`duplicateConversion` must be worth more than the best ordinary item**, or the duplicate rule
  reads as a punishment for killing the boss twice. `boss.test.ts` asserts this rather than trusting
  the number.
- **`permanentUnlockId` must have an unlock definition with `source: "boss_core"`**, and that unlock
  must be unreachable by any point balance (`unlockForBossCore`). A boss unlock that a threshold
  could also grant would make the boss optional, which is not what concept §11 describes.

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
7. **Bump `CONTENT_VERSION`** (`packages/game-content/src/version.ts`) if the change would make a
   stale client disagree with the server about what a player sees or is awarded — new or removed ids,
   changed damage or ranges, changed arena geometry. A purely cosmetic change does not need it. The
   join handshake compares this version and refuses a mismatched client (`docs/DECISIONS.md` D34).
8. Run all tests (`pnpm test`, and `pnpm test:integration` if server behavior changed).

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
