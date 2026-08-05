# M3 Issue List — Data-Driven Skills

Status: **Delivered.** The bounded
task list for milestone **M3**, per the technical plan §38 (M3) and the repository's
per-milestone-issue-list practice established at M1/M2. M3 was implemented **after** M2 (tagged
`v0.2.0-loot-extraction`); no M2 tail defects are carried forward.

## Scope

**Deliver (technical plan §38 M3):** three pre-run permanent skill slots, 8-10 initial skills, the
shared effect pipeline (`combat/pipeline.ts`'s `applyEquippedSkills`, a pass-through since M1), the
temporary wildcard skill slot, and the hard caps under real combination load.

**Exit criteria (technical plan §38 M3):**

- Supported combinations work.
- Invalid combinations are rejected.
- No recursive effect explosion.

**Explicitly out of M3** (later milestones or never, per the authoritative documents): Colyseus
rooms/networking and other players (M4); PvP (M7B); accounts, Supabase, persistence (M5); parties/matchmaking
(M6); the boss and boss skill cores, `split_return`-style split-on-hit skills (M7, concept §11 — see
§1 below); deployment (M8+); mobile controls; client prediction; weapon/armor blueprints and their
permanent unlocks (still M5, per `docs/M2_ISSUES.md` §1); a lobby/account-backed loadout screen
(still M5 — see §1 below).

## Architectural constraints (apply to every issue)

- **Skills are shared, deterministic simulation state and logic in `packages/simulation-core`**,
  consumed by the client — the same seam M1/M2 established (concept §9.1 "avoid writing separate
  custom logic for every skill combination"; technical plan §13.1 shared pipeline). The client keeps
  deciding no outcomes; it renders state and (this milestone) reports one new local-only intent, the
  pre-run loadout choice, exactly as M2 reported discard/secure choices.
- **Skills are data** in `@carry-or-fall/game-content` (`SkillDefinition`, `docs/CONTENT_AUTHORING.md`
  §4), not hard-coded into the engine — matching how weapons, loot, and the chaser were shipped.
  `SkillEffects` is a **typed shape**, not a free-form `Record<string, number | boolean>` (the M2
  precedent for `LootBuildEffects`, `docs/M2_EXECUTION_PLAN.md` §5.10): only the keys
  `skill-effects.ts` actually aggregates are legal, so a mistyped key is a compile error rather than a
  silently inert field. This corrects `docs/CONTENT_AUTHORING.md` §4's forward-looking free-form
  `Record` sketch to the typed shape, the same correction M2 made for loot's `buildEffects`.
- **`combat/pipeline.ts`'s stage 4, `applyEquippedSkills`, becomes real.** It was a documented
  pass-through since M1 specifically so M3 could fill it in without reworking the pipeline
  (`docs/M1_EXECUTION_PLAN.md` §2.4, restated in `docs/M2_EXECUTION_PLAN.md` §2.2 for stage 5). It
  now applies the tag-filtered, capped sum of the player's equipped skills (permanent loadout plus
  wildcard) to the attack, ahead of stage 5's carried-loot modifiers — the same ordering the pipeline
  diagram in technical plan §13.1 lists (skills, then loot).
- **Hard caps stay in shared code, and this milestone is what finally drives most of them from real
  gameplay.** `combat/caps.ts` (M1) already declares all eight §13.4 caps in shared code, but several
  were unreachable from any mechanic (`docs/M1_ISSUES.md`, the bounce-cap note). M3 wires bounce,
  pierce, return, and homing/search-radius behavior into `combat/ranged.ts` for the first time — the
  base weapon still does not bounce/pierce/return (concept §29.2: those are skill effects, not weapon
  behavior); only an equipped skill grants them. Two of the eight caps (split, child-parent-effect)
  remain structurally unreachable this milestone — see §1 and §5 below; this is recorded, not
  papered over.
- **Anti-snowball caps for skill effects live in `skill-effects.ts`**, a new module parallel to M2's
  `build-effects.ts`: every summed/aggregated skill effect is clamped in shared code, independent of
  and in addition to both the three-permanent-slot budget and the §13.4 caps that already bound
  bounce/pierce/return/search-radius. Two effect pipelines (skills, loot) both feed the same weapon
  and both must hold their own caps simultaneously — this is the "recursive effect explosion" exit
  criterion made concrete.
- **Loadout selection is a structural refusal, not a clamp.** Choosing more than three slots' worth
  of permanent skills, an unknown skill id, or a duplicate id in the same loadout is **rejected**
  outright (`createSkillLoadout` returns a typed failure, refused like M2's full-inventory/full-secure-
  slot cases) — never silently trimmed to fit. By contrast, **effect magnitude** overflow from a
  legal loadout (e.g., stacking bounce/pierce/stun/shield past their ceiling) is **clamped**, exactly
  like M2's `build-effects.ts` already does for carried loot. §1 records why the line falls here.
- **No persistent stash; no accounts.** The permanent skill loadout is chosen fresh, locally, at the
  start of each browser session, exactly like M1's hard-coded weapon pair and M2's hard-coded loot
  placement — see §1's third scope decision and `docs/DECISIONS.md` (new entry this milestone,
  mirroring D27's local-scope treatment).
- **Strict TypeScript, no unchecked inputs.** Same fixed simulation step; the same one
  client→simulation seam M1/M2 established. The pre-run loadout choice is validated by
  `createSkillLoadout` before it ever reaches `createSimulation` — an invalid choice never produces a
  world.
- Each issue must pass the standard gates (`pnpm format:check`, `pnpm lint`, `pnpm typecheck`,
  `pnpm test`, `pnpm test:integration`, `pnpm build`) and add tests for any meaningful rule it
  introduces (`docs/TEST_PLAN.md`).

### §1. Scope decisions (recorded here, not improvised silently)

- **Two-slot rare skills: M3 ships exactly one.** Concept §8.3 permits "strong rare skills may cost
  two slots." `returning_shot` (Returning Projectiles, concept §9.4's ranged combo) is the one M3
  rare, 2-slot skill: `slotCost: 2`. Slot cost is validated structurally by `createSkillLoadout`
  (§2.2), which sums every selected skill's `slotCost` against `MAX_SKILL_SLOTS = 3` and **rejects**
  (does not clamp) a selection that would exceed the budget — so `returning_shot` plus any two other
  skills is refused, while `returning_shot` plus one 1-slot skill (3 total) is accepted. This is a
  real, load-bearing rule, not a restated constant: it is what makes "invalid combinations are
  rejected" (the M3 exit criterion) concrete for the loadout-selection boundary, distinct from the
  effect-magnitude caps in `skill-effects.ts`.
- **The wildcard chip's M3 source is scattered ground pickups, exactly like M2.6's loot**, not boss
  cores. Concept §10 (wildcard) and concept §11 (boss skill cores) are two separate systems: §10's
  "the player may find a temporary skill chip" names no source, while §11's boss-core mechanic is
  explicitly gated on a boss, which is M7 (`docs/M2_ISSUES.md` §1 already deferred boss content).
  Since M3 has no boss and no new enemy type (this document does not add one either), a `SkillChip`
  ground entity is scattered on the local test map at run start — the same non-goal workaround M2.6
  used for ground loot ("the one M1 chaser is the only kill-based loot source... static ground
  pickups... fills out the six-slot inventory"). A skill chip's temporary skill is chosen (seeded
  RNG, no `Math.random`) from the same `ALL_SKILLS` pool the permanent loadout draws from — concept
  §10 does not restrict the wildcard pool to a rare/boss-only subset, only §11's boss cores are
  boss-exclusive. Picking up a chip always replaces the current wildcard skill (concept §10: "a new
  chip may replace the current one"); there is no refusal case, unlike inventory/secure-slot pickup.
- **No lobby or account-backed loadout screen; a local, client-only pre-run picker instead**, in the
  same spirit as `docs/DECISIONS.md` D27's secure-slot scope note. Concept §8.3 says skills are
  "selected before entering the match," and technical plan §38 M3 lists "three pre-run skill slots"
  as a deliverable — read together, this is a real, played mechanic this milestone, not just internal
  engine state, but M3 still has no account or lobby (M5/M6). The resolution: a new client-only
  `LoadoutScene`, shown before `PlayScene`, where the player toggles up to three skills (validated
  live against `createSkillLoadout`) and presses Enter to start; nothing is written to storage, the
  choice does not survive a page reload, and there is no networked matchmaking or waiting room (a
  "lobby" implies both of those; this is a local menu, the same category of thing as M2's
  Enter-to-restart convenience). A documented default loadout is pre-selected on scene entry so a
  human can start playing immediately without configuring anything, matching M1's hard-coded weapon
  pair and M2's hard-coded starting inventory placement.
- **`split` (cap 5) and "child projectile creates a parent effect" (cap 6) remain unreachable from
  gameplay this milestone**, recorded rather than forced. Concept's only named split mechanic is
  `split_return_core` (§29.4), a **boss skill core** (§11), which is explicitly M7
  (`docs/M2_ISSUES.md` §1 precedent: boss content stays deferred). None of this milestone's 8-10
  skills (§2.1) grant split-on-hit or child-projectile behavior — inventing one **not** drawn from
  either authoritative document, purely to exercise a cap, would be scope creep the caps themselves
  do not require (the cap's job is to bound a mechanic if one exists, not to justify inventing a
  mechanic). `combat/caps.ts`'s `canProjectileSplit`/`canChildCreateParentEffect` and their tests are
  unchanged from M1: they exist in shared code (satisfying "these limits must exist in shared combat
  code," concept §9.5) and are directly unit-tested as standalone functions, but — as with the bounce
  cap before this milestone — no weapon, skill, or pipeline stage calls them yet. This is the honest
  answer to "state for each cap whether live gameplay can now reach it" (§5 below), not a gap to
  hide.
- **`skill-effects.ts`'s caps clamp; `createSkillLoadout`'s slot-budget/id checks reject.** The
  general rule, stated once here and applied throughout: a **structural** invalidity — a slot budget
  that cannot be satisfied, a skill id that does not exist, the same id chosen twice — has no
  sensible "smaller" version to fall back to, so it is refused outright, matching M2's precedent for
  a full inventory or an already-occupied secure slot (refused, not thrown, not silently trimmed). A
  **magnitude** invalidity — three legally-selected skills whose bounce/pierce/stun/shield
  contributions sum past a ceiling — has an obvious, well-defined smaller version (the capped sum),
  so it is clamped, matching M2's `build-effects.ts` precedent exactly. Applying the reject rule to
  magnitude overflow would mean a legal three-skill loadout could suddenly stop working attack, which
  is worse for the player than a quietly-capped bonus and is not what either authoritative document
  asks for.

---

## Issues

Issues are written in the technical plan §28 task format, following `docs/M1_ISSUES.md`/
`docs/M2_ISSUES.md`'s numbering convention. Land them roughly in order; several are independent once
skill content (M3.1) and the loadout/effect primitives (M3.2/M3.3) exist.

### M3.1 — Skill content: ten skill definitions

- **Goal:** Add `SkillDefinition` (`docs/CONTENT_AUTHORING.md` §4) and ten real skills spanning
  melee, ranged, and generic ("attack"-tagged) compatibility, matching concept §9.4's four example
  combinations.
- **Context:** `ricochet` matches concept §29.2's worked example exactly (`bounceCountAdd: 1`,
  `damageAfterBounceMultiplier: 0.8`, `maximumTotalBounces: 3`). The other nine are proposed and
  balance-deferred, like M1's weapon numbers and M2's loot numbers, but each is chosen so every one of
  M3's ten `SkillEffects` keys (§2.3) has at least one real skill that sets it — no key is added with
  no producer.
- **Requirements:**
  1. `SkillDefinition extends ContentDefinition` with `slotCost` (`1 | 2`), `requiresTags` (a
     non-empty list, matched against a weapon's `tags` with "any overlap" semantics — concept §9.3
     "declare compatibility through tags"), `effects: SkillEffects` (typed, §2.3), and
     `limits: Readonly<Record<string, number>>` (a skill's own documented ceiling — informational
     alongside the shared hard caps, which are the actual enforcement point, matching
     `docs/CONTENT_AUTHORING.md` §4's existing rule that a skill's `limits` never overrides the shared
     cap).
  2. Both `basicSword` and `basicBow` (`packages/game-content/src/weapons.ts`) gain a shared `attack`
     tag alongside their existing `melee`/`projectile` tag, so a skill that should apply to any weapon
     category (`bulwark_strike`) has a real tag to require, matching concept §9.3's own tag vocabulary
     (`Attack` is a listed suggested tag) rather than inventing a workaround.
  3. Ten skills, `ALL_SKILLS`: `multishot`, `ricochet`, `piercing_rounds`, `returning_shot` (the one
     2-slot rare skill, §1), `homing_arrows` (all `projectile`-tagged); `extended_reach`,
     `swift_strikes`, `stunning_blows`, `wide_arc` (all `melee`-tagged); `bulwark_strike`
     (`attack`-tagged, applies to either category).
  4. Unit tests assert shape invariants (unique ids; `slotCost` is `1` or `2`; `requiresTags` is
     non-empty; every `effects` key present is one `skill-effects.ts` recognizes — the skill
     counterpart of `loot.test.ts`'s existing check) and that exactly one skill has `slotCost: 2`.
- **Non-goals:** split-on-hit/child-projectile skills, boss-exclusive skills (§1); armor-modifying
  skills (no armor system exists yet, concept §8.2 is unimplemented).
- **Acceptance:** definitions typecheck, are covered by tests, and are not yet wired into any engine
  code.

### M3.2 — Permanent skill loadout: three pre-run slots, validated

- **Goal:** A pure, validated selection of up to three permanent skills from `ALL_SKILLS`, chosen
  before a run starts.
- **Context:** Concept §8.3: three permanent slots, same count for every player, selected before the
  match, no in-run change. §1 above records the reject-not-clamp rule this issue implements.
- **Requirements:**
  1. `MAX_SKILL_SLOTS = 3`; `SkillLoadout` (a readonly `SkillDefinition[]`, length 0-3 — a loadout is
     not required to fill every slot, matching how a 2-slot skill can leave one slot unused).
  2. `createSkillLoadout(skillIds, availableSkills = ALL_SKILLS)` returns a discriminated
     `{ ok: true, loadout }` or `{ ok: false, reason }` (`"unknown_skill" | "duplicate_skill" |
     "slot_budget_exceeded"`) — refused, never clamped (§1).
  3. Unit tests: three 1-slot skills is accepted; the one 2-slot skill plus one 1-slot skill (3 total)
     is accepted; the 2-slot skill plus two 1-slot skills (4 total) is rejected with
     `"slot_budget_exceeded"`; an unknown id is rejected with `"unknown_skill"`; the same id listed
     twice is rejected with `"duplicate_skill"`; an empty selection is accepted (a loadout is not
     forced to fill every slot).
- **Non-goals:** persistence of a chosen loadout across page loads (§1, D27-style); an
  account/lobby-backed picker (§1).
- **Acceptance:** the exit criterion "invalid combinations are rejected" is directly tested at the
  loadout-selection boundary.

### M3.3 — Skill effect aggregation and caps (fills pipeline stage 4)

- **Goal:** Aggregate the player's active skills (permanent loadout plus wildcard, tag-filtered
  against the weapon in use) into a capped `SkillEffects`-shaped value and apply it to the attack —
  making `combat/pipeline.ts`'s `applyEquippedSkills` a real stage instead of a pass-through.
- **Context:** Concept §9.1-§9.3; technical plan §13.1 lists "apply equipped skills" immediately
  before "apply carried-loot modifiers" (M2's already-real stage 5) — this issue fills the stage
  directly ahead of it, in the same order. Ten recognized effect keys, one per M3.1 skill (§2.3):
  `projectileCountAdd`, `bounceCountAdd`, `pierceCountAdd`, `returnEnabled`, `homingStrengthAdd`,
  `damageAfterBounceMultiplier`, `rangeMultiplierAdd`, `arcDegreesAdd`, `recoveryReductionAdd`,
  `stunChanceAdd`, `shieldOnHitAdd` (eleven fields; `ricochet` alone declares two).
  Tag-gating happens **per attack**, not at loadout-selection time (§1's third bullet was about
  slot budget, not tags): a `projectile`-tagged skill sums into the ranged aggregation and is simply
  excluded from the melee one, so selecting it while also carrying a melee weapon is legal but inert
  for melee swings — the same "declare compatibility through tags" concept §9.3 describes, not a
  selection-time rejection.
- **Requirements:**
  1. `aggregateSkillEffects(equippedSkills, weaponTags)` sums each recognized key across every
     equipped skill whose `requiresTags` intersects `weaponTags`, then clamps each sum to a fixed
     ceiling in shared code (anti-snowball, concept §30.2/§31 extended from loot to skills) —
     independent of and in addition to the three-slot budget and the §13.4 caps that separately bound
     bounce/pierce/return/search-radius downstream. `damageAfterBounceMultiplier` aggregates as a
     product (each contributing skill's multiplier is a further reduction), floored so damage can
     never reach zero.
  2. `combat/pipeline.ts`'s `applyEquippedSkills` applies the weapon-shape effects
     (`rangeMultiplierAdd`, `arcDegreesAdd`, `recoveryReductionAdd` for melee; `projectileCountAdd` for
     ranged; `stunChanceAdd` added to the weapon's base `stunChance`, clamped to `[0, 1]`) to an
     effective `WeaponDefinition` copy — the underlying content definition is never mutated, matching
     M2's `applyBuildEffectsToWeapon` precedent — and carries the full aggregated `SkillEffects`
     forward on the `AttackDefinition` for `combat/ranged.ts` (bounce/pierce/return/homing are
     per-projectile runtime state, not weapon fields) and for `simulation.ts` (shield-on-hit is a
     player-level effect, not a weapon or per-target one).
  3. `prepareAttack` (and `startMeleeAttack`/`startRangedAttack`) take the aggregated `SkillEffects`
     alongside M2's `BuildEffects`, defaulting to `NO_SKILL_EFFECTS` for a caller with no equipped
     skills.
  4. Unit tests: a `bounceCountAdd` skill measurably grants bounces through `startRangedAttack`; an
     `arcDegreesAdd`/`rangeMultiplierAdd` skill measurably widens/lengthens a melee swing through
     `startMeleeAttack`; stacking (permanent loadout skill + an identical wildcard skill) a
     recognized key past its cap does not exceed the ceiling; a skill whose `requiresTags` does not
     match the weapon in use contributes nothing to that weapon's aggregation.
- **Non-goals:** loot's `BuildEffects` (M2, unchanged, stays a separate stage); armor effects (no
  armor system).
- **Acceptance:** the exit criterion "supported combinations work" is directly tested through the real
  pipeline, and caps hold under stacking (feeding the "no recursive effect explosion" criterion,
  completed in M3.6).

### M3.4 — Ranged skill behavior: bounce, pierce, return, and homing

- **Goal:** Give `combat/ranged.ts`'s `stepProjectiles` real bounce, pierce, return, and homing
  behavior, driven per-projectile by the aggregated `SkillEffects` at spawn time (M3.3) — the base
  weapon still fires a plain straight-line projectile (concept §29.2) when no skill grants otherwise.
- **Context:** `docs/M1_ISSUES.md` recorded that the §13.4 bounce cap (and, by the same reasoning,
  pierce/return/search-radius) had no reachable code path — "that is M3's `ricochet` skill." This
  issue is that mechanic landing. Each behavior reuses an existing shared primitive rather than adding
  a parallel system: bounce reuses the same per-axis swept wall resolution the player already uses
  (`collision.ts`'s `resolveAxisMovement`, applied per-axis to the projectile exactly as it already is
  to the player, so a projectile's bounce off a horizontal vs. vertical wall face falls out of the
  same two-axis resolution the player's diagonal movement already relies on); homing reuses
  `caps.ts`'s `clampSearchRadius`.
- **Requirements:**
  1. `Projectile` (`world.ts`) gains runtime fields seeded once at spawn from the aggregated
     `SkillEffects`, clamped by `combat/caps.ts` against both the weapon's own `limits` and the shared
     hard caps exactly like M1's projectile-count clamping already does: `bouncesRemaining`
     (`clampBounceCount`), `piercesRemaining` (`clampPierceCount`), `returnsRemaining` (`0` or `1` via
     `canProjectileReturn`), `homingStrength` (clamped to a new, bounded `MAX_HOMING_STRENGTH`),
     `postBounceDamageMultiplier`, and `hitTargetIds` (so a piercing projectile cannot hit the same
     target twice while still overlapping it).
  2. `stepProjectiles` resolves each projectile's per-step movement **per axis** (mirroring
     `resolveAxisMovement`'s two-call pattern for the player): an axis blocked by a wall consumes one
     `bouncesRemaining` and reflects that axis's velocity component (applying
     `postBounceDamageMultiplier` to the projectile's damage) if any remain, or removes the projectile
     exactly as M1 already does (no bounce) if none remain.
  3. On hitting a target: if `piercesRemaining > 0`, apply damage, decrement it, and add the target's
     id to `hitTargetIds` (continuing rather than being consumed); otherwise consumed on hit, unchanged
     from M1.
  4. On lifespan expiry: if `returnsRemaining > 0`, reverse the projectile's velocity, decrement
     `returnsRemaining` to `0`, and refill its lifespan once (a genuine "returns" flight, not an
     instant despawn-and-respawn); a projectile that has already returned expires normally on its
     second expiry (cap 4 held structurally — `returnsRemaining` cannot go negative).
  5. Before movement each step, if `homingStrength > 0`, find the nearest live target within
     `clampSearchRadius(HOMING_SEARCH_RADIUS_PX)` (excluding ids in `hitTargetIds`) and steer the
     projectile's velocity direction toward it by `homingStrength`, preserving speed.
  6. Unit tests: a projectile with `bouncesRemaining` reflects off a wall instead of being removed,
     and is removed once bounces are exhausted; a piercing projectile damages two targets in sequence
     without being consumed after the first, and does not hit the same target twice; a projectile
     with `returnsRemaining: 1` reverses direction on lifespan expiry instead of being removed, and
     is removed on its second expiry; a homing projectile's trajectory bends toward a target placed
     off its initial straight-line path, and does not steer toward a target beyond
     `MAX_TARGET_SEARCH_RADIUS_PX`.
- **Non-goals:** split-on-hit (§1); a bounce that reflects off an arbitrary wall angle (walls are
  AABBs; per-axis reflection is the correct and sufficient model, matching the player's own movement
  resolution).
- **Acceptance:** caps 2 (bounces), 3 (pierces), 4 (returns), and 8 (search radius) are each driven by
  a real skill through the real pipeline, tested end to end, and continue to hold.

### M3.5 — Melee skill behavior: stun and player shield

- **Goal:** Give melee skills two effects that don't fit the weapon-shape mutation in M3.3: a
  chance-based stun applied to a hit enemy, and a flat shield granted to the player on a landed hit
  (either weapon category, via `bulwark_strike`'s `attack` tag).
- **Context:** Concept §9.2 lists "stun chance," "stun duration," and "shield generation" as core
  effect primitives. Stun needs a random roll — the seeded `world.rng` (technical plan §9.4), never
  `Math.random` — and a duration to hold, so it is engine state on the target (`Enemy.stunnedMs`), not
  a pipeline-stage weapon mutation. Shield is player-level, not per-target, so it is granted in
  `simulation.ts` after hit resolution, not inside `combat/melee.ts` or `combat/ranged.ts`.
- **Requirements:**
  1. `Enemy` (`world.ts`) gains `stunnedMs: number` (`0` at spawn). `enemy.ts`'s `stepEnemyMovement`
     skips the chaser's move-toward-player step while `stunnedMs > 0` (still decrementing it every
     step regardless); contact damage is unaffected by stun (a stunned enemy the player walks into
     still deals contact damage — a deliberate, minimal scope choice recorded here, not an oversight:
     stun disables aggression, not hurtbox/hitbox presence).
  2. `combat/melee.ts`'s `resolveMeleeHits` takes the seeded `rng` and, for each hit, rolls against
     the swing's effective `stunChance` (already the skill-adjusted value from M3.3's stage-4
     mutation); returns the hit target ids that rolled a stun alongside the existing `updatedTargets`/
     `hitEvents`. `simulation.ts` sets `stunnedMs` to a fixed `STUN_DURATION_MS` for matching enemies
     when merging combat-resolved health back into `world.enemies` (the same step M1.9 already merges
     health).
  3. `Player` (`world.ts`) gains `shieldHp: number` (`0` at spawn, capped by a new `MAX_SHIELD_HP` in
     `skill-effects.ts`). A new `applyDamageToPlayer(player, damage)` helper drains `shieldHp` before
     `health` (mirroring `combat/pipeline.ts`'s `applyDamageAmount`, but shield-aware); `simulation.ts`
     uses it for the chaser's contact damage.
  4. `simulation.ts` grants `shieldOnHitAdd` (clamped per-hit) to `player.shieldHp` once per hit event
     produced by the player's own melee or ranged attacks this step, capped at `MAX_SHIELD_HP`.
  5. Unit tests: a `stunChanceAdd` skill with `rng` forced to always-succeed stuns the hit enemy for
     `STUN_DURATION_MS`, and a stunned enemy does not move toward the player until it elapses; a
     `shieldOnHitAdd` skill grants shield on a landed hit, capped under repeated hits; shield absorbs
     contact damage before health, and health absorbs the remainder once shield is exhausted.
- **Non-goals:** shield decay over time (concept §9.2 does not specify one; not invented here); stun
  affecting contact damage (§ above).
- **Acceptance:** "supported combinations work" is demonstrated for the two effects that are not
  simple weapon-stat mutations.

### M3.6 — Hard caps under real combination load (recursive-explosion tests)

- **Goal:** Prove, with tests that exercise the real pipeline (not a synthetic fixture, per this
  task's explicit instruction), that every reachable §13.4 cap holds under the worst legal
  combination of skills, carried loot (M2), and weapon — and record, for the two unreachable caps
  (§1), why they remain so.
- **Context:** This is the M3 exit criterion "no recursive effect explosion" made concrete. Two
  independent capped pipelines (skills, loot) now feed the same weapon and the same projectile
  runtime state; this issue is the test coverage proving the combination of both, plus a full loadout
  and full inventory, cannot escape any cap.
- **Requirements:**
  1. A worst-legal-ranged-combination test: the three ranged skills that most stress projectile state
     at once within the 3-slot budget (e.g. `ricochet` + `piercing_rounds` + `homing_arrows`, all
     1-slot) equipped together, firing `basic_bow` repeatedly for many simulated steps with a full
     six-slot inventory of loot that grants `attackSpeedBonus`/`projectileSpeedAdd`/`damageAdd` (M2)
     also equipped: bounces never exceed `MAX_BOUNCES`, pierces never exceed `MAX_PIERCES`, the
     player's active projectile count never exceeds `MAX_ACTIVE_PROJECTILES_PER_PLAYER`, and homing
     never searches beyond `MAX_TARGET_SEARCH_RADIUS_PX`.
  2. A worst-legal-melee-combination test: `extended_reach` + `swift_strikes` + `stunning_blows` (or
     `wide_arc`) equipped together with the same full loot inventory: effective range/arc/recovery
     stay within `skill-effects.ts`'s ceilings and stun chance never exceeds its cap, over many
     simulated steps of continuous attacking.
  3. A `returning_shot` (2-slot) + one 1-slot ranged skill test, since it is the only combination that
     uses the full 3-slot budget with the rare skill: a projectile returns at most once even when
     every other stacked effect (bounce/pierce/homing, if the paired skill grants one) is also active
     on the same projectile.
  4. A test asserting `stepSimulation` completes every step without throwing and without projectile
     or enemy collections growing unboundedly (a concrete proxy for "the simulation does not
     degrade") across several hundred steps of the worst-legal-ranged-combination scenario with
     continuous fire.
  5. For the two unreachable caps (split, child-parent-effect), the existing M1 standalone-function
     tests in `combat/caps.test.ts` are kept (they are still meaningful: the functions are correct in
     isolation) and this document's §1/§5 stand as the recorded "not reachable this milestone, and
     why" — no fixture is invented to fake reachability.
- **Non-goals:** load/perf testing (M8/M9, `docs/TEST_PLAN.md` §2.4); a real split mechanic (§1).
- **Acceptance:** the exit criterion "no recursive effect explosion" is directly tested for every
  reachable cap under real, legally-constructed combination pressure.

### M3.7 — Wildcard skill chip

- **Goal:** A `SkillChip` ground entity, scattered on the local test map at run start (§1), that sets
  or replaces the player's temporary wildcard skill on pickup, is included in the active-skill
  aggregation (M3.3) alongside the permanent loadout, and is lost on death.
- **Context:** Concept §10: begins empty, one skill at a time, a new chip may replace the current one,
  lost on death, does not become permanent this milestone (no boss cores/unlocks exist, M7/M5).
- **Requirements:**
  1. `SkillChip` (`world.ts`): id, the `SkillDefinition` it grants, position, pickup radius — the
     skill counterpart of M2's `GroundLoot`. `Player.wildcardSkill: SkillDefinition | null` (`null` at
     spawn).
  2. `chooseSkillChipDrop(rng)` picks from `ALL_SKILLS` via the seeded RNG (no `Math.random`,
     matching every other M1/M2 selection); `spawnSkillChip`/`isNearSkillChip` mirror `loot-drop.ts`'s
     shape.
  3. While `interactPressed` is true and the player overlaps a `SkillChip`'s pickup radius,
     `player.wildcardSkill` is set to the chip's skill and the chip is removed — always succeeds,
     unlike loot pickup (§1: "a new chip may replace the current one," no refusal case).
  4. `simulation.ts`'s per-step skill aggregation (M3.3) includes `wildcardSkill` (when non-null)
     alongside the permanent loadout.
  5. On death (existing M2.8 run-ending branch), `wildcardSkill` is set to `null` alongside clearing
     the inventory and secure slot (concept §10: "drops or disappears on death"). On a successful
     extraction, it is also cleared (nothing persists past a run yet — M5/M7).
  6. Unit tests: picking up a chip sets the wildcard skill; picking up a second chip replaces the
     first without refusal; the wildcard skill's effects are included in `aggregateSkillEffects`
     alongside the permanent loadout; death clears the wildcard skill; the seeded chip-drop choice is
     reproducible for a fixed seed.
- **Non-goals:** boss skill cores (§1, M7); a wildcard chip dropped by the chaser (concept only
  describes the wildcard as "found," and M2's precedent already uses the chaser's single kill-drop
  slot for ordinary loot; a second concurrent drop system from the same kill is not requested).
- **Acceptance:** the wildcard slot is real, playable, and its effects are demonstrably part of the
  same aggregation permanent skills go through.

### M3.8 — Client wiring: pre-run loadout picker, HUD, and rendering

- **Goal:** Make M3.1-M3.7 playable and visible: a pre-run local skill picker, a HUD summary of the
  active loadout/wildcard/shield, and rendering for skill chips and the new projectile behaviors.
- **Requirements:**
  1. A new `LoadoutScene` (§1), shown before `PlayScene`: lists `ALL_SKILLS` with a documented default
     selection pre-checked; number keys toggle inclusion, live-validated against
     `createSkillLoadout` (a rejected toggle — e.g. exceeding the 3-slot budget — is visibly refused,
     not silently ignored); Enter starts a run with the confirmed loadout, passed to `PlayScene` as
     Phaser scene data (no persistence, §1).
  2. `PlayScene` reads the incoming loadout (falling back to the same documented default if the scene
     was entered without one — e.g. a future direct-launch path), adds `SKILL_CHIP_SPAWN_POINTS`
     (geometry-only, exactly like `GROUND_LOOT_SPAWN_POINTS`), and passes both into
     `createSimulation`.
  3. The inventory HUD panel (or a small addition beside it) shows the three permanent skill slots,
     the wildcard slot, and the player's current shield value.
  4. `WorldView` renders skill chips (visually distinct from ground loot) and a shield indicator on
     the player when `shieldHp > 0`.
  5. No game rule is computed in client code — the new scene only calls `createSkillLoadout` (a pure
     validation function, not a rule about combat/loot/extraction) and reads `World` for rendering,
     matching M1/M2's invariant.
- **Non-goals:** drag-and-drop skill reordering; any persistence of the chosen loadout across a reload
  (§1).
- **Acceptance:** a human can open the loadout picker, assemble a legal three-slot loadout (including
  the one 2-slot rare skill), see an illegal one refused, start a run, find and pick up a skill chip
  mid-run, watch its effect apply, stun an enemy, gain shield, bounce/pierce/return a shot, and see
  the wildcard disappear on death — all without a server running.

---

## Definition of done for M3

- Every issue above is complete and its tests pass.
- All gates pass: `pnpm format:check`, `pnpm lint`, `pnpm typecheck`, `pnpm test`,
  `pnpm test:integration`, and `pnpm build`.
- The three technical plan §38 M3 exit criteria hold and are each covered by a test: supported
  combinations work (M3.3-M3.5); invalid combinations are rejected (M3.2); no recursive effect
  explosion (M3.6).
- Every one of the eight §13.4 caps has a recorded, honest reachability status (six reachable from
  real gameplay this milestone; two — split, child-parent-effect — recorded as not reachable, and why,
  per §1).
- No out-of-scope system was added: no boss cores, no networking, no accounts/persistence, no
  weapon/armor blueprints, no new enemy type, no split-on-hit mechanic, no lobby/account-backed
  picker (§1).
- Documentation updated where behavior or structure changed: `docs/CONTENT_AUTHORING.md` §4 (skill
  shape moves from forward-looking free-form sketch to shipped, typed shape) and `docs/DECISIONS.md`
  (new entries for the two-slot rare skill, the wildcard chip's M3 source, and the local, non-persistent
  loadout picker).
- A human has playtested the full loop locally (technical plan §45): pick a legal three-slot loadout,
  try an illegal one and see it refused, start a run, use skill effects in combat (bounce/pierce/
  return/homing on the bow, reach/recovery/stun on the sword, shield from `bulwark_strike`), find and
  swap the wildcard skill, and see it lost on death.
