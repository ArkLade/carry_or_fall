# M7A Execution Plan — Enemy Behavior Pass

Status: **Planned.** This is the implementation order for `docs/M7A_ISSUES.md`. It does not make
the non-authoritative design draft a specification. D70 owns naming; D71 owns M7A-before-M7B
sequencing.

The plan has five independently playable phases. Phase 0 is itself split into three independently
revertible checkpoints: **0A** establishes the camera on the shipped arena, **0B** changes arena
content, and **0C** re-proves the disturbed contracts and records the performance/timing evidence.
Do not combine 0A's rendering change with 0B's map change, do not combine Phase 0's map movement
with Phase 1's enemy movement, and do not start a later checkpoint while an earlier checkpoint has
a margin below 40%, an unexplained test-count change, or a failed gate.

---

## 1. Invariants checked at every checkpoint

- Fixed 50 ms deterministic server simulation; clients send intent and render results only.
- Enemy and boss values and strategy selection are data-driven in `packages/game-content`; reusable
  behavior, navigation, combat, and status rules live in `packages/simulation-core`.
- Stable ordering and the seeded PRNG decide ties. No `Math.random`, wall-clock delta, or client
  target choice enters the simulation.
- The eight technical-plan §13.4 caps remain in shared code. Player projectile cap 7 stays 24 per
  player; hostile projectiles add stricter 8/source and 32/room caps rather than borrowing it.
- No dependency, Supabase migration, progression change, PvP damage, knockback, player parry, or art.
- Each phase runs format, lint, typecheck, unit, integration, build, and Playwright on an idle
  machine. `E2E_MARGIN=1` is additional evidence, not a substitute for the browser gate.
- Counts are recorded before and after each phase. Any movement must be explained by named tests
  added or removed in that phase; a surprising movement stops the checkpoint.

## 2. Phase 0 — viewport camera, arena resize, and re-audit

Phase 0 keeps the Phaser logical viewport at **1920 × 1080** and expands only the authoritative
world in 0B. The main camera is rendering state: it follows the interpolated local player, is
clamped to authoritative arena bounds, and never changes a server coordinate, simulation rule,
protocol field, or input outcome. The HUD and inventory remain fixed to the 1920 × 1080 viewport.

### 2.1 Accepted readiness baseline

The merged readiness work is the comparison baseline; do not replace it with an earlier M7 audit:

- Playwright passed **35/35 twice consecutively** with normal `retain-on-failure` tracing.
- The lowest reported margin was **62%**; `walkToward` was **79%** and
  `extractionIdleWindow` was **63%**.
- Unit coverage was **36 files / 478 tests**. Integration coverage was
  **23 files / 225 tests**.
- The first full run recorded one non-repeating **6.796 ms** maximum room tick. The second full
  run's maximum was **3.108 ms**. Keep the 6.796 ms observation in every comparison; do not delete,
  average away, or relabel it as a pass. It is an outlier, not evidence of a sustained breach.
- Playwright artifacts live at repository-root `.playwright-test-results`, outside Vite's watched
  client root.
- `walkToward` advances only the dominant remaining axis for ordinary movement. Preserve that
  regression; WASD cannot express an arbitrary target angle without steering at 45 degrees.

For Phase 0 execution, these accepted measurements supersede the pre-stabilization 48% floor still
recorded in `M7A_ISSUES.md` §1.1.

For every 0A/0B/0C browser run, “idle” is an operational control rather than a claim that Windows
has no background work: clear ports 2567 and 5173 **immediately before the run**, run no other
repository build, test, or server, and keep the same machine and power state for adjacent
measurements. Record visible competing work. A future 5 ms maximum-tick target is a trend guard:
immediately repeat a run containing a spike above it, preserve the spike in the report, and block
only on repeated comparable evidence (the immediate repeat also exceeds 5 ms, or the seeded
five-minute scenario shows a sustained/rising distribution). One isolated maximum does not become
a new normal and is not erased.

### 2.2 Checkpoint 0A — camera and viewport foundation on the shipped arena

Keep the arena at **1920 × 1080**. Implement and accept the camera policy before changing one arena
coordinate:

- Keep Phaser's logical viewport at **1920 × 1080** with the existing FIT scaling. Those numbers
  become viewport dimensions, no longer a promise that the entire arena is visible.
