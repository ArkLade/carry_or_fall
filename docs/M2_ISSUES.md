# M2 Issue List — Loot and Extraction

Status: **Planned** (implementation follows in the same change set as this document). The bounded
task list for milestone **M2**, per the technical plan §38 (M2) and the repository's
per-milestone-issue-list practice established at M1. M2 is implemented **after** M1 (tagged
`v0.1.0-local-combat`); the M1 tail defects (D-1, D-2) and the enemy contact-damage-interval content
move are cleared first (see `docs/M1_ISSUES.md`) and are not repeated here.

## Scope

**Deliver (technical plan §38 M2):** loot drops, a six-slot inventory, the five point categories,
the secure slot, rotating extraction, and the local run result.

**Exit criteria (technical plan §38 M2):**

- Loot changes build.
- Securing removes active effect.
- Death and extraction differ correctly.

**Explicitly out of M2** (later milestones or never, per the authoritative documents): skills and
the wildcard slot (M3); Colyseus rooms/networking, other players, PvP (M4); accounts, Supabase,
persistence (M5); parties/matchmaking (M6); the boss and boss skill cores (M7); deployment (M8+);
mobile controls; client prediction. Also out of scope, decided in this document (see §1 below):
weapon/armor blueprints and their permanent unlocks, ground-weapon swapping and temporary
equipment, and any new enemy type — none of these are in the technical plan's M2 deliverable list,
and blueprints/unlocks require the account storage that does not exist until M5.

## Architectural constraints (apply to every issue)

- **Loot, points, inventory, the secure slot, and extraction are shared, deterministic simulation
  state in `packages/simulation-core`**, consumed by the client — the same seam M1 established
  (concept §38 guidance; technical plan §9.3 fixed step, §13.1 shared pipeline). The client keeps
  deciding no outcomes; it renders state and reports intent (interact, discard, secure) exactly as
  it reports movement/attack intent.
- **Loot is data** in `@carry-or-fall/game-content` (`LootDefinition`, `docs/CONTENT_AUTHORING.md`
  §5), not hard-coded into the engine — matching how weapons and the chaser were shipped in M1.
- **Loot power stays capped in shared code** (`packages/simulation-core`), never only bounded by
  data or by the six-slot limit alone (concept §30.2 "loot power should... remain capped", §31
  anti-snowball; `docs/DEVELOPMENT_RULES.md`, "Preserve projectile and effect safety caps" — the
  same philosophy extended from combat caps to carried-loot build effects).
- **The carried-loot pipeline stage becomes real.** `combat/pipeline.ts`'s
  `applyCarriedLootModifiers`, a pass-through since M1, now applies the player's aggregated
  build effects to the weapon actually used for that attack (technical plan §13.1's designed stage
  5, filled in as planned in `docs/M1_EXECUTION_PLAN.md` §2.4).
- **No persistent stash; no accounts.** Ordinary extracted loot converts automatically into the
  five point categories and is never stored as an individual object after the run
  (`docs/DEVELOPMENT_RULES.md`, "No persistent ordinary-item stash"; concept §7.4). The run result
  is local and ephemeral; nothing survives a page reload (see `docs/DECISIONS.md` D27).
- **Secure-slot scope is explicit.** The secure slot's within-run behavior (no drop on death,
  uniform conversion on death or extraction) is real and tested; its "permanent progress" half is
  out of reach until M5 persistence exists — recorded, not implied (`docs/DECISIONS.md` D27).
- **Strict TypeScript, no unchecked inputs.** Same fixed simulation step; the same one
  client→simulation seam M1 established, extended with new one-shot intents
  (`interactPressed`, a discard slot index, a secure slot index), not a second call site.
- Each issue must pass the standard gates (`pnpm format:check`, `pnpm lint`, `pnpm typecheck`,
  `pnpm test`, `pnpm test:integration`, `pnpm build`) and add tests for any meaningful rule it
  introduces (`docs/TEST_PLAN.md`).

### §1. Scope decisions (recorded here, not improvised silently)

- **Weapon/armor blueprints, boss skill cores, and their permanent unlocks are out of M2.** Concept
  §4.3/§7.3 describes rare loot permanently unlocking weapons/armor/skills through the account.
  There is no account (M5, D9/D16), so nothing exists yet to hold a permanent unlock. M2's loot is
  therefore **point-value items only** (`LootDefinition.points` plus an optional, small
  `buildEffects` bonus) — no `blueprint`/`boss_core` item subtype is added. This matches the
  technical plan §38 M2 list, which names "five point categories," not blueprints.
