# M7A Execution Plan — Enemy Behavior Pass

Status: **Planned.** This is the implementation order for `docs/M7A_ISSUES.md`. It does not make
the non-authoritative design draft a specification. D70 owns naming; D71 owns M7A-before-M7B
sequencing.

The plan is deliberately five independently playable checkpoints. Do not combine Phase 0's map
movement with Phase 1's enemy movement, and do not start a later phase while an earlier phase has a
margin below 40%, an unexplained test-count change, or a failed gate.

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

## 2. Phase 0 — resize, then re-audit

### 2.1 Baseline before changing coordinates

1. Run all seven gates on the current 1920 × 1080 arena.
2. Run `E2E_MARGIN=1 pnpm test:e2e` and save every `BUDGET` line.
3. Inventory browser timing that the reporter cannot see: inline deadlines, fixed key holds,
   lobby/join windows, spec constants, assertions with their own timeout, and any wait outside the
   helpers. Include the Warden sortie and multiplayer extraction idle window even though both now
   report; they are the precedent for what earlier audits missed.
4. Record test counts, 0.229 ms historical mean-tick context, current server average/max tick,
   event-loop lag, and memory. Do not compare measurements taken under different machine load.

For this plan, “idle” is an operational control, not a claim that Windows has no background work:
ports 2567/5173 are clear, no other repository build/test/server is running, and the same machine
and power state are used for adjacent baseline/candidate runs. Record visible competing processes
and repeat an outlier. Report that OS scheduling cannot be held perfectly constant; compare the
distribution and direction across repeated runs rather than treating one decimal as universal.

### 2.2 Change arena content only

Move the arena to the proposed 2560 × 1440 bounds. Re-author the wall layout, spawn candidates,
loot, wildcard chips, extraction candidates, the open lane, and boss lair as one content change.
Keep enough open space for distinct melee, ranged, artillery, and boss zones while preserving the
concept's compact, readable routes.

Expected files:

- `packages/game-content/src/arena.ts`
- `packages/game-content/src/arena.test.ts`
- browser helpers/spec coordinates only where the content contract requires it

Do not add an enemy definition, behavior, projectile, status, or protocol field in this phase.

### 2.3 Re-prove disturbed contracts

- Derive returning-shot travel from weapon speed and projectile lifespan and prove the firing lane
  keeps at least 100 px beyond it before any wall.
- Prove every loot/chip/extraction candidate is inside bounds, outside walls, and reachable from a
  player spawn. Walk the farthest selected item under seed 76 in the browser.
- Re-evaluate 75-second extraction activity and the five-second channel against worst traversal plus
  a representative fight. Preserve them if the evidence fits; changing them requires its own
  decision because the old 60-second value was already deliberately superseded.
- Place the Warden lair so its full 420 px leash plus body radius cannot intersect ordinary test
  routes. Run the boss spec that intentionally enters it as a separate budget.
- Recalculate what seed 76 selects. Keep the number only if it still produces a safe, reproducible
  layout; if not, choose and document a new seed in the same Phase 0 checkpoint rather than changing
  candidate order until the old number happens to pass.
- Re-run every route named in `M7A_ISSUES.md` §1.8. Repair every margin below 40% by route/content
  design or removal of avoidable waits. Timeout inflation requires evidence that the product action,
  rather than the test, honestly became longer.

### 2.4 Phase 0 acceptance, migration, and rollback

- **Acceptance:** 2560 × 1440 arena, all reachability checks and seven gates pass, every reported
  margin is at least 40%, unreported waits are listed with evidence, and no enemy behavior changed.
- **Migration impact:** none.
- **Rollback:** revert the arena-and-margin checkpoint in full. Phase 1 must not depend on an
  unaccepted coordinate.

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
