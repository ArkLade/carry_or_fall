# M7A Issue List — Enemy Behavior Pass

Status: **Planned.** M7A follows shipped M7 and precedes M7B (D70, D71). This document turns
`M7A_ENEMY_DESIGN_DRAFT.md` into bounded multiplayer work; the draft is input, not authority.

Read before starting: `docs/DEVELOPMENT_RULES.md`, `docs/DECISIONS.md` (D33, D54, D59, D60,
D66, D69, D70, D71), the concept document §§13.3, 14.2, 14.3, 21, 24.2, 26, the technical plan
§§9.3, 13.4, 26.3, 29–30, 32, 38, and `docs/TEST_PLAN.md` §5.

---

## Scope

M7A has five phases, each of which must leave the game independently playable:

0. enlarge the arena and re-audit routes and timing before adding an enemy;
1. add bounded navigation and the Dasher;
2. add the bounded hostile-projectile pool and Standard Shooter;
3. add the Shield/Tank, without projectile reflection, and the Grenadier;
4. add the Juggernaut and Hive Mother bosses.

The shipped Chaser and Warden remain. The result is six new definitions: four ordinary enemies and
two bosses. M7A does not add PvP damage, knockback, player parry, persistence, deployment, art, or a
new dependency.

## Architectural constraints

- The server remains authoritative. Behavior runs in `packages/simulation-core` on the fixed 50 ms
  step. The client renders published state and never selects a target, confirms a hit, advances a
  cooldown, or applies a status.
- Stats and behavior selection belong in `packages/game-content`. A further enemy using a behavior
  M7A has already built should be a definition plus tests. That claim does **not** make M7A's new
  navigation, hostile-projectile, status, dash, guard, artillery, summon, trap, or boss-strategy
  primitives “content”; their first consumers require engine, protocol, server, rendering, and test
  work where applicable.
- All eight technical-plan §13.4 caps remain enforced in shared code. No enemy may raise, bypass,
  or reinterpret a player cap to make its design fit.
- Random choices use the world PRNG. Target ties, spawn refusal, navigation ties, and status order
  are deterministic.
- Runtime network state carries only what every client must render. Private inventory, party, and
  settlement boundaries remain unchanged.
- There is no migration impact. No Supabase file or account/progression contract changes.
- Concept §24.2 budgeted three enemy sprites, one boss sprite, and basic map tiles. Four ordinary
  enemies, two bosses, and a larger arena widen an already-unassigned art gap. Placeholder geometry
  may prove playability, but art production and assignment remain out of M7A.

---

## §1. Decisions that must hold before enemy implementation

### 1.1 Phase 0 owns the arena resize and the first margin audit

The current arena is 1920 × 1080 and was already doubled in both dimensions during M4 preparation.
M7A proposes 2560 × 1440: one-third more distance on each axis and about 1.78 times the area. That is
large enough to separate six roles without turning the concept's compact map into a traversal game.
The exact wall, spawn, pickup, extraction, open-lane, and lair coordinates are content work in Phase
0; they are accepted by reachability and timing evidence, not by preserving their old ratios.

The resize happens alone because it disturbs all of these shipped premises:

- extraction points are active for **75 seconds**, not 60, and channel for 5 seconds. The 75-second
  value was raised from 60 when the map last grew. Phase 0 measures the longest valid route plus a
  representative fight before deciding whether 75 seconds still fits the concept's 45–90 second
  range; it does not silently change either timer;
- every initial loot and wildcard-chip location must remain reachable, including the far chip that
  currently anchors the longest browser walk;
- the Warden's upper-far lair must move without allowing its 420 px leash to intersect ordinary
  loot, extraction, chaser, open-lane, or multiplayer routes;
- `returning_shot` reverses only after its projectile expires. The open lane must remain longer than
  the derived projectile travel plus 100 px, with no wall collision before expiry;
- `MATCH_SEED=76` pins enemy, loot, chip, and extraction placement. Coordinates and candidate-list
  order can invalidate its safety assumptions even when the seed is unchanged.

Before resizing, record `E2E_MARGIN=1 pnpm test:e2e` on an idle machine. After resizing, audit every
reported budget and the waits that do **not** report. The current measured floor is 48%. Any budget
below 40% is fixed before Phase 1, normally by shortening the route, moving content, or removing
avoidable waiting—not by inflating the timeout until the percentage looks healthy. The Phase 0
diff and audit are committed separately when M7A is implemented so later margin loss has one cause.