- **No ground-weapon swap / temporary equipment.** `docs/PROTOCOL.md` lists a forward-looking
  `equip_ground_weapon` message, but the technical plan's M2 deliverable list does not include
  weapon pickup, and it is not one of the six items the task asked M2 to deliver. Left as a
  documented non-goal, matching `docs/DEVELOPMENT_RULES.md`'s "no unrequested systems."
- **No new enemy type or enemy respawning.** M2 owns loot/inventory/extraction, not PvE content;
  the one M1 chaser is the only loot source from a kill. To make the six-slot inventory and secure
  slot actually exercisable in a single short local run (there is no wave/respawn system to refill
  loot after the one chaser is dead), the local test map also scatters a handful of static ground
  loot pickups at run start — geometry-only placement in `PlayScene`, exactly like M1's hard-coded
  `ENEMY_SPAWN_POINTS`, not a new content or spawning system.
- **Client secure/discard controls are a deliberate, documented local scheme**, not literally
  specified by concept §13.1 (which lists `E: interact or extract` and `Tab or I: inventory` but no
  discard/secure binding). This document fixes: digit keys `1`-`6` discard that inventory slot;
  `Shift`+digit secures that slot (refused if the secure slot is already occupied). The two-key
  chord stands in for concept §7.2/§1363's "require clear confirmation" — an accidental single
  keypress cannot secure an item — and the HUD echoes the result. This is a local-only convenience
  like M1's `secondaryAttackPressed`, not a documented control.

---

## Issues

Issues are written in the technical plan §28 task format, following `docs/M1_ISSUES.md`'s
numbering convention. Land them roughly in order; several are independent once loot content
(M2.1) and the inventory/points primitives (M2.2/M2.3) exist.

### M2.1 — Loot content: five loot definitions

- **Goal:** Add `LootDefinition` (`docs/CONTENT_AUTHORING.md` §5) and a small set of real loot
  items spanning `common`/`uncommon`/`rare` rarity and all five point categories.
- **Context:** Fixed, non-random point values only (concept §6.6); no item-quality randomness, no
  procedural affixes. Values are proposed and balance-deferred, like M1's weapon/enemy numbers.
- **Requirements:**
  1. `LootDefinition extends ContentDefinition` with `rarity`, `points` (five categories), and an
     optional `buildEffects` of only the keys the engine actually aggregates (§M2.4) — not a
     free-form bag, so a mistyped key cannot silently do nothing.
  2. At least one item per category as its dominant point value; at least one `rare` item with a
     meaningfully higher point total (secure-slot bait).
  3. Unit tests assert shape invariants (positive point values are non-negative integers; every
     `buildEffects` key present is one the engine recognizes).
- **Non-goals:** blueprints, boss cores, `boss` rarity (§1).
- **Acceptance:** definitions typecheck, are covered by tests, and are not yet wired into any
  engine code.

### M2.2 — Six-slot inventory primitives

- **Goal:** A fixed six-slot inventory as pure simulation-core state and functions: add, discard,
  rearrange (move).
- **Context:** Concept §7.1: six slots, contribute to the build, can be rearranged, discarded,
  replaced; visible in a simple UI; drop on death; convert on extraction.
- **Requirements:**
  1. `Inventory` is a fixed-length-6 array of `LootDefinition | null`; `createEmptyInventory()`.
  2. `addItemToInventory` fills the first empty slot and reports whether it succeeded (refused,
     not thrown, when full — technical plan/concept §32 "full inventory pickup").
  3. `discardInventorySlot` and `moveInventoryItem` (swap two slots) are pure functions.
  4. Unit tests cover: fills first empty slot; refuses when full without losing/crashing; discard
     empties a slot; move swaps two slots including a slot that is empty.
- **Non-goals:** any client UI for rearranging (§1); secure-slot interaction (M2.5).
- **Acceptance:** inventory functions are pure, tested, and not yet reachable from `stepSimulation`.

### M2.3 — Five point categories and point conversion

- **Goal:** The `force`/`precision`/`motion`/`guard`/`signal` point totals (concept §6) and the
  pure conversion of a loot item (or a full inventory) into a point delta.