- Use the existing main camera. Center it on the **interpolated local-player render position** each
  frame and clamp it to the `ArenaDefinition` bounds. Do not add smoothing, lerp, zoom, or a dead
  zone in Phase 0.
- Before an authoritative local player exists, use a deterministic safe camera state inside the
  current arena bounds. Render the existing empty authoritative view; do not fabricate a player or
  speculative world merely to provide a follow target.
- World geometry and actors move under the camera. `CombatHud` and `InventoryHud` stay fixed with
  their existing `setScrollFactor(0)` behavior.
- Keep `PointerInput.aimAngleFrom` on Phaser's `pointer.worldX`/`pointer.worldY`. Validate aiming
  after camera movement and near all four clamped edges; do not reintroduce screen coordinates into
  the intent calculation.
- Give the dev-only observation hook the minimum read-only camera view needed by tests (camera
  scroll and logical viewport/bounds). `worldToPage` must convert world to screen through that
  camera view and then through the canvas FIT scale. No helper may assume `world == screen`.
- Remove `moveFor`, `meleeAttackFor`, and `rangedAttackFor`: they have no callers and their
  fixed-duration completion model is exactly the timing pattern this suite replaced. Do not keep
  unused helpers as a future API.
- Preserve `.playwright-test-results` outside Vite's watched root and preserve the dominant-axis
  walker regression.

Expected files to change in 0A, and no others:

- `apps/client/src/main.ts` — keep 1920 × 1080, but make the configuration's viewport meaning
  explicit;
- `apps/client/src/scenes/PlayScene.ts` — camera bounds, deterministic pre-player state, and
  interpolated-local-player tracking;
- `apps/client/src/debug/debug-hook.ts` — the read-only camera observation used by browser tests;
- `apps/client/e2e/helpers.ts` — camera-aware world-to-page conversion and removal of the three
  unused fixed-duration helpers;
- `apps/client/e2e/camera.spec.ts` — focused safe-state, camera-view, clamping, and
  authority-coordinate coverage on the shipped same-size arena;
- `apps/client/test/e2e-helpers.test.ts` — camera conversion plus the existing dominant-axis walker
  regression;
- `docs/TEST_PLAN.md` — 0A counts, full margin table, and measured camera contracts.

Files inspected but **not** expected to change are part of the boundary: `input/pointer.ts` already
uses world coordinates; `render/world-view.ts` already renders world objects through the scene
camera; both HUD modules already set scroll factor zero; `playwright.config.ts` already places
artifacts outside Vite's root; and `test/architecture.test.ts` already enforces that placement and
the no-client-simulation boundary. If focused evidence proves one of those premises false, stop and
amend this plan rather than widening 0A ad hoc. Do not add a camera service, manager, abstraction,
or empty test facade.

0A runs all seven gates and `E2E_MARGIN=1 pnpm test:e2e` on the idle-machine control. This is the
required **pre-resize** margin table. Every reported margin must remain at least 40%, and every test
count change must name the focused camera/helper tests that caused it. Because a 1920 × 1080 camera
cannot scroll inside a 1920 × 1080 arena, 0A proves the deterministic safe state and camera math;
0C extends the browser coverage to actual scrolling, edge aim, fixed HUD, and independent
multiplayer cameras after 0B supplies a larger authoritative world. Do not fabricate oversized
client bounds to make those assertions pass early. Commit 0A as its own revertible checkpoint when
M7A is implemented.

### 2.3 Checkpoint 0B — authoritative arena and content resize

Begin only after 0A is accepted. Expand `testArena` to **2560 × 1440** and bump
`CONTENT_VERSION` per D34. Re-author the wall layout, player/enemy spawn candidates, ground loot,
wildcard chips, extraction candidates, open lanes, and Warden lair together as one content change.
Do not scale old coordinates mechanically: accept the layout by the Phase 0 contracts while keeping
the concept's map compact and readable.

0B changes no camera policy and adds no enemy definition, behavior, navigation, projectile,
status, protocol field, server state, simulation rule, or world-coordinate transform. The server
and protocol continue publishing the same authoritative coordinates; the rendering-only camera
reveals a 1920 × 1080 window onto the larger world.

Expected files to change in 0B, and no others:

- `packages/game-content/src/arena.ts`;
- `packages/game-content/src/arena.test.ts`;
- `packages/game-content/src/version.ts`;
- `apps/client/e2e/helpers.ts` for content-authored route waypoints only;
- `apps/client/e2e/arena.spec.ts`, `boss.spec.ts`, `multiplayer.spec.ts`, and `skills.spec.ts` only
  where a re-authored content coordinate changes the route under test;
