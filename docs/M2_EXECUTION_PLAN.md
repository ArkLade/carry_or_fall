# M2 Execution Plan — Loot and Extraction

This plan is followed during M2 implementation. M2 delivers loot drops, a six-slot inventory, the
five point categories, the secure slot, rotating extraction, and the local run result — still
playable in the browser with **no network** (technical plan
`docs/browser_multiplayer_game_technical_plan_verified_v2.md` §38 M2). It follows the execution-plan
format required by that plan §26.3 (files to change, invariants, tests, migration impact, rollback,
acceptance criteria) and uses `docs/M1_EXECUTION_PLAN.md` as its structural model. It must stay
consistent with `docs/M2_ISSUES.md`; §9 maps every issue to a section here.

Authoritative sources: `docs/lightweight_multiplayer_extraction_roguelite_game_concept.md`
(gameplay/scope) and `docs/browser_multiplayer_game_technical_plan_verified_v2.md`
(architecture/technology/testing). Durable rules: `docs/DEVELOPMENT_RULES.md`. Approved technology:
`docs/DECISIONS.md`. Derived contracts: `docs/PROTOCOL.md`, `docs/CONTENT_AUTHORING.md`,
`docs/TEST_PLAN.md`.

## 1. Scope and scope resolution

**Deliver (technical plan §38 M2):** loot drops, six-slot inventory, five point categories, secure
slot, rotating extraction, local run result — local, no network.

**Exit criteria (technical plan §38 M2):** loot changes build; securing removes active effect;
death and extraction differ correctly.

### Scope resolution (restated and upheld)

`docs/M2_ISSUES.md` §1 records four scope decisions in detail; restated briefly here because they
shape §3's file list:

1. **No blueprints, boss cores, or permanent unlocks.** These require the account storage M5 adds
   (D9, D16). M2 loot is point-value items (`LootDefinition.points`) plus an optional, bounded
   `buildEffects`, nothing that unlocks anything permanently.
2. **No ground-weapon swap.** `docs/PROTOCOL.md`'s forward-looking `equip_ground_weapon` message
   stays unimplemented; it is not in the technical plan's M2 list.
3. **No new enemy type or respawning.** The one M1 chaser is the only kill-based loot source;
   scattered static ground loot (placed once, at run start, in `PlayScene`) fills out the six-slot
   inventory for a single short local run, exactly like M1's hard-coded `ENEMY_SPAWN_POINTS`.
4. **Discard/secure client controls are a documented local scheme**: digit keys `1`-`6` discard;
   `Shift`+digit secures (refused if the secure slot is occupied). Concept §13.1 fixes `E` for
   interact/extract and `Tab`/`I` for inventory; it does not fix discard/secure bindings.