- **Requirements:**
  1. A `PointTotals` record of the five categories; a zero constant; an `addPointTotals` combining
     function.
  2. `pointsFromLoot` reads one item's fixed `points`; a helper sums an inventory's items.
  3. Unit tests assert the sum is exact for a known set of items (not a constant-equals-itself
     check) and that an empty inventory contributes zero.
- **Non-goals:** persistence of any kind (D27); UI (M2.9).
- **Acceptance:** conversion is pure, deterministic, and tested.

### M2.4 — Carried-loot build effects (fills pipeline stage 5)

- **Goal:** Aggregate the carried inventory's `buildEffects` into a capped `BuildEffects` value and
  apply it to the weapon actually used for an attack, to player movement speed, and to player max
  health — making `combat/pipeline.ts`'s `applyCarriedLootModifiers` a real stage (as planned in
  `docs/M1_EXECUTION_PLAN.md` §2.4) instead of a pass-through.
- **Context:** Concept §27.2 "carried loot modifies combat"; §30.2/§31 loot power must remain
  capped and avoid snowballing. Five recognized effect keys, chosen because each has a real,
  already-existing consumer in the M1 engine (no effect key is added with no mechanic to read it —
  `docs/DEVELOPMENT_RULES.md`, "no unrequested systems"): `damageAdd`, `attackSpeedBonus`,
  `projectileSpeedAdd`, `moveSpeedBonus`, `maxHealthAdd`. `signal`-category loot may carry points
  with no `buildEffects` at all — signal's active mechanics (homing, detection) are M3/M2-adjacent
  systems this milestone does not implement, and a loot item is not required to declare an effect.
- **Requirements:**
  1. `aggregateBuildEffects(inventory)` sums each recognized key across non-empty slots (the secure
     slot is never included — it "stops contributing to the current build", concept §7.2) and
     clamps each sum to a fixed ceiling in shared code (anti-snowball cap, never only bounded by
     the six-slot limit).
  2. `applyBuildEffectsToWeapon` returns an effective `WeaponDefinition` copy (damage and, for
     ranged weapons, projectile speed adjusted; attack interval shortened by the attack-speed
     bonus) — the underlying content definition is never mutated.
  3. `effectiveMoveSpeed`/`effectiveMaxHealth` apply the remaining two effects to the player.
  4. `combat/pipeline.ts`'s `prepareAttack` (and `startMeleeAttack`/`startRangedAttack`) take the
     current `BuildEffects` and use the effective weapon for cooldown-setting too, so a real
     attack-speed bonus actually shortens the next cooldown, not just the displayed number.
  5. Unit tests: a `damageAdd` item increases actual damage dealt through the pipeline; an
     `attackSpeedBonus` item shortens the cooldown set after an attack; stacking multiple items
     past the cap does not exceed it; moving the item to the secure slot removes its effect (ties
     directly to the M2 exit criterion "securing removes active effect").
- **Non-goals:** skill effects (M3, a separate pipeline stage); `signal` mechanics.
- **Acceptance:** carried loot measurably changes combat math and movement; caps hold under
  stacking; tests assert the rule, not a restated constant.

### M2.5 — Secure slot

- **Goal:** One secure slot per player; moving an item into it removes it from the active build and
  makes it survive death, converting identically to points on death or extraction.
- **Context:** Concept §7.2: stops contributing to the build, cannot be removed during the run in
  this version, cannot be looted (no other players exist locally to loot it anyway), survives
  death, converts on death or extraction. `docs/DECISIONS.md` D27 records the local-only scope of
  "survives"/"converts to permanent progress."