- `docs/TEST_PLAN.md` for 0B counts and the complete post-content margin table.

Run all seven gates and the margin audit again. 0B is accepted only if every margin is at least 40%
and the existing route suite remains green; it does not defer an obvious route failure to 0C.
Commit the arena/content resize as its own revertible checkpoint when M7A is implemented.

### 2.4 Checkpoint 0C — contract and performance re-audit

0C changes no gameplay design. It adds or tightens evidence for the accepted 0B layout and records
measurements against the readiness and 0A baselines:

- Derive `returning_shot` travel from the shipped bow speed and projectile lifespan. Prove the open
  lane has more than that travel distance plus **100 px**, and prove no wall collision occurs
  before expiry and reversal.
- Prove every ground-loot, wildcard-chip, and extraction candidate is inside bounds, outside walls,
  and reachable from every player spawn. In the browser, walk the farthest item actually
  selected by `MATCH_SEED=76`, not merely the last point in a content array.
- Keep `MATCH_SEED=76` fixed and record the exact enemy, loot, chip, and extraction selections it
  produces after the content rewrite. If it no longer satisfies the browser suite's safety
  assumptions, stop and amend the Phase 0 plan; do not shuffle candidate order until the old seed
  happens to pass and do not substitute a new seed without a recorded decision.
- Measure the longest valid spawn-to-active-extraction route plus one representative shipped Chaser
  fight and the five-second channel. Confirm the total fits the **75-second** active window, and
  record that 75 seconds remains inside the concept's **45–90 second** range. If it does not fit,
  report the measurement and make a separate deliberate timer decision; do not hide it in a route
  timeout.
- Prove the Warden's 420 px leash, including its body extent, cannot meet ordinary loot,
  extraction, Chaser, open-lane, or multiplayer routes. Run the intentional Warden sortie
  separately with its named health/time budget.
- Re-run every route named in `M7A_ISSUES.md` §1.8: nearest extraction and channel, far chip,
  Chaser meeting point, open-lane/returning-shot route, Warden sortie, two-client contested loot,
  party joins, death/restart, and loadout/skill walks.
- Record current average/max room tick, event-loop lag, memory, integration duration, and browser
  suite duration under the same idle control. Preserve the 6.796 ms readiness outlier alongside the
  3.108 ms repeat; apply §2.1's repeated-evidence rule to the future 5 ms target.
- Inventory every wait the reporter cannot see. Repair a margin below 40% by shortening the route,
  moving content, or removing avoidable waiting. Increase a product timeout only when the measured
  larger-world action genuinely needs more time, and record that reason as a deliberate decision.

Expected files to change in 0C, and no others:

- `packages/game-content/src/arena.test.ts`;
- `apps/client/e2e/arena.spec.ts`;
- `apps/client/e2e/boss.spec.ts`;
- `apps/client/e2e/camera.spec.ts`;
- `apps/client/e2e/multiplayer.spec.ts`;
- `apps/client/e2e/skills.spec.ts`;
- `docs/TEST_PLAN.md`.

If 0C proves the 0B content wrong, return to 0B and fix the content in a separately identified 0B
correction; do not smuggle arena changes into the audit checkpoint. Commit 0C's tests and evidence
as its own revertible checkpoint when M7A is implemented.

### 2.5 Required Phase 0 acceptance coverage

The focused and existing tests together must demonstrate all ten conditions:

1. The local player remains visible near the north, south, east, and west arena edges.
2. The camera never exposes space outside authoritative arena bounds.
3. Mouse aim remains correct while moving and at each clamped edge.
4. Combat and inventory HUD positions stay fixed in viewport coordinates while the camera scrolls.
5. In multiplayer, each browser's camera follows its own interpolated local player.
6. Camera movement changes no authoritative player/world coordinate and introduces no client
   simulation or protocol field.
7. Camera-aware helpers can aim at and reach world positions outside the initial viewport.
8. The dominant-axis walker regression remains covered.
9. Playwright trace/screenshot writes do not trigger a Vite reload.
10. All seven gates pass and every reported margin is at least 40% at **each** of 0A, 0B, and 0C.

### 2.6 Phase 0 reporting, migration, and rollback

