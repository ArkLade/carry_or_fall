# M3 Execution Plan — Data-Driven Skills

This plan is followed during M3 implementation. M3 delivers three pre-run permanent skill slots,
8-10 initial skills, the shared effect pipeline stage M1 left as a pass-through, the temporary
wildcard skill slot, and the §13.4 hard caps under real combination load — still playable in the
browser with **no network** (technical plan
`docs/browser_multiplayer_game_technical_plan_verified_v2.md` §38 M3). It follows the execution-plan
format required by that plan §26.3 (files to change, invariants, tests, migration impact, rollback,
acceptance criteria) and uses `docs/M2_EXECUTION_PLAN.md` as its structural model. It must stay
consistent with `docs/M3_ISSUES.md`; §8 maps every issue to a section here.

Authoritative sources: `docs/lightweight_multiplayer_extraction_roguelite_game_concept.md`
(gameplay/scope, especially §8.3, §9, §10, §29.2) and
`docs/browser_multiplayer_game_technical_plan_verified_v2.md` (architecture/technology/testing,
especially §13.1, §13.4). Durable rules: `docs/DEVELOPMENT_RULES.md`. Approved technology:
`docs/DECISIONS.md`. Derived contracts: `docs/PROTOCOL.md`, `docs/CONTENT_AUTHORING.md`,
`docs/TEST_PLAN.md`.

## 1. Scope and scope resolution

**Deliver (technical plan §38 M3):** three pre-run permanent skill slots, 8-10 initial skills, the
shared effect pipeline, the wildcard skill, the hard caps — local, no network.

**Exit criteria (technical plan §38 M3):** supported combinations work; invalid combinations are
rejected; no recursive effect explosion.

### Scope resolution (restated and upheld)

`docs/M3_ISSUES.md` §1 records four scope decisions in detail; restated briefly here because they
shape §3's file list:

1. **Exactly one two-slot rare skill (`returning_shot`).** Validated structurally by
   `createSkillLoadout`, which rejects (never clamps) a selection whose summed `slotCost` exceeds
   `MAX_SKILL_SLOTS = 3`.
2. **The wildcard chip is a scattered ground pickup, drawn from the same `ALL_SKILLS` pool the
   permanent loadout uses** — not a boss-core drop (boss content stays M7, `docs/M2_ISSUES.md` §1
   precedent).
3. **No lobby or account-backed loadout screen.** A new client-only `LoadoutScene` (no persistence,
   D27-style local scope) lets a human assemble a legal loadout before a run starts.
4. **`split`/child-parent-effect caps stay unreachable this milestone**, recorded honestly rather than
   forcing an invented mechanic to exercise them (both are boss-core territory, concept §11/§29.4,
   M7).

**Reject-vs-clamp rule** (the task's required explicit decision): recorded in `docs/DECISIONS.md`
(new entries this milestone). Structural invalidity (unknown skill id, duplicate id, over-budget slot
cost) is **rejected** by `createSkillLoadout` — there is no sensible smaller version of "select four
slots' worth of skills." Magnitude invalidity (a legal loadout's summed effects exceeding a ceiling)
is **clamped** by `skill-effects.ts`, exactly like M2's `build-effects.ts` already clamps carried-loot
stacking — a legal loadout must keep working, just capped.

## 2. Architecture

### 2.1 Same seam, more state

M1/M2 established **exactly one** client→simulation seam (`stepSimulation`, called once per fixed
step). M3 does not add a second one. `World`/`Player`/`Enemy`/`Projectile` gain skill-related fields
(`skillLoadout`, `wildcardSkill`, `shieldHp`, `skillChips`, `stunnedMs`, and per-projectile
bounce/pierce/return/homing runtime state); `SimulationConfig` gains `skillLoadout` and
`skillChipSpawnPoints`. The pre-run loadout choice is validated by `createSkillLoadout` **before**
`createSimulation` is ever called — an invalid choice never reaches the simulation boundary, the same
principle M0's join-boundary validation (D18) and M2's inventory/secure-slot refusals already apply.