- **Requirements:**
  1. `secureItem(inventory, slotIndex, secureSlot)` moves the item out of the inventory slot into
     the secure slot, refusing (not throwing) if the secure slot already holds an item (§32 "full
     secure slot").
  2. Once placed, no function removes an item from the secure slot during a run (irreversibility is
     structural: no "unsecure" function exists, matching concept §7.2's "cannot be removed").
  3. `aggregateBuildEffects` (M2.4) never reads the secure slot.
  4. On run end (M2.8), the secure slot's points are added regardless of outcome; it is never
     dropped as ground loot on death.
  5. Unit tests: securing empties the source inventory slot and fills the secure slot; a second
     secure attempt while occupied is refused and the original item is unchanged; a secured item's
     `buildEffects` no longer apply (cross-checked with M2.4's test).
- **Non-goals:** a second secure slot (concept §7.2 explicitly defers this); persistence (D27).
- **Acceptance:** the exit criterion "securing removes active effect" is directly tested and true.

### M2.6 — Loot drops: enemy death and scattered ground pickups

- **Goal:** Ground-loot entities appear in the world — one deterministically chosen from the loot
  table when the chaser dies, plus a handful scattered on the local test map at run start — and can
  be picked up into the inventory.
- **Context:** Concept §4.2 "collects loot items"; §14.2 enemies drop loot. `interactPressed`
  already exists in `packages/protocol`'s `InputMessage` (added, unused, in M1) and in
  `simulation-core`'s local `InputState` is added the same way `secondaryAttackPressed` was in M1.
- **Requirements:**
  1. A `GroundLoot` world entity: id, the `LootDefinition` it will become, position, pickup radius.
  2. On a chaser's death (existing `stepSimulation` health-zero removal), spawn one `GroundLoot`
     at its death position, chosen via the existing seeded `createRng` from a fixed loot table (no
     `Math.random`, matching the M1 determinism invariant).
  3. While `interactPressed` is true and the player overlaps a `GroundLoot`'s pickup radius,
     attempt `addItemToInventory`; on success remove the ground entity, on failure (inventory full)
     leave it in place — no crash, no loss (§32).
  4. Unit tests: a killed chaser spawns exactly one ground-loot entity; pickup succeeds and removes
     the ground entity when there is space; pickup is refused and the ground entity remains when
     the inventory is full; the seeded choice of which item drops is reproducible for a fixed seed.
- **Non-goals:** new enemy types, loot rarity weighting/drop tables beyond a flat choice, other
  players looting a body (no other players exist locally).
- **Acceptance:** loot enters the world from a kill and from map placement, and can be picked up;
  determinism holds under a fixed seed.

### M2.7 — Rotating extraction

- **Goal:** Two active extraction points that each stay active for a bounded duration, then relocate
  ("rotate") to a new candidate location; a player channels extraction by holding interact while
  standing in one's radius; taking damage or leaving the radius interrupts the channel; completing
  it ends the run successfully.
- **Context:** Concept §17.1: two active extraction points, 45-90s active duration, 4-6s channel,
  taking damage interrupts, success ends the run for that player. Single-player and local, so
  "notify nearby players" (§17.2) has no audience yet and is not implemented (nothing to notify).
- **Requirements:**
  1. An `ExtractionPoint` (stable id, position, radius, remaining-active-ms) — two live at a time,
     chosen from candidate points via the seeded RNG at `createSimulation`, matching the enemy
     spawn-point pattern.
  2. Each fixed step, each point's remaining-active-ms counts down; at zero it relocates to a new
     candidate position via RNG and its timer resets — "disappears...reopens elsewhere" modeled as
     one stable id whose position changes, not a separate open/closed state.
  3. While `interactPressed` is true and the player is within an active point's radius, channel
     progress accumulates toward a fixed channel duration; it resets to zero the instant
     `interactPressed` is false, the player leaves every point's radius, or the player takes
     contact damage this step (already computed in `stepSimulation`'s chaser contact-damage block).
     A point relocating out from under an in-progress channel is not special-cased: the player is
     no longer within the (new) position's radius next step, which the ordinary rule already
     resets on its own.
  4. Reaching the channel duration ends the run with outcome `"extracted"` (M2.8).
  5. Unit tests: a point's position changes only after its active duration elapses and never
     before; channel progress accumulates only while both conditions hold; taking damage resets
     progress to zero; reaching the duration produces the extracted outcome; determinism holds
     under a fixed seed.
- **Non-goals:** future extractor types with point-category bonuses (concept §17.3, explicitly "not
  required for the first playable version"); visibility/greed scaling (concept §18, explicitly
  deferred until after the basic loop is proven).
- **Acceptance:** the exit criterion "death and extraction differ correctly" has a real extraction
  path to differ from, tested end to end from channel start to run-ending outcome.

### M2.8 — Run ending and the local run result

- **Goal:** Death and successful extraction both end the local run, but convert loot differently,
  and both produce a `RunResult` the client can display.
- **Context:** Concept §4.3 (on extraction: inventory converts, secure slot converts, run ends) vs.
  §4.4 (on death: inventory drops on the ground, secure slot still converts, run ends). This is the
  M2 exit criterion "death and extraction differ correctly," made concrete.
- **Requirements:**
  1. `RunResult`: `outcome` (`"extracted" | "died"`), the resulting `PointTotals` delta, and counts
     of items converted vs. lost, for the HUD to render.
  2. On death: the secure slot's points convert; every non-empty inventory slot is dropped as a
     `GroundLoot` at the player's death position (concept "all normal inventory loot drops on the
     ground") and contributes zero points; the inventory and secure slot are then cleared.
  3. On successful extraction: the secure slot's points and every inventory item's points convert;
     inventory and secure slot are cleared; nothing is dropped on the ground.
  4. Once `RunResult` is set, `stepSimulation` is a full no-op on every subsequent call (extending
     M1.10's `!player.alive` guard to `!player.alive || runResult !== null`), matching M1's pattern
     for "the run has ended."
  5. Unit tests: a death with a non-empty inventory and a filled secure slot produces exactly the
     secure slot's points, drops the inventory contents, and reports the outcome as `"died"`; a
     successful extraction with the same starting state produces the sum of both and reports
     `"extracted"`; the world is inert after either outcome.
- **Non-goals:** any persistence of the result (D27); a lobby/restart system (a bare "start a new
  local run" client convenience is in scope for playtesting, per M2.9, but no lobby/pre-run
  loadout screen is built — that is out of scope for M2).
- **Acceptance:** the exit criterion is directly tested: the two outcomes visibly differ in what
  converts.

### M2.9 — Client wiring: input, HUD, and rendering

- **Goal:** Make M2.1-M2.8 playable and visible: render ground loot and extraction points, show the
  inventory/secure slot/points/build-effect summary, and route the new local-only input intents.
- **Requirements:**
  1. `KeyboardInput`/a new inventory input reader adds: `E` → `interactPressed`; digit keys `1`-`6`
     → a one-shot `discardSlotIndex`; `Shift`+digit → a one-shot `secureSlotIndex` (§1's documented
     local control scheme).
  2. `WorldView` renders ground loot pickups and the two active extraction points (with a visible
     channel-progress indicator while the local player channels one, matching concept §13.3
     "clear extraction effects").
  3. A new inventory HUD panel (toggled by `I`, concept §13.1) shows the six slots, the secure
     slot, the running point totals, and the current aggregated build-effect summary.
  4. On run end, the HUD shows the `RunResult` (outcome, points gained, items converted/lost) in
     place of M1's bare "You Died" text; a documented convenience (`Enter`) starts a fresh local run
     with the same hard-coded loadout, so a human can playtest repeatedly without reloading the tab.
  5. No game rule is computed in client code — the HUD and renderer read `World`/`RunResult` only,
     matching M1's invariant.
- **Non-goals:** drag-and-drop inventory rearranging in the client UI (the simulation-core function
  exists and is tested per M2.2, but is not wired to client input this milestone — §1); a lobby.
- **Acceptance:** a human can pick up loot, fill the inventory, secure an item, watch its effect
  disappear from the build summary, channel an extraction, and see a death and an extraction
  produce visibly different results, all without a server running.

---

## Definition of done for M2

- Every issue above is complete and its tests pass.
- All gates pass: `pnpm format:check`, `pnpm lint`, `pnpm typecheck`, `pnpm test`,
  `pnpm test:integration`, and `pnpm build`.
- The three technical plan §38 M2 exit criteria hold and are each covered by a test: loot changes
  build (M2.4); securing removes active effect (M2.5); death and extraction differ correctly
  (M2.8).
- No out-of-scope system was added: no skills, no networking, no accounts/persistence, no
  blueprints/permanent unlocks, no ground-weapon swap, no new enemy type, no second secure slot
  (§1; `docs/DECISIONS.md` D27).
- Documentation updated where behavior or structure changed: `docs/CONTENT_AUTHORING.md` §5 (loot
  shape moves from forward-looking to shipped) and `docs/DECISIONS.md` D27 (secure-slot local
  scope).
- A human has playtested the full loop locally (technical plan §45): pick up loot, fill the
  inventory, secure an item, die once and see inventory drop while the secure slot still converts,
  then run again and extract successfully to see both convert.
