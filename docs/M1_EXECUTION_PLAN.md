# M1 Execution Plan — Local Single-Player Combat

This plan is followed during M1 implementation. M1 delivers local, single-player combat: player
movement, aim, a sword, a bow, one enemy, health, death, and basic map collision — playable in the
browser with **no network** (technical plan
`docs/browser_multiplayer_game_technical_plan_verified_v2.md` §38 M1). It follows the execution-plan
format required by that plan §26.3 (files to change, invariants, tests, migration impact, rollback,
acceptance criteria) and uses `docs/M0_EXECUTION_PLAN.md` as its structural model. It must stay
consistent with `docs/M1_ISSUES.md`; §9 maps every issue to a section here.

Authoritative sources: `docs/lightweight_multiplayer_extraction_roguelite_game_concept.md`
(gameplay/scope) and `docs/browser_multiplayer_game_technical_plan_verified_v2.md`
(architecture/technology/testing). Durable rules: `docs/DEVELOPMENT_RULES.md`. Approved technology:
`docs/DECISIONS.md`. Derived contracts: `docs/PROTOCOL.md`, `docs/CONTENT_AUTHORING.md`,
`docs/TEST_PLAN.md`.

Write no implementation code from this plan alone; it is the design for the M1 work, to be reviewed
before coding.

## 1. Scope and scope resolution

**Deliver (technical plan §38 M1):** movement, aim, sword, bow, one enemy, health, death, basic map
collision — local, no network.

**Exit criteria (technical plan §38 M1):** combat is playable locally; tests cover combat math; no
network required.

### Scope resolution (restated and upheld)