### 2.2 The shared skill pipeline stage becomes real

`combat/pipeline.ts`'s stage 4, `applyEquippedSkills`, was a documented pass-through since M1
specifically so M3 could fill it in without reworking the pipeline (`docs/M1_EXECUTION_PLAN.md`
§2.4). M3 makes it apply the player's current `SkillEffects` (aggregated from the permanent loadout
plus wildcard, tag-filtered against the weapon in use, capped) to an effective `WeaponDefinition`
copy for the weapon-shape effects (range, arc, recovery, projectile count, stun chance), and carries
the full aggregated value forward on `AttackDefinition.skillEffects` for the effects that are not
weapon-shape (bounce/pierce/return/homing are per-projectile runtime state; shield-on-hit is a
player-level effect). Stage order is unchanged from technical plan §13.1: skills (stage 4) apply
before carried-loot modifiers (stage 5, M2), so `prepareAttack` now takes both a `BuildEffects` and a
`SkillEffects` parameter, each defaulting to its "no effect" constant.

### 2.3 Anti-snowball caps for skill effects, alongside the existing §13.4 caps

Two independent capped aggregation pipelines now feed the same attack: M2's `build-effects.ts` (loot)
and M3's new `skill-effects.ts` (skills). `skill-effects.ts` clamps every summed `SkillEffects` key to
a fixed ceiling in shared code, following `build-effects.ts`'s established pattern. Separately,
`combat/caps.ts`'s pre-existing §13.4 constants (`MAX_BOUNCES`, `MAX_PIERCES`,
`MAX_RETURNS_PER_PROJECTILE`, `MAX_TARGET_SEARCH_RADIUS_PX`, `MAX_ACTIVE_PROJECTILES_PER_PLAYER`,
`MAX_PROJECTILES_PER_ATTACK`) remain the authoritative downstream enforcement for the effects that
correspond to a §13.4 cap — `skill-effects.ts` does not duplicate those specific ceilings, only the
effects that have no §13.4 counterpart (stun chance, shield, range/arc/recovery multipliers, homing
strength, the bounce damage multiplier). This is the concrete shape of "no recursive effect
explosion": every summed value is bounded either by `skill-effects.ts` or by `combat/caps.ts`, never
by neither.

### 2.4 Bounce/pierce/return/homing reuse existing collision and cap primitives

`combat/ranged.ts`'s `stepProjectiles` gains real bounce/pierce/return/homing behavior (M3.4),
implemented by reusing rather than duplicating:

- **Bounce** resolves each projectile's movement **per axis**, reusing `collision.ts`'s
  `resolveAxisMovement` exactly as the player's own two-axis movement resolution already does (an
  axis whose resolved value equals its input value was blocked); a blocked axis with
  `bouncesRemaining > 0` reflects that axis's velocity component instead of stopping.
- **Homing** reuses `combat/caps.ts`'s `clampSearchRadius` to bound the target search, the same
  primitive the (previously unreachable) cap 8 already declared.
- **Pierce/return** are new per-projectile counters (`piercesRemaining`, `returnsRemaining`) seeded
  once at spawn from `combat/caps.ts`'s `clampPierceCount`/`canProjectileReturn`, mirroring exactly
  how M1 already seeds a spawn's projectile count from `clampProjectilesPerAttack`.

### 2.5 Determinism

Skill-chip choice (which skill a scattered pickup grants) and the stun-chance roll both flow through
the existing seeded `createRng` (`world.rng`), exactly like M1's enemy-spawn selection and M2's
loot/extraction selection. `Math.random` must not appear in simulation code (technical plan §9.4).

### 2.6 Client stays a renderer; the loadout picker is a pure-function consumer, not a rule

