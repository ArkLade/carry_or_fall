# M1 Issue List — Local Single-Player Combat

Status: **Planned** (not started). The bounded task list for milestone **M1**, per the technical
plan §38 (M1) and M0 deliverable item 10 ("first milestone issue list"), and concept Prototype
Tier 1 (§27.1). M1 is implemented **after** M0; do not start it until M0 is accepted.

## Scope

**Deliver (technical plan §38 M1):** player movement, aim, a sword, a bow, one enemy, health,
death, and basic map collision — playable **locally, with no network**.

**Exit criteria (technical plan §38 M1):**

- Combat is playable locally.
- Tests cover combat math.
- No network is required.

**Explicitly out of M1** (later milestones): Colyseus rooms / networking (M4), loot, six-slot
inventory, secure slot, five-category points, extraction (M2), skills and the wildcard slot (M3),
the boss (M7), accounts / Supabase / persistence (M5), PvP and parties (M4/M6), mobile controls,
and client prediction. Do not build empty service layers for these.

## Architectural constraints (apply to every issue)

- **Author combat as shared, deterministic simulation in `packages/simulation-core`**, consumed by
  the client. M1 is local, but M4 makes the same logic authoritative on the server — write it once
  so it is reused, not rewritten (concept §38 guidance; technical plan §9.3 fixed step, §13.1 shared
  pipeline).
- **Weapons/enemies are data** in `@carry-or-fall/game-content` (see `docs/CONTENT_AUTHORING.md`),
  not hard-coded into the engine.
- **Hard caps live in shared code** (`simulation-core`), enforced there, never only in data (concept
  §9.5; technical plan §13.4).
- **Strict TypeScript, no unchecked inputs.** Use a fixed simulation step; never advance
  authoritative state by arbitrary client frame time (technical plan §9.3).
- **Structure the client** beyond the single boot scene: add a play scene; keep networking code out
  of M1 entirely.
- Each issue must pass the standard gates (`pnpm format:check`, `pnpm lint`, `pnpm typecheck`,
  `pnpm test`, `pnpm build`) and add tests for any meaningful rule it introduces
  (`docs/TEST_PLAN.md`).

---

## Issues

Issues are written in the technical plan §28 task format. Land them roughly in order; several are
independent once the loop (M1.1) and weapon data (M1.2) exist.

### M1.1 — Play scene and fixed-step local game loop

- **Goal:** A `PlayScene` (beyond `BootScene`) running a fixed-timestep update loop that drives the
  shared simulation and renders it.
- **Context:** M1 is single-player and local; the loop advances `simulation-core` at a fixed step
  (e.g. 50 ms, technical plan §9.3) and Phaser renders the resulting state each frame.
- **Requirements:**
  1. Add a `PlayScene`; boot into it (directly or from `BootScene`) for local play.
  2. Advance the simulation on a fixed step decoupled from render frame rate.
  3. Keep all state in a simulation world object the renderer reads; no game rules in the renderer.
- **Non-goals:** networking, enemies, combat (later issues).
- **Acceptance:** the scene runs at a stable fixed step; a placeholder player entity renders; gates
  pass.

### M1.2 — Weapon definitions: Basic Sword and Basic Bow

- **Goal:** Add `basic_sword` (melee) and `basic_bow` (ranged) as data in `game-content`.
- **Context:** Data-driven content per `docs/CONTENT_AUTHORING.md` §3; values follow concept §8.1 /
  §29.1, balance deferred to playtesting.
- **Requirements:**
  1. Add `WeaponDefinition` (extending `ContentDefinition`) and the two weapons.
  2. Include `limits` (projectile caps) on both, `0` for the melee weapon.
  3. Export them and add unit tests asserting shape invariants (e.g. ranged has a positive
     `projectileSpeed`; caps are non-negative integers).
- **Non-goals:** armor, additional weapons, wiring into combat (M1.6–M1.8).
- **Acceptance:** definitions typecheck and are covered by tests; no engine code added.

### M1.3 — Player movement (WASD)

- **Goal:** Deterministic top-down movement driven by normalized input.
- **Context:** Movement lives in `simulation-core` and consumes a normalized input intent
  (`moveX`/`moveY` in `-1|0|1`) matching the M1 `InputMessage` shape (`docs/PROTOCOL.md` §6).
- **Requirements:**
  1. Read normalized movement input; apply a capped movement speed on the fixed step.
  2. Movement is computed in shared simulation, not in the renderer.
  3. Diagonal movement does not exceed the speed cap.
- **Non-goals:** dash (optional, M1.S1), collision (M1.5), network reconciliation.
- **Acceptance:** unit tests cover speed cap and diagonal normalization; the player moves in the
  play scene.

### M1.4 — Aiming and facing

- **Goal:** The player aims toward the mouse; facing is derived from an aim angle (radians).
- **Requirements:**
  1. Compute `aimAngle` from pointer position relative to the player.
  2. Store facing in simulation state; render an aim indicator.
  3. Aim is clamped to a valid numeric range.