### 1.2 Enemy projectiles have both a source cap and a room cap

Technical-plan §13.4 cap 7 remains **24 active projectiles per player**. Enemy and boss projectiles
are a separate hostile pool:

- at most **8 active hostile projectiles per enemy or boss source**;
- at most **32 active hostile projectiles in one room**;
- at most **8 primary projectiles from any one attack**, reusing cap 1.

When either hostile cap is full, later spawns in stable source/tick order are refused. Existing
projectiles are never deleted to admit a newer one. With eight players, the absolute active ceiling
is therefore 8 × 24 player projectiles plus 32 hostile projectiles: **224**, while all bounce,
pierce, return, split, child-parent, and bounded-search rules remain unchanged.

Hostile projectiles need explicit affiliation and source attribution rather than pretending an
enemy id is a player `ownerId`. Hit credit and the player's active cap must never find an enemy in a
player lookup. The protocol publishes enough affiliation, source, and telegraph state to render and
destroy hostile projectiles, but the client does not decide collision or allegiance.

The performance budget is measured against M4's 0.229 ms mean room tick with three Chasers. Under a
seeded five-minute, eight-player scenario that saturates both projectile pools and the phase's enemy
roster, M7A may add at most **0.250 ms mean**, for a total mean no higher than **0.479 ms**, and no
single measured room tick may exceed **5 ms**. Run the old and new scenarios on the same idle
machine and report average and maximum room-tick duration, event-loop lag, and process memory from
the existing metrics. Each phase repeats the comparison; a rising trend or cap violation blocks it.

### 1.3 Status effects are one shared primitive that ships with Phase 3

The existing enemy `stunnedMs` and player shield are narrow mechanics, not a general status model.
Phase 3 is the first consumer of a bounded shared status-effect primitive in `simulation-core`:

- Shield/Tank can apply authoritative player stun from a successful frontal melee counter;
- Grenadier's lingering hazard applies poison as a timed DoT;
- each status records kind, source, remaining duration, magnitude, and (for periodic damage) its
  deterministic tick accumulator;
- the same source and kind refresh rather than stack, effects resolve in stable order, and a hard
  per-actor ceiling prevents unbounded instances. The ceiling and overflow rule are tested before a
  second source can use the primitive.

Slow ships only when Hive Mother's trap becomes its first consumer in Phase 4. No empty slow or DoT
service lands in Phase 1 or 2. Deferred consumers are Swarm/Slime latch (slow and DoT), both Ambushers
(poison and stun), Trapper (slow), Buffer (speed modifier), Healer (timed restore if retained),
Phantom (poison), and player parry (enemy stun). Those designs do not become scheduled merely by
sharing the primitive.

### 1.4 Every selected behavior is defined for two to eight players

Target choice is authoritative, deterministic, and periodically reconsidered; committed attacks
lock their target or shape so a telegraph remains dodgeable.

| Design | Multiplayer behavior |
| --- | --- |
| Dasher | Select the nearest reachable live player at wind-up, lock the cardinal dash line, and hit every live player intersecting it. Do not retarget mid-dash. A wall collision ends the dash and stuns the Dasher. |
| Standard Shooter | Select the nearest visible live player at each decision interval, hold a bounded preferred-distance band, and lock one basic shot at wind-up. It may change targets later but does not flee indefinitely from the room. |
| Shield/Tank | Face the nearest recent attacker during a visible guard window. The frontal guard applies equally to every player's melee hit; a successful counter affects that attacker only. Ranged hits are absorbed during guard, never reflected. Flanking is geometric, not party-aware. |
| Grenadier | Choose one live player's predicted position at throw time, then lock the landing circle. The explosion and hazard affect every live player in the published area. It scores cover anchors against all nearby threats instead of assuming one pursuer. |
| Juggernaut | Select one live target when each telegraph begins, but every arc, ring, and dash collision affects all players in its shape. The second phase may choose a new target only between the two committed dashes. |
| Hive Mother | Replace “warp away when the player gets close” with a room rule: on cooldown, choose the valid arena anchor that maximizes the minimum distance to all live players, using seeded tie-breaking. Summons and traps obey room/source caps; homing shots lock explicit targets and can be destroyed authoritatively. |