The concept document's Prototype Tier 1 "Local Combat" (concept §27.1) lists more than the technical
plan's M1: it also includes loot pickup, a six-slot inventory, a secure slot, and basic extraction.
The technical plan is authoritative for milestone boundaries (`docs/DEVELOPMENT_RULES.md`,
"Authoritative documents"), and its §38 **M2** — not M1 — owns loot drops, the six-slot inventory,
the five point categories, the secure slot, and rotating extraction. **Therefore loot, inventory,
secure slot, and extraction are out of M1.** This matches `docs/M1_ISSUES.md` ("Explicitly out of
M1") and the resolution recorded in that document; this plan restates and stands behind it.

**Dash** is an **optional stretch item** (M1.S1). Every player is meant to begin with a basic dash
(concept §8.4) and the desktop controls include `space: dash` (concept §13.1), but the technical
plan §38 M1 list does not include it. Include dash only if it does not risk the milestone; otherwise
defer it to when the movement-ability system is built.

## 2. Architecture

### 2.1 One seam: client → local simulation

All combat and movement simulation lives in `packages/simulation-core` as a **headless, fixed-step**
module. The Phaser client captures input as intent and renders state; it decides no outcomes even
with no server present (technical plan §5.1; `docs/DEVELOPMENT_RULES.md`, "Architecture and
authority"). There is **exactly one seam** between the client and the simulation: the client calls a
local simulation runner (a single call site). No network abstraction and no speculative service
layer are introduced — `docs/DEVELOPMENT_RULES.md` ("Scope discipline") forbids empty layers for
features that do not exist yet. At M4 that single call site becomes the authoritative room boundary
(technical plan §38 M4), which is precisely why the simulation must not live in Phaser scene
`update` code.

### 2.2 Fixed-step loop

The simulation advances only in fixed `simulation_dt = 50 ms` steps (technical plan §9.3). The
render loop reads simulation state each frame but never advances authoritative state by a render
frame delta ("Do not calculate authoritative movement using arbitrary client frame times", §9.3).
The client accumulates elapsed time and steps the simulation zero or more whole steps per frame.

### 2.3 Collision

Actors and projectiles are circles; walls are axis-aligned bounding boxes (technical plan §12.1,
which specifies circles for players/projectiles and axis-aligned rectangles for walls, and to avoid
pixel-perfect collision). Broad-phase uses a **simple spatial grid** so the simulation does not
compare every object against every other (technical plan §12.3). No physics engine and no new
dependency are added — physics engines are on the forbidden list (`docs/M0_EXECUTION_PLAN.md` §3;
`docs/DEVELOPMENT_RULES.md`, "No unapproved frameworks"); a more complex structure is added only
with benchmarking (§12.3).

### 2.4 Attack pipeline

Every attack passes through the shared pipeline of technical plan §13.1 as an **actual pipeline**,
even where stages are pass-throughs in M1:

```
validate actor → check cooldown → build attack definition → apply equipped skills (pass-through in
M1) → apply carried-loot modifiers (pass-through in M1) → enforce hard caps → create melee shape or
projectiles → resolve hits → apply damage/status → emit one-shot visual event
```

The skill stage is filled in at M3 and the carried-loot stage at M2; keeping them as explicit
pass-through stages now avoids reworking the pipeline later.

### 2.5 Determinism

All randomness in the simulation uses the existing seeded PRNG (`packages/simulation-core/src/prng.ts`,
`createRng`) so combat and spawning are reproducible (technical plan §9.4: use a controlled
pseudo-random generator; reproducible seeded tests are strongly recommended). `Math.random` must not
appear in simulation code.

### 2.6 Version exchange

M1 adds the `InputMessage` type and the post-join message-type constant to `packages/protocol`,
matching the shape already documented in `docs/PROTOCOL.md` §6 (and technical plan §10.2). The
**content version stays Reserved** — there is no compatibility gate on it in M1 (`docs/PROTOCOL.md`
§3). The protocol version stays `1`; M1 transmits nothing over a network, so this is a
backward-compatible type addition (`docs/PROTOCOL.md` §9).

## 3. Files to change (§26.3)

Legend: **(new, proposed)** = a file that does not exist yet, whose path/name is this plan's
proposal (not in repo); **(modify)** = an existing repo file to edit; **(unchanged)** = called out
because a reader might expect it to change but it must not.

```
packages/simulation-core/src/
├─ index.ts                 (modify)  export the public simulation API — the single seam surface
├─ world.ts                 (new, proposed)  world + entity types (Vec2, Player, Enemy, Projectile, Wall, World, InputState)
├─ simulation.ts            (new, proposed)  createSimulation()/stepSimulation(); SIMULATION_DT = 50
├─ movement.ts              (new, proposed)  normalized movement, speed cap, diagonal normalization
├─ collision.ts             (new, proposed)  circle/AABB tests + spatial grid
├─ combat/pipeline.ts       (new, proposed)  the §13.1 pipeline (stages, pass-throughs)
├─ combat/caps.ts           (new, proposed)  §13.4 hard-cap constants + clamps
├─ combat/melee.ts          (new, proposed)  arc/wind-up/active/recovery melee resolution
├─ combat/ranged.ts         (new, proposed)  projectile spawn/step/expiry
├─ enemy.ts                 (new, proposed)  chaser behavior (move toward nearest player)
├─ events.ts                (new, proposed)  one-shot event data (hit, death) — plain data, not networked
├─ prng.ts / version.ts     (unchanged)  reused as-is (createRng, SIMULATION_RULESET_VERSION)
└─ *.test.ts                (new, proposed)  movement, collision, caps, melee, ranged, enemy, health/death, determinism

packages/game-content/src/
├─ index.ts                 (modify)  re-export weapons + enemies (plus existing ContentDefinition base)
├─ weapons.ts               (new, proposed)  WeaponDefinition + basic_sword + basic_bow
├─ enemies.ts               (new, proposed)  EnemyDefinition + chaser
└─ weapons.test.ts / enemies.test.ts  (new, proposed)  shape-invariant tests

packages/protocol/src/
└─ messages.ts              (modify)  add InputMessage and the input message-type constant (per docs/PROTOCOL.md §6)

apps/client/src/
├─ main.ts                  (modify)  register the play scene; boot into it for local play
├─ scenes/PlayScene.ts      (new, proposed)  capture input, drive the local simulation, render state + HUD
├─ input/keyboard.ts        (new, proposed)  WASD + mouse → InputMessage/InputState intent
├─ render/world-view.ts     (new, proposed)  render player/enemy/projectiles/walls from simulation state
├─ hud/combat-hud.ts        (new, proposed)  health + equipped-weapon HUD (reads state only)
└─ scenes/BootScene.ts      (unchanged)  retained for the networked entry point reused at M4

docs/
├─ PROTOCOL.md              (modify)  mark InputMessage as implemented once formalized (per M1_ISSUES DoD)
├─ CONTENT_AUTHORING.md     (modify)  only if a content field changes from the documented shape
├─ M1_ISSUES.md             (modify)  tick issues / note the M1.S1 dash decision when taken
└─ DECISIONS.md             (modify)  only if a new decision is needed (e.g. the sim-in-core seam), otherwise unchanged

Explicitly unchanged in M1:
- apps/server/**        no network in M1 (server work is M4)
- .github/**            CI unchanged; new tests run under the existing `pnpm test`
- package.json / pnpm-lock.yaml   no new dependency (Phaser is already present)
- .env / .env.example   no new configuration
```

All new module names above are **proposed (not in repo)**; the packages they live in
(`simulation-core`, `game-content`, `protocol`, `apps/client`) exist today.

## 4. Content definitions and provenance

Sword, bow, and the enemy are data definitions in `packages/game-content`, consumed by the engine —
not hard-coded behavior (`docs/DEVELOPMENT_RULES.md`, "Content is data-driven";
`docs/CONTENT_AUTHORING.md`). Their shapes follow `docs/CONTENT_AUTHORING.md` §3 (`WeaponDefinition`)
and §6 (`EnemyDefinition`).

Provenance of values — stated explicitly per this task's requirement:

- **`basic_bow`** — its stats trace to the concept document §29.1 (id `basic_bow`, ranged, tag
  `Projectile`, damage `10`, attack interval `650 ms`, projectile speed `600`, projectile count `1`,
  spread `0`; hard limits max projectiles `8`, max bounces `3`, max pierces `3`). These are recorded
  in `docs/CONTENT_AUTHORING.md` §3.
- **`basic_sword`** — **does not appear in concept §29.1.** The concept describes it only
  qualitatively (§8.1: "balanced melee weapon, medium attack arc, medium attack speed, moderate
  damage"). Its numeric values (damage, interval, range, arc, wind-up/active/recovery, knockback) are
  **proposed (not in repo)**; the illustrative numbers in `docs/CONTENT_AUTHORING.md` §3 are proposed
  and explicitly balance-deferred (concept §12.3).
- **`chaser`** — the enemy is described qualitatively in concept §14.2 ("moves directly toward the
  nearest player; basic contact or melee damage; low complexity"). Its numeric values (health, move
  speed, contact damage) are **proposed (not in repo)** (illustrated in `docs/CONTENT_AUTHORING.md`
  §6, balance-deferred).

Exact balance for every proposed value is deferred to playtesting (concept §12.3; §30 balance
tests). M1 asserts structural invariants and rule behavior, not specific balance numbers.

## 5. Protocol additions

Per `docs/PROTOCOL.md` §6 and technical plan §10.2, M1 adds to `packages/protocol/src/messages.ts`:

```ts
export interface InputMessage {
  readonly sequence: number;
  readonly moveX: -1 | 0 | 1;
  readonly moveY: -1 | 0 | 1;
  readonly aimAngle: number; // radians
  readonly attackPressed: boolean;
  readonly dashPressed: boolean;
  readonly interactPressed: boolean;
}
```

and the string-literal message-type constant for `input` (the "first post-join message" anticipated
in `docs/PROTOCOL.md` §6). In M1 this type is consumed **in-process** by the simulation and produced
by the client input layer; it is not transmitted over a socket (there is no network). Its
**runtime validator** (`validateInputMessage`, range/frequency checks per technical plan §10.2) is
**deferred to M4**, when an untrusted network boundary exists to guard — adding a validator with no
boundary to protect in M1 would be an empty layer (`docs/DEVELOPMENT_RULES.md`, "Scope discipline").
This is the one clarification this plan makes to the M1_ISSUES definition-of-done wording "adds the
InputMessage" (see §9).

`interactPressed` and `dashPressed` are carried in the shape now (the shape is shared with M4) even
though interact is unused until M2 and dash is the optional stretch (M1.S1); they are part of the
documented `InputMessage`, not new fields.

## 6. Invariants (§26.3)

These must hold at every commit during M1:

1. **Fixed step.** The simulation advances only in `SIMULATION_DT = 50 ms` increments; nothing
   advances authoritative state by a render delta (technical plan §9.3).
2. **Headless simulation.** No game rule executes in Phaser scene code; all rules live in
   `packages/simulation-core` (technical plan §38 M4 reuse; `docs/M1_ISSUES.md` M1.1).
3. **Client decides no outcomes.** The client captures intent and renders; it never sets position,
   damage, health, or death, even with no server (technical plan §5.1;
   `docs/DEVELOPMENT_RULES.md`).
4. **One seam, no speculative layers.** Exactly one client→simulation call site; no network
   abstraction or empty service layer (`docs/DEVELOPMENT_RULES.md`, "Scope discipline"). That call
   site is what becomes the room boundary at M4.
5. **Content is data.** Sword, bow, and the enemy are `game-content` definitions read by the engine;
   no per-item behavior is hard-coded (`docs/DEVELOPMENT_RULES.md`; `docs/CONTENT_AUTHORING.md`).
6. **Caps in shared code, tested.** The §13.4 hard caps (see §7) are enforced in
   `simulation-core` and covered by tests, never only in data (`docs/DEVELOPMENT_RULES.md`,
   "Preserve projectile and effect safety caps"; concept §9.5).
7. **Determinism.** Identical seed + identical inputs produce identical simulation output; all
   randomness flows through `createRng` (technical plan §9.4). No `Math.random` in the simulation.
8. **Real pipeline.** Attacks flow through the §13.1 pipeline with the skill and carried-loot stages
   present as pass-throughs (technical plan §13.1).
9. **Collision geometry.** Circles for actors/projectiles, AABB for walls, spatial-grid broad phase;
   no physics engine, no new dependency (technical plan §12.1, §12.3).
10. **Content version Reserved.** No compatibility gate on content version in M1
    (`docs/PROTOCOL.md` §3).
11. **Strict TypeScript, validated inputs.** No implicit `any`, no unchecked payloads
    (`docs/DEVELOPMENT_RULES.md`; `docs/M0_EXECUTION_PLAN.md` §4).
12. **Scope fence.** No loot, inventory, secure slot, extraction, skills, wildcard, boss,
    networking, accounts, or persistence (§1; deferred to M2–M7).

## 7. Hard caps (§13.4) — implemented in shared code with tests

Per technical plan §13.4 and concept §9.5, the following live in `packages/simulation-core`
(proposed `combat/caps.ts`) and each has a test asserting the cap holds:

- No more than **8** primary projectiles per attack.
- No more than **3** bounces.
- No more than **3** pierces.
- No projectile returns more than once.
- Split projectiles cannot split again.
- Child projectiles cannot create parent effects recursively (no recursive child effects).
- A per-player **active projectile cap**.
- A **bounded target-search radius**.

M1 ships weapons with no bounce/pierce/return/split behavior (the bow fires straight), but the caps
exist and are enforced now so a later skill (M3) cannot uncap a weapon. A weapon's own `limits`
(e.g. `basic_bow` max projectiles `8`, bounces `3`, pierces `3`, from concept §29.1) are a ceiling
clamped by these global caps and can never exceed them (`docs/CONTENT_AUTHORING.md` §3, §8).

## 8. Tests (§26.3)

All M1 tests are **unit** tests in `packages/*/src/**/*.test.ts`, run by `pnpm test` (the Vitest
`unit` project; `docs/TEST_PLAN.md` §2.1). They cover combat math per the §38 M1 exit criterion and
follow `docs/TEST_PLAN.md` §1/§3 — assert real rules, never a constant equal to itself; type
checking is a separate `pnpm typecheck`.

- **Movement** — speed cap respected; diagonal input does not exceed the cap.
- **Collision** — a player approaching a wall is blocked; sliding along a wall works; circle/AABB
  overlap is correct.
- **Attack pipeline / cooldown** — inputs during recovery do not attack; the interval gates attacks.
- **Melee** — arc hit detection during the active window; damage and knockback apply to overlapping
  enemies.
- **Ranged** — projectiles spawn from data, travel, and expire; the §7 caps cannot be exceeded.
- **Enemy (chaser)** — moves toward the nearest player; takes damage; dies and is removed;
  reproducible under a fixed seed.
- **Health / death** — damage reduces health; zero health enters the dead state and ends the run.
- **Content shape** — `basic_sword`/`basic_bow`/`chaser` definitions satisfy their shape invariants
  (e.g. ranged has a positive `projectileSpeed`; caps are non-negative integers).

`pnpm test:integration` and the production-build tests are unchanged from M0 and must stay green.
Browser end-to-end (Playwright) remains deferred (`docs/TEST_PLAN.md` §2.3); M1 uses a manual local
playtest for feel (technical plan §45).

## 9. Issue → plan mapping (`docs/M1_ISSUES.md`)

| Issue (`docs/M1_ISSUES.md`) | Covered by this plan                                  |
| --------------------------- | ----------------------------------------------------- |
| M1.1 Play scene + fixed loop | §2.1, §2.2; `PlayScene`, `simulation.ts` in §3        |
| M1.2 Weapon definitions      | §4; `weapons.ts` in §3                                |
| M1.3 Player movement         | §2.2, §6(1); `movement.ts` in §3; `InputMessage` §5   |
| M1.4 Aiming and facing       | §5 (`aimAngle`); `input/`, `render/` in §3            |
| M1.5 Map and basic collision | §2.3; `collision.ts` in §3                            |
| M1.6 Shared attack pipeline  | §2.4; `combat/pipeline.ts` in §3                      |
| M1.7 Melee attack (sword)    | §2.4, §4; `combat/melee.ts` in §3                     |
| M1.8 Ranged attack (bow)     | §2.4, §7; `combat/ranged.ts`, `combat/caps.ts` in §3  |
| M1.9 Chaser enemy            | §2.5, §4; `enemy.ts`, `enemies.ts` in §3              |
| M1.10 Player health and death | §6(3); `simulation.ts` / world state in §3            |
| M1.11 Minimal combat HUD     | §3 (`hud/combat-hud.ts`)                              |
| M1.12 Combat-math test suite | §8                                                    |
| M1.S1 Basic dash (stretch)   | §1 (optional); `dashPressed` reserved in §5           |

**Scope changes to the issues:** the plan does not reduce or expand any issue's deliverable. Two
clarifications:

- **M1.1 boot flow.** M1_ISSUES M1.1 allows booting into the play scene "directly or from
  `BootScene`". This plan chooses: **boot into `PlayScene` for local M1 play, and retain `BootScene`
  unchanged** for the networked entry point reused at M4 (§3). This is a choice within the issue's
  stated latitude, not a scope change.
- **M1 protocol scope.** M1_ISSUES' definition of done says to add "the InputMessage" to
  `packages/protocol`. This plan adds the **type and message-type constant** in M1 and **defers the
  runtime `validateInputMessage` validator to M4** (§5), because M1 has no untrusted boundary for it
  to guard and a validator without a consumer would be an empty layer
  (`docs/DEVELOPMENT_RULES.md`). This narrows "adds the InputMessage" to "adds the InputMessage type
  and constant"; called out here for the reviewer.

## 10. Migration impact (§26.3)

- **Dependencies:** none added; `pnpm-lock.yaml` is unchanged. Phaser (`phaser@4.2.1`) and Vitest are
  already present (`docs/M0_EXECUTION_PLAN.md` §3). No physics engine or other framework
  (`docs/DEVELOPMENT_RULES.md`).
- **Existing tests / CI:** the M0 unit tests, the `foundation_room` integration tests, and the
  production-build tests are unchanged and must keep passing. The CI workflow (`.github/workflows/ci.yml`)
  is unchanged; the new unit tests run under the existing `pnpm test` step
  (`docs/M0_EXECUTION_PLAN.md` §7).
- **Server:** untouched. M1 adds no network, so the authoritative Colyseus server, `foundation_room`,
  and health endpoint are unchanged (server-authoritative gameplay is M4, technical plan §38 M4).
- **Protocol:** the `InputMessage` type + constant are an additive, backward-compatible change;
  `PROTOCOL_VERSION` stays `1` because nothing new is transmitted over the wire in M1
  (`docs/PROTOCOL.md` §9). Revisit the version when M4 transmits input.
- **Client entry behavior:** the default scene becomes `PlayScene` (local play) instead of the M0
  connection/health `BootScene` view; `BootScene` is retained for M4. This is a user-visible behavior
  change and is documented in the same change (`docs/DEVELOPMENT_RULES.md`, "Documentation").
- **Docs:** `docs/PROTOCOL.md` moves `InputMessage` from "forward-looking" to implemented once the
  type lands; `game-content` package description and `docs/CONTENT_AUTHORING.md` are updated only if a
  field differs from what is already documented.
- **No data or infrastructure migration:** M1 has no database, schema, or deployment surface
  (`docs/DECISIONS.md` D16, D22).

## 11. Rollback (§26.3)

M1 is **additive** on top of M0; nothing is committed unless explicitly requested.

- To back out, delete the new `simulation-core` modules (§3), the new `game-content` weapon/enemy
  modules, and the new client `PlayScene`/input/render/HUD files; revert the additive edit to
  `packages/protocol/src/messages.ts` and the `apps/client/src/main.ts` scene registration; and
  revert any doc edits. The repo returns to the M0 state.
- There are **no migrations, no persisted data, and no infrastructure** to undo (§10).
- If M1 work was committed to a branch, revert with `git revert <sha>` or reset the branch; never
  force-push or rewrite shared history (mirrors `docs/M0_EXECUTION_PLAN.md` §10).

## 12. Acceptance criteria (§26.3)

Matching the technical plan §38 M1 exit criteria, plus the repository gates:

- **Combat is playable locally** in the browser with **no server running** — move, aim, swing the
  sword, fire the bow, fight and kill the one enemy, take damage, and die (technical plan §38 M1).
- **Tests cover combat math** — the §8 unit suite is green (`pnpm test`), asserting real rules and
  deterministic under fixed seeds (`docs/TEST_PLAN.md` §1, §3).
- **No network is required** — the server is not started for M1 play; no networking code is added
  (technical plan §38 M1).
- All gates pass: `pnpm format:check`, `pnpm lint`, `pnpm typecheck`, `pnpm test`,
  `pnpm test:integration` (unchanged from M0), and `pnpm build`
  (`docs/M1_ISSUES.md` "Definition of done").
- Hard caps (§7) are enforced in shared code and tested; content (§4) is data-driven; and no
  out-of-scope system (loot, inventory, secure slot, extraction, skills, networking, accounts) was
  added (§1, §6).
- A human has playtested the local build for feel — the suite proves the math, not that it is fun
  (technical plan §45; `docs/M1_ISSUES.md` "Definition of done").

If M1 playtesting shows combat is not readable or survivable without a dash, M1.S1 is promoted into M1 and implemented before M1 is declared done.

## 13. Carried-over unresolved issues from the M0 defect-fix work

Recorded here so they live in the repo, not only in a chat log. Where already recorded, this
references that location instead of duplicating:

1. **Global CORS origin reflection on non-`/health` routes.** Colyseus's router reflects any request
   origin by default; only `/health` currently enforces the allowlist. Broader origin hardening
   across all HTTP routes (and OPTIONS preflight) is deferred to the deployment milestone (technical
   plan §20.3). **Already recorded:** `docs/DECISIONS.md` D19.
2. **Client bundle size (~1.49 MB) and deferred code-splitting.** The production client bundle is
   dominated by Phaser; Vite emits a chunk-size warning. Code-splitting is deferred (not required for
   local play). **Not previously recorded in `docs/`; recorded here.** Revisit at the client
   deployment milestone (asset delivery, technical plan §36; client hosting, §38 M8).
3. **`node dist/index.js` does not resolve `../../.env` outside the `start` script.** Running the
   built server from a different working directory will not find the root `.env`; use the server
   `start` script (run from the server package). **Already recorded:** `docs/DECISIONS.md` D20.
4. **Corepack PATH / `EPERM` requirement.** The `pnpm` shims require `corepack enable` (which needs a
   writable install dir on Windows, or `corepack pnpm …`). **Already recorded:** `README.md`
   ("Prerequisites" and "Troubleshooting").

None of these block M1; M1 adds no HTTP routes, no deployment, and no server changes.

## 14. Assumptions

- The technical plan is authoritative for milestone boundaries where it and the concept document's
  tiers differ (§1; `docs/DEVELOPMENT_RULES.md`, "Authoritative documents").
- Proposed module/file names in §3 and proposed numeric values in §4 are subject to change during
  implementation and review; only the invariants (§6), caps (§7), and acceptance criteria (§12) are
  fixed commitments. Proposed items are labeled "proposed (not in repo)".
- Phaser scene structure supports a dedicated `PlayScene` alongside the existing `BootScene`; the
  existing client boots a single `BootScene` today (`apps/client/src/main.ts`).
- The existing seeded PRNG (`packages/simulation-core/src/prng.ts`) is sufficient for M1 combat
  randomness; no additional randomness primitive is needed (technical plan §9.4).
- No new dependency is required to meet M1; if implementation reveals one, it needs a new entry in
  `docs/DECISIONS.md` before adoption (`docs/DEVELOPMENT_RULES.md`, "No unapproved frameworks").

## 15. Non-goals

M1 implements none of the following (deferred to the stated milestone): loot, six-slot inventory,
secure slot, five point categories, extraction (M2); skills and the wildcard slot (M3); Colyseus
rooms, authoritative server combat, PvP, other players (M4); accounts, Supabase, persistence (M5);
parties/matchmaking (M6); the boss and boss-core (M7); deployment (M8+); mobile controls; and client
prediction. No empty service layers are created for any of these (`docs/DEVELOPMENT_RULES.md`, "Scope
discipline").