Report every `BUDGET` label side by side, not only the tightest labels. The table has columns for
the accepted readiness baseline, 0A pre-resize, 0B post-content, and 0C final audit, with used time,
budget, and margin wherever the earlier run recorded them. Name any newly reported budget instead
of silently leaving its earlier cells blank. Report test counts and integration duration at every
checkpoint.

- **Acceptance:** all three checkpoints and all ten coverage conditions pass; the arena is
  2560 × 1440 behind a fixed 1920 × 1080 logical viewport; all reachability, extraction,
  returning-shot, Warden, seed, route, performance, and margin evidence is recorded; no enemy
  behavior changed.
- **Migration impact:** none.
- **Rollback:** 0C reverts tests/evidence to accepted 0B; 0B reverts content to accepted 0A; 0A
  reverts camera/test-harness work to the merged readiness baseline. Phase 1 may depend only on an
  accepted 0C checkpoint.

## 3. Phase 1 — bounded navigation and Dasher

### 3.1 Replace the single-definition spawn seam

Change the arena/simulation contract from “one enemy definition repeated `enemyCount` times” to an
ordered, content-authored roster whose definitions and spawn candidates are chosen deterministically.
Publish ordinary-enemy `definitionId`, behavior/telegraph state, and any locked attack shape needed
for rendering. Preserve server ownership and Colyseus in-place reconciliation.

Expected boundaries:

- `packages/game-content/src/enemies.ts`, `arena.ts`, exports, and tests
- `packages/simulation-core/src/world.ts`, `simulation.ts`, `enemy.ts`, and tests
- `packages/protocol/src/messages.ts` and any version/contract tests required by a changed view
- `apps/server/src/rooms/MatchRoom.ts`, `MatchState.ts`, `match-sync.ts`, and integration tests
- `apps/client/src/render/world-view.ts`, interpolation/debug views as required, and browser tests

### 3.2 Build bounded navigation with its first consumers

Build one deterministic coarse-grid A* primitive from AABB walls. Give it a node-expansion cap,
stable neighbor/tie order, cached paths, and staggered repaths no faster than 250 ms. A refused or
exhausted search falls back to bounded direct movement and stops at collision; it never spins or
teleports. Instrument the worst search count in tests and charge runtime to the phase budget.

Move the existing Chaser onto this primitive as a regression case. Dasher uses it only to approach;
its cardinal dash remains a locked swept line whose wall collision stuns it.

### 3.3 Render and test the first role

Render Dasher's charge line and wall-stun outcome. The server publishes the committed line and
remaining wind-up; the client derives no target. Test single-player counterplay plus target choice,
tie behavior, target death, path obstruction, and shape collision with two and eight players. Do
not add a hostile-projectile seam in anticipation of Phase 2.

### 3.4 Phase 1 verification, migration, and rollback

- Run focused content, navigation, enemy, protocol, sync, integration, and browser tests.
- Repeat Phase 0 routes and margin audit with the mixed Chaser/Dasher roster.
- Run the eight-player five-minute performance scenario and compare it with Phase 0 on the same
  idle machine to isolate the cost of navigation and Dasher behavior.
- **Acceptance:** both roles are visually distinct and fightable, the mixed roster is deterministic,
  multiplayer target rules pass, all margins are at least 40%, the measured navigation/Dasher cost
  fits the cumulative +0.250 ms budget, measured total mean is at most 0.479 ms, measured max is at
  most 5 ms, and all gates pass.
- **Migration impact:** none.
- **Rollback:** revert the Phase 1 checkpoint, leaving the accepted resized Chaser/Warden game.

## 4. Phase 2 — hostile-projectile pool and Standard Shooter

### 4.1 Add the hostile pool with its first consumer

Add explicit hostile affiliation and source attribution without pretending an enemy id is a player
`ownerId`. Enforce 8 active hostile projectiles per source, 32 per room, and 8 primary projectiles
per attack. Stable source/tick order decides refusal; existing projectiles are never deleted to make
room. A live Shooter drives every new path, so no empty projectile service lands.

Expected boundaries:

- Shooter content and focused content tests
- hostile projectile simulation, caps, collision, and attribution tests
- only the protocol/server/client state required to publish and render hostile shots
- focused integration and browser tests

### 4.2 Implement and render Standard Shooter

Reuse accepted Phase 1 navigation to select reachable cells in a bounded preferred-distance band
with line of sight. Lock one live target and aim line at wind-up, publish that commitment, then fire
one server-owned shot. It may reconsider between attacks but does not continuously flee from the
aggregate room. Render its muzzle/aim line and hostile shot distinctly from player projectiles.