- **Non-goals:** attacks (M1.7/M1.8).
- **Acceptance:** aim indicator tracks the pointer; angle is finite and normalized; gates pass.

### M1.5 — Map and basic collision

- **Goal:** A compact test map with simple geometry that blocks movement.
- **Context:** Circles for the player, axis-aligned rectangles for walls; no pixel-perfect collision
  (technical plan §12.1).
- **Requirements:**
  1. Represent walls as rectangles and the player as a circle in shared simulation.
  2. Block movement through walls (resolve overlaps deterministically).
  3. Cover collision resolution with unit tests (approach a wall, get blocked; slide along it).
- **Non-goals:** spatial index / quadtree (add only with benchmarking, §12.3), enemy collision
  tuning beyond basics.
- **Acceptance:** the player cannot pass through walls; collision tests pass.

### M1.6 — Shared attack pipeline

- **Goal:** A single reusable attack pipeline in `simulation-core` (technical plan §13.1).
- **Context:** `validate actor → check cooldown → build attack definition → (skills/loot later) →
  enforce hard caps → create melee shape or projectiles → resolve hits → apply damage → emit visual
  event`. M1 uses the subset without skills/loot modifiers.
- **Requirements:**
  1. Implement the pipeline stages as shared functions parameterized by a `WeaponDefinition`.
  2. Enforce the weapon's hard caps in this shared code.
  3. Emit a transient "hit" event for the renderer (a one-shot event, `docs/PROTOCOL.md` §8), not
     persistent state.
- **Non-goals:** skill/loot modifiers (M3/M2), networked events (M4).
- **Acceptance:** melee and ranged both flow through this one pipeline; caps are unit-tested.

### M1.7 — Melee attack (sword)

- **Goal:** The Basic Sword produces an arc attack that damages enemies.
- **Requirements:**
  1. Drive an arc/wind-up/active/recovery attack from `basic_sword` data through the M1.6 pipeline.
  2. Respect the attack interval (cooldown) — inputs during recovery do not attack.
  3. Apply damage and knockback to overlapping enemies during the active window.
- **Non-goals:** stun tuning, combos.
- **Acceptance:** unit tests cover cooldown gating and arc hit detection; the sword hits the enemy in
  the play scene.

### M1.8 — Ranged attack (bow)

- **Goal:** The Basic Bow spawns projectiles that travel, expire, and damage enemies.
- **Requirements:**
  1. Spawn projectiles from `basic_bow` data (speed, count, spread) through the M1.6 pipeline.
  2. Enforce hard caps: no more than `maxProjectilesPerAttack`, and bounce/pierce counts never
     exceed the weapon `limits` (concept §9.5; technical plan §13.4).
  3. Projectiles have a bounded lifespan and are removed when spent.
- **Non-goals:** homing, return, ricochet (skills, M3).
- **Acceptance:** unit tests assert projectiles cannot exceed the caps and expire; the bow hits the
  enemy in the play scene.

### M1.9 — Chaser enemy

- **Goal:** One enemy (the Chaser, concept §14.2) with health that pursues the player and deals
  contact damage.
- **Requirements:**
  1. Add the `chaser` enemy definition in `game-content` (`docs/CONTENT_AUTHORING.md` §6).
  2. Implement "move toward nearest player" behavior in shared simulation.
  3. The enemy takes damage from player attacks, dies at zero health, and is removed.
  4. Enemy spawning uses the seeded PRNG (`createRng`) for reproducibility.
- **Non-goals:** ranged/heavy enemies, boss, loot drops (M2).
- **Acceptance:** the enemy chases, can be killed, and behaves reproducibly under a fixed seed
  (tested); gates pass.

### M1.10 — Player health and death

- **Goal:** The player has health, takes damage, and dies; the local run ends on death.
- **Context:** No same-match respawn (concept §4.4). On death, end the local run and return to the
  boot/menu screen; there is no loot drop or extraction in M1 (that is M2).
- **Requirements:**
  1. Track player health in simulation; apply enemy contact damage.
  2. At zero health, enter a dead state, stop movement/attack processing, and end the run.
  3. Cover damage application and the death transition with unit tests.
- **Non-goals:** loot container on death, secure-slot settlement (M2/M5).
- **Acceptance:** the player can die and the run ends cleanly; tests pass.

### M1.11 — Minimal combat HUD

- **Goal:** Show the essentials: player health and the equipped weapon.
- **Requirements:**
  1. Render a health indicator and the current weapon from simulation state.
  2. HUD reads state only; it contains no game rules.
- **Non-goals:** inventory, skills, minimap, party UI (later HUD per concept §23.1).
- **Acceptance:** the HUD reflects health and weapon during play; gates pass.

### M1.12 — Combat-math test suite