No rule runs in Phaser scene code. `LoadoutScene` calls `createSkillLoadout` — a pure validation
function, not a game rule about combat, loot, or extraction — to decide whether a toggled selection
is legal, and passes the resulting `SkillLoadout` to `PlayScene` as scene data (no persistence). The
new HUD/render additions read `World` only, matching M1/M2's invariant.

## 3. Files to change (§26.3)

Legend: **(new, proposed)** = a file that does not exist yet, whose path/name is this plan's
proposal; **(modify)** = an existing repo file to edit; **(unchanged)** = called out because a reader
might expect it to change but it must not.

```
packages/game-content/src/
├─ index.ts         (modify)  export skills
├─ weapons.ts        (modify)  basicSword/basicBow gain a shared "attack" tag
├─ skills.ts         (new, proposed)  SkillDefinition, SkillEffects (typed), ten real skills, ALL_SKILLS
└─ skills.test.ts    (new, proposed)  shape-invariant tests

packages/simulation-core/src/
├─ index.ts                (modify)  export the new modules below
├─ world.ts                 (modify)  SkillChip, Player.shieldHp/skillLoadout/wildcardSkill,
│                                      Enemy.stunnedMs, Projectile bounce/pierce/return/homing fields,
│                                      World.skillChips
├─ skill-loadout.ts         (new, proposed)  MAX_SKILL_SLOTS, SkillLoadout, createSkillLoadout
├─ skill-loadout.test.ts    (new, proposed)
├─ skill-effects.ts         (new, proposed)  SkillEffects, NO_SKILL_EFFECTS, per-effect caps,
│                                             aggregateSkillEffects, MAX_SHIELD_HP,
│                                             applyDamageToPlayer, STUN_DURATION_MS
├─ skill-effects.test.ts    (new, proposed)
├─ skill-chip.ts            (new, proposed)  chooseSkillChipDrop, spawnSkillChip, isNearSkillChip
├─ skill-chip.test.ts       (new, proposed)
├─ enemy.ts                 (modify)  stepEnemyMovement respects stunnedMs
├─ simulation.ts            (modify)  wire skillLoadout/wildcard/shield/stun; per-step skill
│                                      aggregation (melee + ranged, tag-filtered) applied to the
│                                      pipeline; wildcard pickup on interactPressed; shield grant on
│                                      hit; stun applied from melee hit rolls; wildcard/shield cleared
│                                      on death and extraction
└─ combat/
   ├─ pipeline.ts    (modify)  applyEquippedSkills becomes real; AttackDefinition gains skillEffects;
   │                           prepareAttack takes SkillEffects
   ├─ melee.ts        (modify)  startMeleeAttack takes SkillEffects; resolveMeleeHits takes rng,
   │                            returns stunned target ids
   ├─ ranged.ts       (modify)  startRangedAttack takes SkillEffects and seeds per-projectile
   │                            bounce/pierce/return/homing state; stepProjectiles resolves bounce
   │                            (per-axis), pierce, return, and homing
   ├─ pipeline.test.ts, melee.test.ts, ranged.test.ts, enemy.test.ts, simulation.test.ts (modify)
   │                            cover the new parameters/behavior

apps/client/src/
├─ scenes/LoadoutScene.ts  (new, proposed)  pre-run local skill picker, validated live against
│                                           createSkillLoadout; Enter starts PlayScene with the
│                                           chosen loadout
├─ scenes/PlayScene.ts     (modify)  reads incoming loadout scene data (documented default fallback),
│                                    skill-chip spawn points, wires createSimulation
├─ main.ts                 (modify)  scene order: LoadoutScene first, then PlayScene, then BootScene
├─ hud/inventory-hud.ts    (modify)  shows the three permanent skill slots, wildcard slot, shield value
├─ render/world-view.ts    (modify)  renders skill chips and a shield indicator

docs/
├─ CONTENT_AUTHORING.md  (modify)  §4 skills moves from forward-looking free-form sketch to shipped,
│                                  typed shape
├─ M3_ISSUES.md          (already added this change)
└─ DECISIONS.md          (modify)  new entries: two-slot rare skill + reject-vs-clamp rule; wildcard
                                    chip's M3 source; local, non-persistent loadout picker

Explicitly unchanged in M3:
- apps/server/**, packages/protocol/**   no network in M3 (server/protocol work is M4); the
  forward-looking `replace_wildcard_skill` message (`docs/PROTOCOL.md`) stays unimplemented, exactly
  like M2's `inventory_move`/`secure_item` (D23's reasoning: a type with no consumer, local or
  networked, is an empty layer) — the wildcard pickup is a local-only intent via the existing
  `interactPressed`, the same treatment M2 gave loot pickup
- .github/**              CI unchanged; new tests run under the existing pnpm test/test:integration
- package.json / pnpm-lock.yaml   no new dependency
- .env / .env.example     no new configuration
- packages/simulation-core/src/build-effects.ts, points.ts, inventory.ts, loot-drop.ts, extraction.ts,
  run-result.ts   M2's loot/extraction/secure-slot systems are unchanged; skills are a second,
  parallel capped pipeline, not a rework of the first
```