The draft's unbounded kiting does not survive multiplayer and is deferred with the Gunner. Stealth
that makes an attacker untargetable while it chooses one victim does not survive readable shared
combat and is deferred with both Ambushers and the Phantom. Random Hive corners do not survive
either; only the maximin valid-anchor rule above is planned.

### 1.5 Readability is protocol state, not client prediction

The Warden already draws the committed attack shape during wind-up. M7A extends that precedent:

| Design | What players see before damage |
| --- | --- |
| Dasher | Distinct melee body color, a charge pause, and the locked line from body to wall; wall impact and stunned state are visible. |
| Standard Shooter | Distinct ranged silhouette/color, muzzle wind-up, and one narrow aim line; its hostile projectile has a different fill from player projectiles. |
| Shield/Tank | A frontal guard arc with a clear back opening, guard-ready/cooldown state, and a separate short counter arc. No reflection cue exists because reflection is out of scope. |
| Grenadier | Visible lob trail and landing circle for the whole fuse, followed by a bounded translucent hazard edge that never obscures actors. |
| Juggernaut | Locked dash lane, frontal-sweep arc, expanding impact-ring outline, obvious cooling stance, and a separate 50% phase cue. |
| Hive Mother | Destination marker before warp, spawn glyphs, trap circles before arming, and hostile homing shots distinct from traps and player homing shots. |

Definition ids, committed state, target-independent shapes, and remaining wind-up time must cross
the normal match-state boundary. Client interpolation may smooth positions but may not invent or
extend a telegraph. Dense opaque fills and unreadable projectile curtains are acceptance failures.

### 1.6 The Juggernaut meets concept §14.3

The one-dash draft is not sufficient. The planned Juggernaut has:

1. a telegraphed straight ram as its first normal attack;
2. a telegraphed frontal ground sweep as its second normal attack;
3. a telegraphed circular impact ring as its area attack; and
4. a 50% phase change that converts one ram into a two-dash chain, with a new locked target allowed
   only between dashes and a shorter second wind-up.

The draft's three-second cooling stance remains, clearly rendered, but complete invulnerability is
reduced to heavy damage reduction so successful counterplay is never discarded without feedback.
The exact reduction and attack numbers are proposed content values and remain balance-deferred. This
is still a limited move set: two normals, one area, one phase, matching the concept and Warden shape.

### 1.7 Navigation is a new, bounded shared primitive

Direct nearest-player movement plus axis collision cannot route around the current walls. Phase 1
introduces deterministic navigation as a real `simulation-core` primitive: a coarse grid derived
from authoritative AABB walls, bounded A* searches, stable tie-breaking, a node-expansion ceiling,
and staggered repaths no more often than every 250 ms. Paths are cached until the target cell or
collision state changes. Search cost is charged to the performance budget in §1.2.

| Design | Navigation need |
| --- | --- |
| Dasher | Shared navigation only for approach; the committed dash is a straight swept move and wall impact is intended counterplay. |
| Standard Shooter | Reuses Phase 1 navigation for reachable preferred-distance cells and line of sight; no endless opposite-vector kiting. |
| Shield/Tank | Shared navigation for approach and facing; guard itself is stationary. |
| Grenadier | Shared navigation to a bounded set of content-authored cover anchors; the lob ignores walls only after launch. |
| Juggernaut | Shared navigation for its slow approach; ram and area attacks do not route. |
| Hive Mother | No path search for warp; it scores validated content-authored anchors. Its summoned Chasers use the shared navigation primitive. |

This explicitly supersedes the old Chaser's direct-motion behavior inside M7A. It does not add a
general physics engine, dynamic navmesh package, or dependency.

### 1.8 Timing evidence includes routes the audit used to miss

Phase 0 rechecks at least these current browser paths: nearest extraction near `(200, 200)` and its
five-second channel; far chip near `(1740, 620)`; Chaser meeting point `(1200, 900)`; open lane
through `(700, 900)` and returning-shot firing point `(400, 900)`; the Warden sortie into the
upper-far lair; both-client contested loot; party joins; death/restart; and loadout/skill walks.