- **Goal:** Consolidated unit coverage of the combat rules M1 introduces (this is the "tests cover
  combat math" exit criterion).
- **Requirements:**
  1. Cover damage, cooldown gating, melee arc hits, projectile caps and expiry, collision blocking,
     and health/death.
  2. Assert real rules, not constants equal to themselves (`docs/TEST_PLAN.md` §3).
  3. Use fixed seeds for any randomness so tests are deterministic.
- **Non-goals:** browser/e2e tests (deferred; §30.3).
- **Acceptance:** `pnpm test` covers the above and passes.

### M1.S1 — (Optional stretch) Basic dash

- **Goal:** The basic dash movement ability (concept §8.4, §13.1, `space`).
- **Context:** Not in the technical plan §38 M1 list; include only if it does not risk the
  milestone. Defer otherwise to when the movement-ability system is built.
- **Requirements:** a cooldown-gated dash in shared simulation, driven by `dashPressed`, with the
  cooldown surfaced on the HUD.
- **Acceptance:** dash respects its cooldown (tested); or the item is explicitly deferred.

---

## Definition of done for M1

- Every issue above (excluding the optional stretch) is complete and its tests pass.
- All gates pass: `pnpm format:check`, `pnpm lint`, `pnpm typecheck`, `pnpm test`,
  `pnpm test:integration` (unchanged from M0), and `pnpm build`.
- Combat is playable locally in the browser with no server running, and a human has playtested it
  (technical plan §45) — the suite proves the math, not that it is fun.
- No out-of-scope systems (networking, loot, inventory, extraction, skills, accounts) were added.
- Documentation updated where behavior or structure changed (`DEVELOPMENT_RULES.md`), including
  `docs/PROTOCOL.md` if the input message is formalized and `docs/CONTENT_AUTHORING.md` if content
  fields change.


## Known deferred defects

### D-1. Projectiles do not collide with walls — RESOLVED

Found by manual play testing after the attack pipeline was implemented. A bow
projectile passed through interior walls, and at the outer boundary it was
despawned rather than colliding. The player character collided with walls
correctly, so the defect was specific to projectiles.

Technical plan §12.1 places projectiles in the same collision system as actors
(circles for actors and projectiles, AABB for walls). Projectiles were
outside that path.

**Fix:** `combat/ranged.ts`'s `stepProjectiles` now sweeps each projectile's
per-step travel against the spatial grid via `collision.ts`'s
`sweptCircleIntersectsWall` (see D-2 below — one shared root cause, one
shared fix). A projectile whose swept path this step crosses any wall
(interior or boundary — both are just `Wall` entries in the same grid) is
removed before target-hit resolution runs, so a wall between the shooter and
a target now protects that target rather than merely despawning the
projectile cosmetically after the fact. No bounce was added: per concept
§29.2, bounces are the `ricochet` skill's effect (M3), not base-weapon
behavior, and the §13.4 value of 3 is a ceiling, not a default. `basic_bow`
projectiles stop at a wall.

Consequences that no longer apply:

- ~~Ranged combat is trivially safe, because there is no line of sight to
  break.~~ Line of sight is now real: a wall blocks a shot.
- **The §13.4 bounce cap still does not exercise a code path reachable from
  running gameplay.** `clampBounceCount`/`MAX_BOUNCES` (`combat/caps.ts`) are
  not called by any weapon or pipeline stage — no mechanic produces a bounce
  yet (that is M3's `ricochet` skill). Its test (`caps.test.ts`) still only
  exercises the standalone cap-enforcement function directly, same as before
  this fix. This is expected, not a regression: this task deliberately did
  not add bounce behavior.

Regression tests: `packages/simulation-core/src/combat/ranged.test.ts`
("stepProjectiles: wall collision (D-1, resolved)") and
`packages/simulation-core/src/simulation.test.ts` ("swept wall collision
fixes D-1 and D-2").

### D-2. A large enough dash can tunnel through a thin wall — RESOLVED

Found while adding the dash (M1.S1). Wall collision (`collision.ts`,
`resolveAxisMovement`) was a **discrete** check: it tested only the candidate
landing position against the spatial grid's walls, with no swept/continuous
check along the path between the old and new position. Ordinary per-step
movement was small enough (`PLAYER_SPEED * SIMULATION_DT_SECONDS` ≈ 11px at
220px/s and 50ms) that this never mattered, but the dash moves the player
`DASH_DISTANCE_PX` (140px) in a single step — larger than the compact test
map's wall thickness (20px) — so a dash aimed squarely at a thin wall could
land past it without ever being detected as colliding.

**Fix — the same root cause as D-1, fixed once:** `resolveAxisMovement` now
queries the spatial grid over the swept bounding box of the whole move (not
just the landing position) and tests each candidate wall with the new
`sweptCircleIntersectsWall(start, end, radius, wall)` instead of the old
discrete `circleIntersectsWall(candidatePosition, wall)`. This one function
is the single swept-collision path shared by ordinary movement, the dash, the
chaser's movement, and (via `stepProjectiles`) projectiles — not two separate
patches. It is an exact circle-vs-AABB sweep (Minkowski-sum decomposition:
the wall expanded by the radius on each flat side, plus a radius-distance
check against each of its four corners), so it introduces no new false
positives/negatives beyond what the previous discrete check already had at a
single point in time.

Regression test:
`packages/simulation-core/src/simulation.test.ts` ("[D-2 regression] does not
tunnel through a wall thinner than DASH_DISTANCE_PX (140px)").