## 4. Content definitions and provenance

Skill items are data definitions in `packages/game-content`, consumed by the engine — not
hard-coded (`docs/DEVELOPMENT_RULES.md`, "Content is data-driven"; `docs/CONTENT_AUTHORING.md` §4).

Provenance: `ricochet` matches concept §29.2's worked example exactly (`bounceCountAdd: 1`,
`damageAfterBounceMultiplier: 0.8`, `maximumTotalBounces: 3`) and is not renamed or re-numbered. The
other nine (`multishot`, `piercing_rounds`, `returning_shot`, `homing_arrows`, `extended_reach`,
`swift_strikes`, `stunning_blows`, `wide_arc`, `bulwark_strike`) do not appear by name in either
authoritative document; they are chosen to realize concept §9.4's four example combinations
(Ranged: Multishot/Ricochet/Returning Projectiles; Guided Ranged: Additional Projectiles/Homing/
Pierce; Melee Control: Extended Reach/Faster Recovery/Stun Impact; Defensive Melee: Shield on
Attack/Knockback/Wide Arc — `wide_arc` and `bulwark_strike` cover the arc and shield halves of the
fourth combination; a dedicated knockback-boosting skill is not added, since `basic_sword` already
declares `knockback: 120` and concept does not name a specific "Knockback" skill anywhere a definition
could be sourced from). All slot costs, tags, and numeric effect values are proposed and explicitly
balance-deferred (concept §12.3), the same treatment M1 gave weapon/enemy numbers and M2 gave loot
numbers.

## 5. Invariants (§26.3)

These must hold at every commit during M3, in addition to the M1 invariants (`docs/M1_EXECUTION_PLAN.md`
§6) and M2 invariants (`docs/M2_EXECUTION_PLAN.md` §5), which remain in force unchanged:

1. **One seam, extended not duplicated.** `stepSimulation` stays the only client→simulation call
   site.
2. **Skills are data.** `SkillDefinition`s are read by the engine; no per-skill behavior is
   hard-coded — a ninth/eleventh skill needs a definition plus tests, not an engine change.