| New role | Existing browser coverage it can disturb | Containment and evidence |
| --- | --- | --- |
| Dasher | `arena.spec.ts` fight/death/restart and returning-shot lane; `skills.spec.ts` Chaser fights and chip walks; multiplayer loot/extraction; party inventory walks | Seeded spawn/aggro placement keeps setup routes out of a locked dash line; combat tests enter it deliberately with named budgets. |
| Standard Shooter | Every ordinary route above, including an idle second client, because a shot reaches beyond contact range | Line-of-sight and range are asserted along each route; hostile shots cannot cross the Warden-isolation boundary unnoticed. |
| Shield/Tank | Melee skill tests and `arena.spec.ts`'s sword-survival test can hit its guard instead of the intended Chaser | Tests select enemies by `definitionId`; setup routes avoid its guard arc and dedicated tests approach it from named sides. |
| Grenadier | Static pickup, chip, extraction-channel, and party-inventory tests can be hit behind cover | Landing circles are absent from protected setup routes under the browser seed; dedicated artillery tests cross them with reported fuse/health budgets. |
| Juggernaut | `boss.spec.ts` intentionally enters a lair; every other spec depends on the boss ignoring it | Give it a content-authored lair/leash and parameterized intentional sortie; prove all routine paths remain outside every attack extent. |
| Hive Mother | The same boss sortie, plus ordinary routes if summons can leave the lair | Bound summons to the encounter region or despawn/recall them at its leash, then prove routine paths never acquire a summoned Chaser or trap. |

Each later phase adds adversarial route runs with its new enemies enabled and compares them with the
Phase 0 baseline. A normal-purpose E2E test must not accidentally cross a new aggro region or locked
attack lane; a combat-purpose test may do so only with a named health/time budget. Every inline
deadline and every helper loop is inventoried. The audit is assumed incomplete until unreported
waits, fixed keyboard holds, lobby windows, and browser-spec constants have been checked manually.

---

## §2. Deferred designs

Deferred means not implemented by M7A and not silently scheduled elsewhere.

### 2.1 Player parry — full unresolved proposal

This is a player ability, distinct from the Shield/Tank enemy's guard:

- The player performs an arc motion in front of the character. Success is a timing window, not a
  held stance.
- Parrying an enemy melee attack deals damage to that attacker and stuns it for two seconds.
- Parrying a ranged projectile reflects it at twice the damage and twice the speed.
- Reflection applies to every ranged attack except the player's own and those of allied players—so
  hostile players, enemies, and bosses.

It is not scheduled until all of these conflicts are resolved:

- Parry is absent from the concept document: §9.2 does not list the primitive, §8 gives only dash as
  the movement ability, and §13.1 has no control binding. Adding it requires a deliberate change to
  an authoritative document before implementation planning.
- Excluding allied projectiles contradicts D60's rule that party membership grants presence, not
  power. If party membership changes reflection, it changes combat outcomes; D60 or this exclusion
  must give.
- Reflected-projectile `ownerId` is undecided. Whether ownership stays with the original shooter or
  transfers to the parrier changes cap 7 accounting and hit credit with eight players.
- A two-second stun is severe once PvP damage ships in M7B.
- Parry is a second defensive option alongside dash. Its resource, cooldown, and counterplay must
  preserve dash's role rather than making dash the inferior answer to every attack.

### 2.2 Other deferred draft designs

| Design | Reason deferred |
| --- | --- |
| Swarm/Slime latch | Attaching one authority-owned body to a player, escape rules, stacked slows, DoT, summon caps, and multiplayer crowding are all unresolved. Hive Mother uses ordinary bounded Chaser summons instead. |
| Skirmisher | Backstep/diagonal evasion needs collision-safe retreat selection and adds a seventh ordinary-enemy role beyond the four chosen for this pass. |
| Ambusher 1 | Stealth targetability and flee behavior fail shared readability; poison alone does not resolve the attacker's visibility contract. |
| Ambusher 2 | It inherits Ambusher 1's problems and combines a severe two-second stun with poison. |
| Suppression/Bullet Hell | Continuous density conflicts with §13.3 readability and the 32-hostile-projectile room cap; no acceptable sparse pattern is specified. |
| Homing enemy | Destructible hostile projectiles need an authority and collision contract first. Phase 4 exercises that primitive only as a bounded Hive phase attack, not as another ordinary enemy. |
| Trapper | Predicted-path placement across several players and a heavy slow need fairness and stacking rules beyond Phase 4's fixed boss traps. |
| Buffer | Target priority, channel interruption, buff magnitude, and interaction with navigation are unspecified; it would add support AI without a selected encounter. |
| Healer | Healing priority, range, interruption, overheal, and stalemate limits are unspecified. |
| Summoner | Unbounded spawning is incompatible with room cost limits; Hive Mother supplies the one bounded summon encounter used to design caps. |
| Boss 2 — Gunner | “Move opposite the player” has no stable meaning with several players, indefinite kiting is hostile to compact-map play, and bullet hell conflicts with readability and projectile caps. |
| Boss 4 — Phantom | Untargetable stealth plus victim-relative materialization is unreadable and ambiguous with several players; lingering poison also risks opaque arena denial. |
| Shield/Tank projectile reflection | Doubled speed/damage, hostile ownership, cap accounting, shield-on-hit credit, and allegiance are unresolved. Phase 3 guard absorbs a frontal ranged hit instead. |