### 4.3 Phase 2 verification, migration, and rollback

- Test target choice/ties/death, line of sight, preferred-distance cells, projectile collision,
  player damage, source attribution, and every hostile cap with two and eight players.
- Repeat Phase 0/1 routes and margin audit with the mixed Chaser/Dasher/Shooter roster.
- Run the eight-player five-minute scenario with both player and hostile projectile pools saturated;
  compare with the accepted Phase 1 baseline on the same idle machine.
- **Acceptance:** Shooter is visually distinct and fightable; target commitments are readable;
  hostile shots never enter player ownership, cap, or hit-credit paths; all margins are at least
  40%; cumulative mean/max thresholds and all gates pass.
- **Migration impact:** none.
- **Rollback:** revert Phase 2 and retain the accepted Chaser/Dasher game and navigation primitive.

## 5. Phase 3 — Shield/Tank and Grenadier

### 5.1 Land statuses with real consumers

Generalize timed statuses only when wiring the two Phase 3 consumers. Each authoritative instance
has kind, source, remaining time, magnitude, and deterministic periodic accumulator. Same-kind,
same-source effects refresh; they do not stack. A hard per-actor instance ceiling, stable resolution
order, deterministic overflow refusal, death/run-end cleanup, and reconnect visibility are tested.

The first kinds are player stun from the Tank counter and poison DoT from the Grenadier hazard.
Existing enemy stun is migrated through the same bounded rules only if doing so reduces duplicate
logic in the first consumer's change; shield remains HP, not a timed status. Slow does not land yet.

### 5.2 Implement Shield/Tank without reflection

The Tank navigates toward a threat, then stops in a visible frontal guard state. During guard:

- a frontal melee hit is prevented and its attacking player takes the configured counter damage and
  two-second stun;
- a frontal ranged hit is consumed without reflection;
- attacks from the side/back resolve normally;
- the guard enters its specified five-second cooldown.

Attack source is the actual hit owner; party membership never changes the outcome. Tests cover
boundary angles, simultaneous attackers, melee/ranged arrival in one tick, attacker death,
cooldown, and the absence of every reflected-projectile side effect.

### 5.3 Implement Grenadier and bounded hazards

Grenadier scores a finite set of content-authored cover anchors against all live nearby players,
navigates to the best reachable one, chooses one player's predicted position at throw time, and
locks the landing circle. The lob may cross walls, but its landing must be valid arena ground. The
published fuse and circle precede a bounded AoE; the optional lingering poison zone has a hard
duration/area-instance limit and a translucent edge. Every player in the shape is affected.

Hostile shots and hazards share source/room accounting where they can multiply work. Tests saturate
eight players, sources, projectiles, hazards, and statuses simultaneously and assert deterministic
refusal without deleting earlier state.

### 5.4 Phase 3 verification, migration, and rollback

- Extend protocol/server/client state only for live guard, lob, hazard, and status rendering.
- Add adversarial simulation tests before browser demonstrations; include a liar case for cap and
  allegiance fields at the authoritative boundary.
- Repeat all Phase 0/1/2 margin and five-minute performance measurements.
- **Acceptance:** Tank and Grenadier work with two and eight players, Tank never reflects, poison
  and stun are bounded shared statuses with real consumers, telegraphs precede every hit, caps and
  performance thresholds pass, every margin is at least 40%, and all gates pass.
- **Migration impact:** none.
- **Rollback:** revert the Phase 3 checkpoint without touching the accepted Phase 2 roster.

## 6. Phase 4 — Juggernaut and Hive Mother

### 6.1 Make boss behavior selection honestly data-driven

The shipped boss engine assumes one generic Warden move model even though `BossDefinition` carries
stats and attacks. Do not hide two new strategies behind definition-id checks. Add an explicit
content strategy discriminator and bounded simulation strategy state. Existing Warden behavior is
the first regression case; Juggernaut and Hive each consume only the primitives their strategy
needs. A later boss using an existing strategy should be definition-plus-tests; a new behavior still
requires an engine primitive.

### 6.2 Implement the Juggernaut's complete readable move set