3. **`SkillEffects` is a typed shape**, not a free-form `Record`, so a mistyped key is a compile
   error (matching M2's `LootBuildEffects` precedent).
4. **Skill effects are capped in shared code**, independent of and in addition to the three-slot
   budget — stacking the same effect via the permanent loadout and the wildcard still cannot exceed
   the cap in `skill-effects.ts` (or, for bounce/pierce/return/search-radius, `combat/caps.ts`).
5. **Loadout selection rejects; effect magnitude clamps.** `createSkillLoadout` never returns a
   silently-trimmed loadout; `skill-effects.ts`/`combat/caps.ts` never throw or refuse an attack for
   exceeding an effect ceiling — they clamp it.
6. **Tag-gating happens per attack, not at selection time.** A skill whose `requiresTags` does not
   match the weapon in use contributes nothing to that attack's aggregation, but remains a legally
   selected skill.
7. **The wildcard slot never costs a permanent slot** and is always replaceable, never refused.
8. **The wildcard is lost on death and cleared on extraction.** Nothing about it persists past a run
   (no account/boss-core system exists yet, M5/M7).
9. **Split and child-parent-effect stay unimplemented.** No pipeline stage, weapon, or skill produces
   either behavior this milestone (§1 of `docs/M3_ISSUES.md`).
10. **Determinism.** Skill-chip choice and stun rolls flow through `createRng`/`world.rng`; no
    `Math.random` in simulation code.
11. **Strict TypeScript, validated inputs.** No implicit `any`; the pre-run loadout choice is
    validated by `createSkillLoadout` before it reaches `createSimulation`.
12. **Scope fence.** No boss cores, no networking, no accounts, no weapon/armor blueprints, no new
    enemy type, no lobby/account-backed picker, no split-on-hit mechanic (`docs/M3_ISSUES.md` §1).

## 6. Anti-snowball caps — implemented in shared code with tests

Per concept §30.2/§31 extended from loot (M2) to skills, `skill-effects.ts` clamps the **aggregate**
(post-sum) value of every recognized `SkillEffects` key that has no existing §13.4 counterpart in
`combat/caps.ts`:

- `homingStrengthAdd` — summed fractional steering strength, capped by `MAX_HOMING_STRENGTH`.
- `damageAfterBounceMultiplier` — aggregated as a floored product (never a straight sum, since it is
  multiplicative), capped by `MIN_DAMAGE_AFTER_BOUNCE_MULTIPLIER` so bounced damage can never reach
  zero.
- `rangeMultiplierAdd` — summed fractional melee range bonus, capped by `MAX_RANGE_MULTIPLIER_ADD`.
- `arcDegreesAdd` — summed flat melee arc bonus, capped by `MAX_ARC_DEGREES_ADD`.
- `recoveryReductionAdd` — summed fractional melee recovery reduction, capped by
  `MAX_RECOVERY_REDUCTION_ADD` so recovery can never collapse toward zero.
- `stunChanceAdd` — summed fractional stun-chance bonus, capped by `MAX_STUN_CHANCE_ADD`; the
  resulting effective `weapon.stunChance` is separately clamped to `[0, 1]` in `combat/pipeline.ts`.
- `shieldOnHitAdd` — summed per-hit shield grant, capped by `MAX_SHIELD_ON_HIT_ADD`; the player's
  total `shieldHp` is separately capped by `MAX_SHIELD_HP`.

The three effects that map onto an existing §13.4 cap (`bounceCountAdd`, `pierceCountAdd`,
`projectileCountAdd`) are summed here without a duplicate local ceiling — `combat/caps.ts`'s
`clampBounceCount`/`clampPierceCount`/`clampProjectilesPerAttack` remain the sole downstream
enforcement, so the cap constant is never defined twice. `returnEnabled` is boolean (no magnitude to
cap); the *count* of returns is capped by `combat/caps.ts`'s `MAX_RETURNS_PER_PROJECTILE` regardless
of how many equipped skills declare `returnEnabled: true`.

Each cap with no existing §13.4 counterpart has a unit test asserting stacking past it does not
exceed the ceiling, following M1's `combat/caps.test.ts` and M2's `build-effects.test.ts` pattern.

## 7. Tests (§26.3)

All M3 tests are **unit** tests in `packages/*/src/**/*.test.ts` (the Vitest `unit` project), per
`docs/TEST_PLAN.md` §2.1/§4, which already names M3's required scope: "supported combinations work,
invalid combinations are rejected, and no combination breaches the shared hard caps (no recursive
effect explosion)."

- **Skill content** — shape invariants; every `effects` key present is recognized; exactly one skill
  costs 2 slots.
- **Skill loadout** — three 1-slot skills accepted; the 2-slot skill plus one 1-slot skill (3 total)
  accepted; the 2-slot skill plus two 1-slot skills (4 total) rejected; unknown/duplicate ids
  rejected; an empty selection accepted.
- **Skill effects** — a bounce/pierce/return/homing skill measurably changes `startRangedAttack`'s
  output; a range/arc/recovery/stun skill measurably changes `startMeleeAttack`'s output; caps hold
  under stacking (permanent + wildcard duplicate); a tag-incompatible skill contributes nothing.
- **Ranged skill behavior** — bounce reflects off a wall and is exhausted correctly; pierce damages
  multiple targets without double-hitting one; return reverses once and expires on the second
  lifespan end; homing bends trajectory toward a target within radius and ignores one beyond it.
- **Melee skill behavior / shield** — a forced-success stun roll disables chaser movement for
  `STUN_DURATION_MS`; shield absorbs damage before health and caps correctly.
- **Skill chip / wildcard** — pickup sets the wildcard skill; a second pickup replaces without
  refusal; the wildcard's effects are included in aggregation; death clears it; seeded drop choice is
  reproducible.
- **Recursive-explosion / cap-reachability tests** — the worst-legal-ranged-combination and
  worst-legal-melee-combination scenarios (M3.6) each hold every applicable cap over hundreds of
  simulated steps with a full loot inventory also equipped; the 2-slot `returning_shot` combination
  holds the return cap; `stepSimulation` completes without throwing and without unbounded collection
  growth.

`pnpm test:integration` and the production-build tests are unchanged from M2 and must stay green (M3
adds no server/network code). Browser end-to-end (Playwright) remains deferred; M3 uses a manual local
playtest for feel (technical plan §45).

## 8. Issue → plan mapping (`docs/M3_ISSUES.md`)

| Issue (`docs/M3_ISSUES.md`)                         | Covered by this plan                                     |
| ---------------------------------------------------- | ---------------------------------------------------------- |
| M3.1 Skill content                                   | §4; `skills.ts` in §3                                       |
| M3.2 Permanent skill loadout                         | §2.1, §5(5); `skill-loadout.ts` in §3                        |
| M3.3 Skill effect aggregation and caps               | §2.2, §2.3, §6; `skill-effects.ts`, `combat/pipeline.ts` in §3 |
| M3.4 Ranged skill behavior (bounce/pierce/return/homing) | §2.4; `combat/ranged.ts` in §3                            |
| M3.5 Melee skill behavior (stun/shield)               | §5(4); `enemy.ts`, `combat/melee.ts`, `simulation.ts` in §3   |
| M3.6 Hard caps under real combination load            | §6, §7                                                       |
| M3.7 Wildcard skill chip                              | §2.5; `skill-chip.ts` in §3                                   |
| M3.8 Client wiring                                    | §2.6; `scenes/`, `hud/`, `render/` in §3                      |

**Scope changes to the issues:** none. `docs/M3_ISSUES.md` §1's four scope decisions are restated in
§1 above, not altered here.

## 9. Migration impact (§26.3)

- **Dependencies:** none added; `pnpm-lock.yaml` unchanged.
- **Existing tests/CI:** all M1 and M2 unit and integration tests, and the production-build tests,
  must stay green. `.github/workflows/ci.yml` is unchanged; new tests run under the existing
  `pnpm test` step.
- **Server/protocol:** untouched. The forward-looking `replace_wildcard_skill` message
  (`docs/PROTOCOL.md`) is **not** implemented — M3 has no network boundary for it to cross (D23's
  reasoning, restated from M2).
- **Client entry behavior:** the client now boots into a new `LoadoutScene` before `PlayScene`
  (previously `PlayScene` was the direct entry point, per `docs/M1_EXECUTION_PLAN.md` §9's boot-flow
  clarification). Documented here and in `docs/M3_ISSUES.md`.
- **Docs:** `docs/CONTENT_AUTHORING.md` §4 moves from a forward-looking free-form `Record` sketch to
  the shipped, typed `SkillEffects` shape — corrected in the same change, matching how M2 corrected
  §5 for loot (`docs/DEVELOPMENT_RULES.md`, "Documentation").
- **No data or infrastructure migration:** M3 has no database, schema, or deployment surface
  (`docs/DECISIONS.md` D16, D22).

## 10. Rollback (§26.3)

M3 is **additive** on top of M2 (tagged `v0.2.0-loot-extraction`); nothing is committed unless
explicitly requested by the task that authorized this work.

- To back out, delete the new `simulation-core` modules (§3), the new `game-content` `skills.ts`, and
  the new/modified client files; revert the `weapons.ts` tag addition and the pipeline/melee/ranged
  signature changes; revert the doc edits (`docs/CONTENT_AUTHORING.md`, `docs/DECISIONS.md`, this
  plan, `docs/M3_ISSUES.md`). The repo returns to the M2 state.
- There are **no migrations, no persisted data, and no infrastructure** to undo (§9).
- Work happens on the `m3-skills` branch; `main` and the `v0.2.0-loot-extraction` tag are not touched.
  Revert with `git revert <sha>` if needed; never force-push or rewrite shared history.

## 11. Acceptance criteria (§26.3)

Matching the technical plan §38 M3 exit criteria, plus the repository gates:

- **Supported combinations work** — a legal loadout's skills measurably change combat math and
  projectile behavior through the real pipeline, tested (M3.3-M3.5).
- **Invalid combinations are rejected** — `createSkillLoadout` refuses an over-budget, unknown-id, or
  duplicate-id selection outright, tested (M3.2).
- **No recursive effect explosion** — every reachable §13.4 cap, plus every new `skill-effects.ts`
  ceiling, holds under the worst legal combination of skills, wildcard, and loot, tested (M3.6).
- All gates pass: `pnpm format:check`, `pnpm lint`, `pnpm typecheck`, `pnpm test`,
  `pnpm test:integration`, and `pnpm build`.
- Skills are data-driven, effect caps are enforced in shared code and tested, and no out-of-scope
  system was added (§1, §5).
- A human has playtested the full local loop for feel (technical plan §45): assemble a loadout, see
  an illegal one refused, fight with skill-modified attacks, swap the wildcard, lose it on death.

## 12. Assumptions

- The technical plan is authoritative for milestone boundaries where it and the concept document's
  tiers differ (as in M1/M2); concept §27.1's Prototype Tier 1 groups skills with the rest of the
  core loop, but the technical plan's M1-M3 split is what this repository follows
  (`docs/M1_EXECUTION_PLAN.md` §1, restated here).
- Proposed module/file names in §3 and proposed numeric values in §4/§6 are subject to change during
  implementation; only the invariants (§5), caps (§6), and acceptance criteria (§11) are fixed
  commitments.
- No new dependency is required to meet M3; if implementation reveals one, it needs a new entry in
  `docs/DECISIONS.md` before adoption, and this task's instructions require stopping to report it
  rather than choosing.

## 13. Non-goals

M3 implements none of the following (deferred to the stated milestone, or decided out per §1): boss
skill cores and split-on-hit behavior (M7); Colyseus rooms, authoritative server state, and other
players (M4); PvP (M7B); accounts, Supabase, persistence, a real loadout-picker backed by an account (M5);
parties/matchmaking (M6); deployment (M8+); mobile controls; client prediction; weapon/armor
blueprints and permanent unlocks; new enemy types; a wildcard chip dropped by the chaser. No empty
service layers are created for any of these (`docs/DEVELOPMENT_RULES.md`, "Scope discipline").