---

## §3. Issues

Each issue follows technical plan §26.3: files, invariants, tests, migration impact, rollback, and
acceptance are explicit. Exact file sets are confirmed during implementation discovery; the lists
below name the expected boundaries and may narrow, but may not expand into persistence or PvP.

### M7A.1 — Phase 0: enlarge the arena and prove reachability

- **Files to change:** `packages/game-content/src/arena.ts`, `packages/game-content/src/arena.test.ts`,
  affected `apps/client/e2e/*.spec.ts` and `helpers.ts`, then `docs/TEST_PLAN.md` with measured margins.
- **Invariants:** no enemy definition or behavior changes; 75-second active extraction and
  five-second channel are preserved unless a separate evidence-backed decision changes them;
  Warden leash cannot meet routine routes; every pickup and open-lane behavior remains reachable;
  seed 76 stays explicit and its new layout is documented.
- **Tests:** content geometry tests, full Playwright suite, pre/post `E2E_MARGIN=1` audit, manual
  inventory of unreported waits, and all seven gates on an idle machine.
- **Migration impact:** none.
- **Rollback:** revert the Phase 0 arena/margin checkpoint as one unit; no later phase begins until it
  is accepted.
- **Acceptance:** 2560 × 1440 arena is playable; all listed routes pass; returning shot expires in
  open space; Warden stays isolated; every reported margin is at least 40%; unreported budgets are
  named; test counts have not moved except for deliberate new Phase 0 tests.

### M7A.2 — Phase 1: bounded navigation, heterogeneous roster, and Dasher

- **Files to change:** `packages/game-content/src/enemies.ts` and tests; `arena.ts` roster/spawns;
  `packages/simulation-core/src/enemy.ts`, `simulation.ts`, `world.ts`, a focused navigation module
  and tests; protocol enemy views; server match creation/state/sync; client world rendering; focused
  integration and E2E tests.
- **Invariants:** deterministic bounded navigation; mixed definitions spawn from content rather than
  one hard-coded Chaser; Dasher target and line lock at wind-up; dash movement and wall stun are
  server-owned; no hostile-projectile or status abstraction lands before a consumer.
- **Tests:** path determinism/node cap/repath cadence, roster spawn determinism, Dasher wall impact,
  target locking and switching with two and eight players, protocol reconciliation, visible
  telegraph, Phase 0 route regression, performance scenario, and all gates.
- **Migration impact:** none.
- **Rollback:** revert the Phase 1 checkpoint to the accepted enlarged Chaser/Warden arena.
- **Acceptance:** Chaser and Dasher are distinguishable and independently fightable; both navigate
  correctly with two and eight players; the Dasher has readable counterplay; navigation stays within
  the Phase 1 cost allocation; Phase 0 margins remain at least 40%.

### M7A.3 — Phase 2: hostile-projectile pool and Standard Shooter

- **Files to change:** Shooter content and tests; hostile-projectile simulation/caps and tests;
  protocol projectile views; server state/sync; client projectile/telegraph rendering; focused
  integration and E2E tests.
- **Invariants:** Shooter reuses accepted Phase 1 navigation; its target and aim line lock during
  wind-up; hostile projectiles carry explicit affiliation/source rather than a player `ownerId`;
  caps are 8/source, 32/room, and 8/attack; no status abstraction lands without a consumer.
- **Tests:** preferred-distance/line-of-sight cell choice, target switching between committed shots,
  locked telegraph, server-owned collision/damage, hostile attribution, source/room/attack cap
  saturation with eight players, Phase 0/1 route regression, performance scenario, and all gates.