Add its slow navigation, one-second locked ram lane, frontal ground sweep, circular impact ring,
clearly drawn cooling damage-reduction stance, and 50%-HP double-dash phase. The second dash may
select a new live target only after the first resolves and then locks its shorter 0.5-second
telegraph. Every shape hits all players intersecting it. Test attack order/cooldowns, walls, leash,
several targets, damage reduction feedback, phase latching, and death during each state.

### 6.3 Implement Hive Mother as a room encounter

Author valid warp anchors in arena content. At a committed warp, score each anchor by its minimum
distance to all live players and choose the largest value with seeded tie-breaking. Publish the
destination marker before moving. Never use “the nearest player is close” as the room rule.

The normal phase uses bounded ordinary Chaser summons and telegraphed poison traps; its first trap is
slow's first shared-status consumer. The 50% phase raises summon cadence within the same cap and
replaces some trap throws with capped, destructible hostile homing shots. Collision, destruction,
target lock, affiliation, and cap refusal are authoritative. The renderer distinguishes destination,
spawn, trap, poison/slow, and homing channels without opaque coverage.

### 6.4 Phase 4 verification, migration, and rollback

- Test both bosses against one, two, and eight players, including simultaneous target death,
  reconnect snapshots during every telegraph/state, cap saturation, invalid anchors, and seeded ties.
- Re-run every Warden test and boss-core settlement test; no new boss may change core persistence or
  the secure-slot path.
- Run the full margin audit with each boss encounter deliberately visited and with ordinary routes
  proving their lairs cannot interfere.
- Repeat the seeded five-minute worst-roster performance scenario and report average/max tick,
  event-loop lag, memory, entity maxima, and cap refusals.
- **Acceptance:** Juggernaut has two normal attacks, one area attack, and one phase; Hive's movement
  is meaningful for the whole room; both are readable, deterministic, bounded, and playable; Warden
  and settlement regressions pass; all margins and performance thresholds pass; all gates pass.
- **Migration impact:** none.
- **Rollback:** revert Phase 4 and retain the complete, playable Phase 3 roster. No account data or
  migration requires reversal.

## 7. Final documentation and delivery record

After Phase 4 evidence exists:

1. Update `PROTOCOL.md`, `CONTENT_AUTHORING.md`, and `TEST_PLAN.md` to actual shipped fields,
   definitions, counts, caps, performance, and margin results. Update other authoritative contracts
   only where implementation deliberately changed them.
2. Mark D71 Approved in place and the M7A issue/execution-plan statuses Delivered. Do not delete or
   rewrite the draft; its header and deferments preserve why it is not the contract.
3. Verify every `D<n>` reference with the existing decision-integrity test.
4. Run the seven gates on an idle machine one final time and report exact counts. Run the Supabase
   suite only if its documented credential conditions are intentionally available; M7A has no schema.
5. Review the complete diff for source-scope drift, dependency changes, migrations, generated art,
   or accidental M7B/player-parry work. Any such change blocks delivery.

## 8. Files expected to change across M7A

This is a boundary map, not permission to touch every file:

- content: enemy, boss, and arena definitions, exports, and their tests;
- simulation: world state, orchestration, enemy/boss strategies, navigation, hostile projectiles,
  hazards/statuses, caps, and focused tests;
- protocol/server: only public state required to reconcile and render committed behavior;
- client: rendering/interpolation/debug state and browser evidence; never authority;
- docs: decisions, contracts, issue/plan status, measured test/margin/performance tables.

Explicitly absent: `supabase/`, progression/account settlement, party-power rules, deployment, cloud
configuration, new packages, and source-controlled art.

## 9. Final acceptance criteria

- Five independently playable checkpoints, each with a logical rollback point and no failed gate.
- Four ordinary enemy roles and two bosses added without weakening any §13.4 cap.
- Hostile cap behavior proven at 8/source, 32/room, and 224 total projectiles with eight saturated
  player caps; attribution never enters a player-owner path.
- Shared statuses ship only with consumers and stay bounded; navigation stays deterministic and
  within its node/repath limits.
- Every damaging action has a server-published, readable telegraph; no projectile or effect field
  lets the client decide an outcome.
- Total measured mean tick is at most 0.479 ms and measured max at most 5 ms in the defined seeded
  load; no rising event-loop-lag or memory trend.
- Every browser margin is at least 40%, including spec-local waits, and every unexplained count
  change has stopped the phase rather than being waved through.
- Deferred designs remain deferred with their reasons, and the enlarged unassigned art gap is
  visible in the delivery report.