**Secure-slot persistence gap** (the task's required explicit decision): recorded in
`docs/DECISIONS.md` D27. In M2 the secure slot protects an item **within the current local run
only** — no drop on death, uniform conversion on death or extraction — and explicitly does **not**
persist across runs or survive a restart, because M2 has no account, database, or server for
"permanent progress" to be written into (D9, D16, D22). The run-result screen is the only place the
conversion is ever shown.

## 2. Architecture

### 2.1 Same seam, more state

M1 established **exactly one** client→simulation seam (`stepSimulation`, called once per fixed
step). M2 does not add a second one. It extends `World`/`Player`/`InputState` with inventory,
secure slot, ground loot, extraction points, and the run result, and extends `InputState` with
three new one-shot local intents (`interactPressed`, `discardSlotIndex`, `secureSlotIndex`) — the
same pattern M1 used for `attackPressed`/`dashPressed`. No new call site, no network abstraction
(`docs/DEVELOPMENT_RULES.md`, "Scope discipline").

### 2.2 The carried-loot pipeline stage becomes real

`combat/pipeline.ts`'s stage 5, `applyCarriedLootModifiers`, was a documented pass-through since M1
specifically so M2 could fill it in without reworking the pipeline (`docs/M1_EXECUTION_PLAN.md`
§2.4). M2 makes it apply the player's current `BuildEffects` (aggregated from the inventory, capped)
to the weapon used for that attack. `prepareAttack`, `startMeleeAttack`, and `startRangedAttack` each
gain a `BuildEffects` parameter; the caller (`simulation.ts`) computes it once per step from
`player.inventory` and passes it through, so the same effective weapon is used both to resolve the
attack and to set the next cooldown (an attack-speed bonus must actually shorten the cooldown, not
just look shortened).

### 2.3 Anti-snowball caps for build effects

Concept §30.2/§31 require loot power to remain capped and the game to avoid snowballing. M1's
`combat/caps.ts` already establishes the pattern (hard caps in shared code, never only in data or
only bounded by a container size) for projectiles/bounces/pierces. M2 adds an analogous, separate
set of caps for the five recognized `buildEffects` keys in a new `build-effects.ts`, so six items
each contributing the same effect cannot produce unbounded stacking even though the six-slot limit
already bounds item count.

### 2.4 Determinism

Ground-loot choice (which item a kill drops; which candidate location a new loot pickup or
extraction point uses) flows through the existing seeded `createRng`, exactly like M1.9's enemy
spawn selection. `Math.random` must not appear in simulation code (technical plan §9.4).

### 2.5 Client stays a renderer

No rule runs in Phaser scene code. The new inventory HUD and world-view additions read
`World`/`RunResult` only; the new keyboard input reader reports intent only (which digit key was
just pressed, whether Shift was held), never which slot is "allowed" to be discarded/secured — that
check (is the slot occupied? is the secure slot free?) happens in `simulation-core`.

## 3. Files to change (§26.3)

Legend: **(new, proposed)** = a file that does not exist yet, whose path/name is this plan's
proposal; **(modify)** = an existing repo file to edit; **(unchanged)** = called out because a
reader might expect it to change but it must not.

```
packages/game-content/src/
├─ index.ts        (modify)  export loot
├─ loot.ts         (new, proposed)  LootDefinition, LootBuildEffects, ~6 real items
└─ loot.test.ts    (new, proposed)  shape-invariant tests

packages/simulation-core/src/
├─ index.ts             (modify)  export the new modules below
├─ world.ts              (modify)  GroundLoot, ExtractionPoint, RunResult, Player.inventory /
│                                   secureSlot / extractionProgressMs, World.groundLoot /
│                                   extractionPoints / runResult, InputState additions
├─ inventory.ts          (new, proposed)  INVENTORY_SIZE, Inventory, createEmptyInventory,
│                                         addItemToInventory, discardInventorySlot,
│                                         moveInventoryItem, secureItem
├─ inventory.test.ts     (new, proposed)
├─ points.ts             (new, proposed)  PointTotals, ZERO_POINTS, addPointTotals, pointsFromLoot,
│                                         sumInventoryPoints
├─ points.test.ts        (new, proposed)
├─ build-effects.ts      (new, proposed)  BuildEffects, NO_BUILD_EFFECTS, per-effect caps,
│                                         aggregateBuildEffects, applyBuildEffectsToWeapon,
│                                         effectiveMoveSpeed, effectiveMaxHealth
├─ build-effects.test.ts (new, proposed)
├─ loot-drop.ts          (new, proposed)  LOOT_TABLE, chooseLootDrop(rng), spawnGroundLoot,
│                                         attemptPickup
├─ loot-drop.test.ts     (new, proposed)
├─ extraction.ts         (new, proposed)  ExtractionPoint config/constants, spawnExtractionPoints,
│                                         stepExtractionPoints (rotation), extraction-channel helpers
├─ extraction.test.ts    (new, proposed)
├─ run-result.ts         (new, proposed)  RunResult, buildRunResult(outcome, inventory, secureSlot)
├─ run-result.test.ts    (new, proposed)
├─ simulation.ts         (modify)  wire pickup/discard/secure input handling, per-step build-effect
│                                  aggregation applied to the pipeline/movement/max-health, extraction
│                                  point stepping + channel progress + interruption on damage, enemy-
│                                  death loot drop, run-result finalization (extends the M1.10
│                                  "world is inert after the run ends" guard)
└─ combat/
   ├─ pipeline.ts   (modify)  applyCarriedLootModifiers becomes real; prepareAttack takes BuildEffects
   ├─ melee.ts       (modify)  startMeleeAttack takes BuildEffects, threads it through prepareAttack
   ├─ ranged.ts      (modify)  startRangedAttack takes BuildEffects; returns the effective
   │                           attackIntervalMs so simulation.ts sets the real cooldown
   ├─ pipeline.test.ts, melee.test.ts, ranged.test.ts   (modify)  cover the new parameter

apps/client/src/
├─ input/keyboard.ts      (modify)  E → interactPressed; digit keys → discardSlotIndex; Shift+digit
│                                   → secureSlotIndex
├─ hud/inventory-hud.ts   (new, proposed)  six slots + secure slot + point totals + build-effect
│                                          summary, toggled by I; renders RunResult on run end
├─ hud/combat-hud.ts      (modify)  death text generalizes to the RunResult outcome/summary
├─ render/world-view.ts   (modify)  render GroundLoot pickups and the two ExtractionPoints (with a
│                                   channel-progress indicator)
└─ scenes/PlayScene.ts    (modify)  loot spawn points, extraction candidate points, wire new input,
                                    an Enter-to-restart playtest convenience

docs/
├─ CONTENT_AUTHORING.md  (modify)  §5 loot moves from forward-looking to shipped, with the real
│                                  buildEffects shape (not a free-form Record)
├─ M2_ISSUES.md          (already added this change)
└─ DECISIONS.md          (already added D27 this change)

Explicitly unchanged in M2:
- apps/server/**, packages/protocol/**   no network in M2 (server/protocol work is M4); interactPressed
  already exists in protocol's InputMessage from M1 and needs no change
- .github/**              CI unchanged; new tests run under the existing pnpm test/test:integration
- package.json / pnpm-lock.yaml   no new dependency
- .env / .env.example     no new configuration
```

## 4. Content definitions and provenance

Loot items are data definitions in `packages/game-content`, consumed by the engine — not
hard-coded (`docs/DEVELOPMENT_RULES.md`, "Content is data-driven"; `docs/CONTENT_AUTHORING.md` §5).

Provenance: none of the six proposed items (`honing_stone`, `farsight_lens`, `quickstep_charm`,
`scrap_plating`, `resonant_core`, `warlords_seal`) appear by name in either authoritative document.
Concept §6.1-§6.5 describes what each point category represents qualitatively; concept §6.6 gives
one worked example (`Ancient Targeting Core`) whose exact shape this plan's `LootDefinition`
follows. The six items' point values, rarities, and `buildEffects` are **proposed (not in repo)**
and explicitly balance-deferred (concept §12.3), the same treatment M1 gave weapon and enemy
numbers.

## 5. Invariants (§26.3)

These must hold at every commit during M2, in addition to the twelve M1 invariants
(`docs/M1_EXECUTION_PLAN.md` §6), which remain in force unchanged:

1. **One seam, extended not duplicated.** `stepSimulation` stays the only client→simulation call
   site; new intents are added to the existing `InputState`, not a second input channel.
2. **Loot is data.** `LootDefinition`s are read by the engine; no per-item behavior is hard-coded.
3. **Build effects are capped in shared code**, independent of and in addition to the six-slot
   limit — stacking six copies of the same effect still cannot exceed the cap in `build-effects.ts`.
4. **The secure slot never contributes to the active build.** `aggregateBuildEffects` reads only
   `player.inventory`, never `player.secureSlot`.
5. **The secure slot is structurally irreversible.** No function removes an item from
   `player.secureSlot` once placed; there is no "unsecure" operation.
6. **Death and extraction convert differently, by construction.** Only `buildRunResult("extracted",
   …)` includes the inventory's points; `buildRunResult("died", …)` includes only the secure slot's,
   and drops the inventory's items as `GroundLoot` instead.
7. **The run is inert after it ends.** Once `world.runResult !== null`, `stepSimulation` is a full
   no-op (extends M1.10's `!player.alive` guard).
8. **No persistence.** `RunResult` is computed and displayed; nothing is written to storage of any
   kind (D27). No Supabase, no `localStorage`, no file write.
9. **Determinism.** Loot-table choice, ground-loot/extraction-point candidate selection all flow
   through `createRng`; no `Math.random` in simulation code.
10. **Strict TypeScript, validated inputs.** No implicit `any`; `buildEffects` is a typed shape
    (`LootBuildEffects`), not a free-form `Record<string, number>`, so a mistyped key is a compile
    error, not a silently inert field.
11. **Scope fence.** No skills, no blueprints/permanent unlocks, no ground-weapon swap, no new
    enemy type, no second secure slot, no networking, no accounts (`docs/M2_ISSUES.md` §1).

## 6. Anti-snowball caps — implemented in shared code with tests

Per concept §30.2/§31, `build-effects.ts` clamps the **aggregate** (post-sum) value of each
recognized key, proposed and balance-deferred like M1's combat caps:

- `damageAdd` — summed flat bonus, capped.
- `attackSpeedBonus` — summed fractional bonus (shortens attack interval), capped so the interval
  can never collapse toward zero.
- `projectileSpeedAdd` — summed flat bonus, capped.
- `moveSpeedBonus` — summed fractional bonus to player move speed, capped.
- `maxHealthAdd` — summed flat bonus to player max health, capped.

Each cap has a unit test asserting stacking past it does not exceed the ceiling, following M1's
`combat/caps.test.ts` pattern.

## 7. Tests (§26.3)

All M2 tests are **unit** tests in `packages/*/src/**/*.test.ts` (Vitest `unit` project), per
`docs/TEST_PLAN.md` §2.1, which already names M2's required scope: "loot changes the derived build;
securing an item removes its active effect; death and extraction convert differently; point
conversion is correct."

- **Loot content** — shape invariants; every `buildEffects` key present is recognized.
- **Inventory** — add fills the first empty slot; add refuses (not throws) when full; discard
  empties a slot; move swaps two slots.
- **Points** — conversion sums are exact for a known item set; empty inventory contributes zero.
- **Build effects** — a `damageAdd` item increases damage actually dealt through the pipeline; an
  `attackSpeedBonus` item shortens the real next cooldown; caps hold under stacking; securing an
  item removes its contribution (the M2.5/M2.4 cross-check for the "securing removes active effect"
  exit criterion).
- **Secure slot** — securing empties the source slot and fills the secure slot; a second attempt
  while occupied is refused and nothing changes.
- **Loot drops** — a chaser kill spawns exactly one ground-loot entity; pickup succeeds/removes the
  entity when there is space, is refused and leaves it in place when the inventory is full; the
  seeded drop choice is reproducible.
- **Extraction** — a point relocates only after its active duration elapses; channel progress
  accumulates only while both conditions (interact held, in radius) hold; taking damage resets
  progress; reaching the duration produces the extracted outcome; determinism holds under a fixed
  seed.
- **Run result** — death converts only the secure slot and drops inventory contents, reporting
  `"died"`; extraction converts both and reports `"extracted"`; the world is inert afterward (the
  M2 exit criterion "death and extraction differ correctly", made concrete and tested).

`pnpm test:integration` and the production-build tests are unchanged from M1 and must stay green
(M2 adds no server/network code). Browser end-to-end (Playwright) remains deferred; M2 uses a
manual local playtest for feel (technical plan §45), per `docs/M2_ISSUES.md`'s definition of done.

## 8. Issue → plan mapping (`docs/M2_ISSUES.md`)

| Issue (`docs/M2_ISSUES.md`)                    | Covered by this plan                                    |
| ----------------------------------------------- | -------------------------------------------------------- |
| M2.1 Loot content                                | §4; `loot.ts` in §3                                       |
| M2.2 Six-slot inventory primitives                | §3 `inventory.ts`                                         |
| M2.3 Five point categories and conversion         | §3 `points.ts`                                            |
| M2.4 Carried-loot build effects                  | §2.2, §2.3, §6; `build-effects.ts`, `combat/pipeline.ts` in §3 |
| M2.5 Secure slot                                 | §5(4)(5); `inventory.ts`'s `secureItem` in §3             |
| M2.6 Loot drops (kill + scattered)                | §2.4; `loot-drop.ts` in §3                                |
| M2.7 Rotating extraction                          | §2.4; `extraction.ts` in §3                               |
| M2.8 Run ending and local run result              | §5(6)(7); `run-result.ts`, `simulation.ts` in §3          |
| M2.9 Client wiring                                | §2.5; `input/`, `hud/`, `render/`, `scenes/` in §3        |

**Scope changes to the issues:** none. `docs/M2_ISSUES.md` §1's four scope decisions are restated
in §1 above, not altered here.

## 9. Migration impact (§26.3)

- **Dependencies:** none added; `pnpm-lock.yaml` unchanged.
- **Existing tests/CI:** all M1 unit and integration tests, and the production-build tests, must
  stay green. `.github/workflows/ci.yml` is unchanged; new tests run under the existing `pnpm test`
  step.
- **Server/protocol:** untouched. `interactPressed` already exists in `packages/protocol`'s
  `InputMessage` (added, unused, in M1); no protocol change is needed for M2's local-only
  `discardSlotIndex`/`secureSlotIndex` (analogous to M1's `secondaryAttackPressed`, which also has
  no protocol counterpart). The forward-looking `inventory_move`/`secure_item`/`equip_ground_weapon`
  messages `docs/PROTOCOL.md` names for a later networked milestone are **not** added yet — M2 has
  no network boundary for them to cross (D23's reasoning: a type with no consumer, local or
  networked, is an empty layer).
- **Client entry behavior:** `PlayScene` gains an inventory HUD panel, ground-loot/extraction-point
  rendering, and new keybindings; the default local run now includes a loot/extraction loop rather
  than combat only. Documented here and in `docs/M2_ISSUES.md`.
- **Docs:** `docs/CONTENT_AUTHORING.md` §5 moves from forward-looking to shipped, with the real
  `LootBuildEffects` shape (a typed interface, not the illustrative free-form `Record` currently
  documented) — corrected in the same change per `docs/DEVELOPMENT_RULES.md`, "Documentation."
- **No data or infrastructure migration:** M2 has no database, schema, or deployment surface
  (`docs/DECISIONS.md` D16, D22, D27).

## 10. Rollback (§26.3)

M2 is **additive** on top of M1 (tagged `v0.1.0-local-combat`); nothing is committed unless
explicitly requested by the task that authorized this work.

- To back out, delete the new `simulation-core` modules (§3), the new `game-content` `loot.ts`, and
  the new/modified client files; revert the pipeline/melee/ranged signature changes; revert the
  doc edits (`docs/CONTENT_AUTHORING.md`, `docs/DECISIONS.md` D27, this plan, `docs/M2_ISSUES.md`).
  The repo returns to the M1 state.
- There are **no migrations, no persisted data, and no infrastructure** to undo (§9).
- Work happens on the `m2-loot-extraction` branch; `main` and the `v0.1.0-local-combat` tag are not
  touched. Revert with `git revert <sha>` if needed; never force-push or rewrite shared history.

## 11. Acceptance criteria (§26.3)

Matching the technical plan §38 M2 exit criteria, plus the repository gates:

- **Loot changes build** — carried `buildEffects` measurably change combat math (damage, cooldown)
  and movement, capped, tested (M2.4).
- **Securing removes active effect** — moving an item to the secure slot removes its contribution
  from the aggregated build effects, tested (M2.5).
- **Death and extraction differ correctly** — the two run-ending paths convert loot differently and
  both are tested (M2.8).
- All gates pass: `pnpm format:check`, `pnpm lint`, `pnpm typecheck`, `pnpm test`,
  `pnpm test:integration`, and `pnpm build`.
- Loot is data-driven, build-effect caps are enforced in shared code and tested, and no
  out-of-scope system was added (§1, §5).
- A human has playtested the full local loop for feel (technical plan §45): pick up loot, secure an
  item, die and see the difference from a successful extraction.

## 12. Assumptions

- The technical plan is authoritative for milestone boundaries where it and the concept document's
  tiers differ (as in M1); concept §27.1's Prototype Tier 1 already bundles loot/inventory/secure
  slot/extraction with local combat, but the technical plan's M1/M2 split is what this repository
  follows (`docs/M1_EXECUTION_PLAN.md` §1, restated here).
- Proposed module/file names in §3 and proposed numeric values in §4/§6 are subject to change during
  implementation; only the invariants (§5), caps (§6), and acceptance criteria (§11) are fixed
  commitments.
- No new dependency is required to meet M2; if implementation reveals one, it needs a new entry in
  `docs/DECISIONS.md` before adoption, and this task's instructions require stopping to report it
  rather than choosing.

## 13. Non-goals

M2 implements none of the following (deferred to the stated milestone, or decided out per §1): data
-driven skills and the wildcard slot (M3); Colyseus rooms, authoritative server state, and other
players (M4); PvP (M7B); accounts, Supabase, persistence, real secure-slot durability (M5); parties/matchmaking
(M6); the boss and boss-core drops (M7); deployment (M8+); mobile controls; client prediction;
weapon/armor blueprints and permanent unlocks; ground-weapon swap; new enemy types; a second secure
slot; drag-and-drop inventory rearranging in the client UI. No empty service layers are created for
any of these (`docs/DEVELOPMENT_RULES.md`, "Scope discipline").