- **Migration impact:** none.
- **Rollback:** revert Phase 2 and retain the accepted Chaser/Dasher game and navigation primitive.
- **Acceptance:** Shooter is independently fightable in the Phase 1 mixed roster; hostile shots are
  readable and cannot enter player cap or hit-credit paths; all hostile caps have adversarial
  evidence; Phase 0/1 margins remain at least 40%.

### M7A.4 — Phase 3: shared statuses, Shield/Tank, and Grenadier

- **Files to change:** enemy/status/projectile content and simulation modules plus caps tests;
  protocol, `MatchState`, sync, `MatchRoom`, renderer, integration tests, browser tests, and contract
  docs for newly published hostile/status state.
- **Invariants:** one shared status primitive lands with Tank/Grenadier; status overflow is bounded
  and deterministic; hostile projectile caps are 8/source and 32/room; player cap 7 remains per
  player; Tank never reflects; Grenadier circles remain visible and bounded; all damage is server-owned.
- **Tests:** frontal/side/back guard geometry, five-second guard cooldown, attacker-specific stun,
  ranged absorption without reflection, grenade wall-ignoring flight, locked landing AoE, poison
  ticks/refresh/expiry/overflow, eight-player cap saturation, hostile attribution, readability,
  performance, timing routes, and all gates.
- **Migration impact:** none.
- **Rollback:** revert Phase 3 without changing the accepted Phase 2 roster or arena.
- **Acceptance:** Tank and Grenadier are playable in a mixed eight-player room; every cap and status
  rule has adversarial evidence; no Phase 0/1/2 browser budget falls below 40%; total mean tick remains
  no more than 0.479 ms and measured max no more than 5 ms in the defined load.

### M7A.5 — Phase 4: Juggernaut and Hive Mother

- **Files to change:** `packages/game-content/src/boss.ts` and tests; boss strategy/world/simulation
  modules and tests; arena boss encounter definitions; protocol/state/sync/rendering; server and
  browser boss tests; `docs/CONTENT_AUTHORING.md`, `docs/PROTOCOL.md`, and `docs/TEST_PLAN.md`.
- **Invariants:** boss choice is data-driven but new dash/warp/summon/trap/homing strategies are
  engine primitives, not definition conditionals hidden in content; one boss per encounter unless a
  separately bounded content rule changes that; Hive summons, traps, statuses, and shots use room
  caps; Juggernaut satisfies §14.3; Warden behavior remains a regression target.
- **Tests:** all four Juggernaut attacks/phase/cooling states against several players; Hive maximin
  anchor choice, valid warp points, summon cap, slow/poison, destructible homing shots, target locks,
  phase change, Warden regression, eight-player performance, route/margin audit, and all gates.
- **Migration impact:** none.
- **Rollback:** revert Phase 4 and ship the accepted four-enemy Phase 3 game; no boss-core or account
  data changes are involved.
- **Acceptance:** both bosses are readable, bounded, and playable by two to eight players; all
  ordinary and boss definitions select behavior through content; no cap is weakened; the final
  performance and margin budgets pass; the game remains independently playable.

### M7A.6 — Final contracts and evidence

- **Files to change:** only affected docs and test documentation after implementation facts exist.
- **Invariants:** no planned claim is presented as shipped before its phase lands; measured counts
  and timings replace estimates; D71 remains Reserved until all five phases are delivered.
- **Tests:** decision-reference integrity plus the seven gates; compare test counts to the previous
  accepted phase and explain every intentional addition.
- **Migration impact:** none.
- **Rollback:** documentation can return to the last accepted phase record without altering runtime.
- **Acceptance:** contract docs match shipped state; every deferment still says why; final test and
  margin tables contain real results; all contradictions found during implementation are resolved or
  listed as unresolved.

---

## §4. Definition of done for M7A

All five phases are delivered and independently evidenced; D71 is marked Approved in place; M7A's
issue and execution-plan statuses say Delivered; the six selected definitions are playable with two
to eight clients; the Chaser and Warden remain regression-covered; the projectile, status,
navigation, readability, performance, route, and art-gap decisions above are reflected in shipped
contracts; no deferred design, PvP rule, player parry, dependency, migration, or art asset slipped in.
