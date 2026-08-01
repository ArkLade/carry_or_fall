# M4 Execution Plan — Authoritative Multiplayer

This plan is followed during M4 implementation. M4 delivers one Colyseus room, two to eight clients,
authoritative movement, authoritative combat, synchronized enemies, dropped loot, and extraction
(technical plan `docs/browser_multiplayer_game_technical_plan_verified_v2.md` §38 M4). It follows the
execution-plan format required by that plan §26.3 (files to change, invariants, tests, migration
impact, rollback, acceptance criteria) and uses `docs/M3_EXECUTION_PLAN.md` as its structural model.
It must stay consistent with `docs/M4_ISSUES.md`; §8 maps every issue to a section here.

Authoritative sources: `docs/lightweight_multiplayer_extraction_roguelite_game_concept.md`
(gameplay/scope, especially §15.2, §17, §22) and the technical plan
(architecture/technology/security/testing, especially §5, §8, §9, §10, §11.1, §12, §14, §15, §16,
§30.2, §30.3, §33, §34, §35). Durable rules: `docs/DEVELOPMENT_RULES.md`. Approved technology:
`docs/DECISIONS.md`. Derived contracts: `docs/PROTOCOL.md`, `docs/CONTENT_AUTHORING.md`,
`docs/TEST_PLAN.md`.

## 1. Scope and scope resolution

**Deliver (technical plan §38 M4):** one Colyseus room, two to eight clients, authoritative
movement, authoritative combat, synchronized enemies, dropped loot, extraction.

**Exit criteria (technical plan §38 M4):** two real browsers can play; the client cannot set position
or rewards; room integration tests pass.

### Scope resolution (restated and upheld)

`docs/M4_ISSUES.md` §1 records eight scope decisions in detail; restated briefly here because they
shape §3's file list:

1. **`simulation-core` moves into the room and had to become multi-player.** Every rule module moves
   unchanged; `World`/`Player`/`Projectile` and `stepSimulation`'s signature change, because `World`
   was explicitly declared single-player in M1. Recorded honestly (§2.1).
2. **Interpolation, no prediction** (technical plan §11.1/§11.2).
3. **The content version activates in the handshake**, and `PROTOCOL_VERSION` bumps 1 → 2.
4. **No player-versus-player damage**; death looting of dropped inventory works and is shared.
5. **One lobby countdown, then the room locks**; late join disabled (technical plan §8.3, concept
   §22.2).
6. **Caps 5 and 6 stay unreachable** (unchanged from M3).
7. **`foundation_room` stays alongside `match_room`**, with one shared handshake gate.
8. **Disconnect: stationary and vulnerable, short reconnect window, then abandonment with loot
   dropped and nothing settled** (technical plan §34.1; no persistence until M5).

Each of these is also recorded in `docs/DECISIONS.md` (D34-D41 this milestone).

## 2. Architecture

### 2.1 The seam becomes the room boundary

M1 established exactly one client → simulation seam (`stepSimulation`, called once per fixed step in
`PlayScene.update`). M4 cuts the system at exactly that seam:

```text
before (M1-M3)        client: input -> stepSimulation -> World -> render

after  (M4)           client: input -> InputMessage --network--> room
                      room:   validate -> latest-input store -> stepSimulation -> World
                      room:   World -> synchronized schema --network--> client
                      client: MatchView snapshots -> interpolate -> render
```

The client keeps its input capture and its renderer and loses the middle. `apps/client/src` no longer
imports `createSimulation` or `stepSimulation` at all, and an architectural test asserts that, so the
"one simulation" property cannot silently regress.

### 2.2 One world, many players

`World.player` becomes `World.players`, each carrying an `id`; `stepSimulation(world, inputs)` takes
a `ReadonlyMap<string, InputState>` and treats a missing entry as neutral input (which is exactly
what a disconnected player gets). `World.runResult` moves to `Player.runResult` because extraction
ends one player's run, not the match (concept §17.1).

The step order is fixed and documented in `simulation.ts`, because with more than one player the
order is a rule rather than an implementation detail:

```text
1  build the wall grid once
2  for each player, in stable id order:
     inventory intents -> build effects -> movement+collision -> dash -> aim -> cooldowns
     -> melee start/advance/resolve vs enemies -> ranged fire (projectiles tagged with ownerId)
3  step all projectiles once, against the shared enemy list
4  merge enemy health, remove kills, drop their loot
5  move enemies toward the nearest live player; apply contact damage to whoever they touch
6  for each player, in stable id order:
     ground-loot pickup -> skill-chip pickup -> extraction channel -> run end (death/extraction)
7  tick += 1
```

Stable id order matters for determinism: two players reaching for the last inventory-filling loot
item on the same tick must resolve the same way on every machine that replays the same inputs.

### 2.3 Projectile ownership makes cap 7 stronger, not weaker

`Projectile.ownerId` is new. It exists for two reasons, both authority-preserving: the §13.4 cap 7
(per-player active projectile count) is now counted per owner instead of per world, so eight players
cannot collectively bypass a cap that was written per player; and shield-on-hit (M3.5) credits the
shooter rather than whoever happens to be stepping. No cap value changes.

### 2.4 Public state is synchronized; private state is messaged

Technical plan §10.3 requires filtering private data. The mechanism chosen is structural rather than
disciplinary: **inventory, secure slot, skill loadout, wildcard skill, and run result are not fields
of the synchronized schema.** They cannot leak to another client because they are never in the
document every client receives. Each client instead receives its own `LocalPlayerState` as a
`player_private` message when it changes.

Everything a client legitimately needs to render another player — position, facing, radius, health,
max health, shield, alive, the active melee swing, extraction progress — is public and synchronized,
matching §10.3's list.

The schema is reconciled in place by entity id each tick (add / update / delete) so Colyseus's delta
encoding transmits changes rather than the whole world (§10.1: "prefer compact messages").

### 2.5 One-shot events stay one-shot

Hit events (technical plan §10.4, §13.1's last pipeline stage) are not stored in synchronized state.
`stepSimulation` returns them per step and the room **discards** them.

*Revised during implementation:* the plan originally said the room would broadcast them as a
transient message. Nothing renders them — the client had no hit-effect layer through M3 either — so
broadcasting would have added a channel with no consumer, which `DEVELOPMENT_RULES.md` forbids as an
empty layer. The invariant §10.4 exists to protect is unaffected: no short-lived effect enters
synchronized state either way. When a client grows a use for them (damage numbers, hit flashes), they
become a transient message then.

### 2.6 Validation is a boundary, not a sprinkle

Every inbound message passes exactly one validator, in `packages/protocol`, before any field is read.
The room's handlers receive `unknown` and cannot proceed without a successful `ValidationResult`.
Rate limiting, sequence ordering, and player-state gating sit immediately behind the validator, in
one `InputGuard` per client, so there is a single place to reason about abuse (technical plan §33).

The strongest validation in the system is the one that needs no code: the client's messages cannot
express a position, a damage number, a loot grant, an extraction, or a reward. Those concepts have no
wire representation at all. §7's adversarial tests confirm that a client inventing such a message is
simply ignored.

### 2.7 Determinism

One `Rng`, seeded per match on the server (technical plan §9.4), created in `createSimulation` and
carried on the world, advanced only inside the fixed step. The seed is logged with the room id and
carried on `MatchState` for diagnostics (it is not secret: it selects spawn placement the players can
already see, and technical plan §9.4 explicitly records the seed with match results).

*Added during implementation:* an optional `MATCH_SEED` environment variable pins that seed instead
of drawing a random one, and the browser suite sets it. Without it, a browser test that walks to "the
first extraction point" sometimes gets one across the map behind three chasers and fails for a reason
unrelated to what it is testing — the layout it happened to draw. §9.4 asks for reproducible seeded
tests in as many words; this is the knob that provides them. Unset (the default, and the case in
production) each match still draws its own random seed.

## 3. Files to change (§26.3)

### 3.1 `packages/protocol`

| File | Change |
| --- | --- |
| `src/version.ts` | `PROTOCOL_VERSION` 1 → 2; add `isContentCompatible(peerVersion, localVersion)`; add `INVALID_MESSAGE_DISCONNECT_CODE`. |
| — | *Revised during implementation:* `MeleeSwingView` was dropped in favour of flat `swing*` fields on `PlayerView`, so the read model is exactly the shape of the synchronized schema and no lossy conversion sits between them. |
| `src/rooms.ts` | Add `MATCH_ROOM`; widen `RoomName`. |
| `src/messages.ts` | `MatchJoinOptions`; `InputMessage.secondaryAttackPressed`; `SecureItemMessage`/`DiscardItemMessage` + type constants; `PRIVATE_STATE_MESSAGE_TYPE`; `MatchPhase` + `isMatchPhase`; `MatchRoomState`/`SyncedCollection` (the mirror of the server schema) and the `MatchView` snapshot; `LocalPlayerState`. |
| `src/validation.ts` | `validateMatchJoinOptions`, `validateInputMessage`, `validateSecureItemMessage`, `validateDiscardItemMessage`; shared numeric guards. |
| `src/validation.test.ts` | Rejection/acceptance tests for each new validator. |
| `src/version.test.ts` | Content-compatibility tests. |

### 3.2 `packages/game-content`

| File | Change |
| --- | --- |
| `src/version.ts` (new) | `CONTENT_VERSION`. |
| `src/arena.ts` (new) | `ArenaDefinition`, `testArena` — the map geometry moved out of `PlayScene`, plus ≥ 8 player spawn points. |
| `src/arena.test.ts` (new) | Spawn points are inside the arena and clear of walls; enough distinct player spawns for a full room; enough extraction candidates. |
| `src/index.ts` | Export both. |

### 3.3 `packages/simulation-core`

| File | Change |
| --- | --- |
| `src/world.ts` | `Player.id`, `Player.runResult`; `World.players` replaces `World.player`; `World.runResult` removed; `Projectile.ownerId`. |
| `src/simulation.ts` | `createSimulation` takes player spawn descriptors; `stepSimulation(world, inputsByPlayerId)`; the §2.2 step order; `addPlayerToWorld`, `removePlayerFromWorld`, `findPlayer`. |
| `src/enemy.ts` | `nearestLivePlayer` (the chaser's target selection its M1 doc already anticipated). |
| `src/combat/ranged.ts` | `startRangedAttack` tags projectiles with `ownerId`; the active-projectile cap counts that owner's projectiles. |
| `src/combat/events.ts` | `HitEvent.ownerId` (which player's attack landed it), so shield-on-hit and client effects credit correctly. |
| `src/*.test.ts` | Updated for the new shapes; new multiplayer rules tested (see §7). |

### 3.4 `apps/server`

| File | Change |
| --- | --- |
| `src/rooms/authorize.ts` (new) | The shared handshake gate (protocol + content version) both rooms call. |
| `src/rooms/FoundationRoom.ts` | Uses the shared gate; otherwise unchanged. |
| `src/rooms/MatchState.ts` (new) | The Colyseus v4 schema: public state only. |
| `src/rooms/match-sync.ts` (new) | `World` → schema reconciliation, in place by id. |
| `src/rooms/private-state.ts` (new) | `World` → `LocalPlayerState`, plus the change signature that decides when to resend. |
| `src/rooms/input-guard.ts` (new) | Per-client rate limit, sequence ordering, invalid-message counter. |
| `src/rooms/MatchRoom.ts` (new) | Lifecycle, tick loop, message handlers, disconnect/reconnect. |
| `src/server.ts` | Define `match_room` alongside `foundation_room`; accept match-room tuning (lobby duration, match duration, reconnect window, seed, and — added during implementation — the arena) so tests can shorten timings and isolate a rule from the chasers. The arena override is also the seam a second real map would arrive through. |
| `package.json` | Add the `@carry-or-fall/game-content` and `@carry-or-fall/simulation-core` workspace dependencies. |
| `esbuild.config.mjs` | Nothing to change: both new workspace packages are source-only and get bundled exactly as `protocol` already is. |
| `test/match-room.test.ts` (new) | Room integration tests (§7.3). |
| `test/match-authority.test.ts` (new) | The adversarial suite (§7.4). |

### 3.5 `apps/client`

| File | Change |
| --- | --- |
| `src/network/match-connection.ts` (new) | Join, snapshot conversion, private state, hit events, input sending (≤ 20/s), one reconnect attempt, status reporting. |
| `src/scenes/PlayScene.ts` | Networked: no simulation, send input, render interpolated snapshots, show connection/lobby/result states. |
| `src/scenes/LoadoutScene.ts` | Enter passes the validated loadout ids into the connection instead of a local world. |
| `src/render/world-view.ts` | Renders a `MatchView`: all players, local one distinguished. |
| `src/hud/combat-hud.ts` | Reads the local `PlayerView` + `LocalPlayerState`; adds phase/countdown and player-count readouts. |
| `src/hud/inventory-hud.ts` | Reads `LocalPlayerState`. |
| `src/render/interpolate.ts` (new) | Blend the two most recent authoritative snapshots; positions only. |
| `src/debug/debug-hook.ts` | Exposes snapshot, local player id, private state, connection status. |
| `src/main.ts` | Wire the new hook accessors. |
| `playwright.config.ts` | Second `webServer` entry for the game server, with a pinned `MATCH_SEED` (added during implementation, see below). |
| `e2e/helpers.ts` | Read the authoritative snapshot instead of a local `World`; add multi-context helpers. |
| `e2e/*.spec.ts` | Updated to the networked flow; `multiplayer.spec.ts` added. |
| `test/architecture.test.ts` (new) | The client source contains no simulation stepping. |
| `test/interpolate.test.ts` (new) | Interpolation blends motion, never overshoots the latest authoritative position, and leaves authoritative facts alone. |

### 3.6 Documentation

`docs/PROTOCOL.md` (status M4, content version active, the new messages, the private-state rule),
`docs/TEST_PLAN.md` (the new suites), `docs/DECISIONS.md` (D34–D40),
`docs/CONTENT_AUTHORING.md` (the arena content kind), `README.md` and package descriptions where
behavior changed.

## 4. Content definitions and provenance

Only one new content family: the arena.

| Field | Provenance |
| --- | --- |
| Walls, interior cover | Carried over verbatim from the M4-prep tuning of `PlayScene` (commit `c6b2f71`), which recorded why each wall exists. Geometry, proposed, balance-deferred. |
| Player spawn points | New. Eight distinct points on the player's side of the divider, spread far enough apart that eight players do not begin overlapping. Proposed. |
| Enemy spawn points / count | Carried over from `PlayScene` (five candidates, three spawned). |
| Ground loot / skill chip points | Carried over from `PlayScene`. |
| Extraction candidates | Carried over from `PlayScene` (four candidates, two active). |
| Match duration | Concept §22.3: "suggested initial maximum match duration: 12 minutes". |
| Lobby countdown | Technical plan §8.3 "brief lobby"; concept §22.2 "short lobby countdown". No number is given in either document; the value is proposed and balance-deferred like every other unsourced number. |

`CONTENT_VERSION` starts at 1: it is the version of the content tables as a whole, bumped whenever a
change to them would make a stale client disagree with the server about an outcome.

## 5. Invariants (§26.3)

1. **The server is the only thing that steps a simulation.** No client-side world, no prediction, no
   second stepping loop. Enforced by an architectural test.
2. **A client message can only express intent.** No wire message carries a position, damage, enemy
   health, loot grant, cooldown completion, death, extraction, or reward.
3. **No inbound message is read before it validates.** Handlers take `unknown`.
4. **Private state is never in synchronized state.** Inventory, secure slot, loadout, wildcard, and
   run result exist only in per-owner messages.
5. **The fixed step is fixed.** The room advances the world by `SIMULATION_DT_MS` per tick, never by
   a wall-clock delta and never by a client-supplied delta.
6. **The eight §13.4 caps hold, and cap 7 is per player.** No cap value is raised or removed.
7. **One room equals one match** (D7). The room locks at match start; a new match is a new room.
8. **One process, no presence** (D8). No Redis, no second replica, no cross-room coordination.
9. **A disconnected player is never invulnerable** (technical plan §34.1).
10. **Determinism:** identical seed + identical per-tick input map ⇒ identical world.
11. **Nothing is persisted.** No storage, no Supabase, no reward settlement (D9, D16, D22, D27).

## 6. Security and anti-cheat mapping (technical plan §33)

| §33 item | How M4 satisfies it |
| --- | --- |
| Input rate | `InputGuard` caps input messages per second; sustained overrun counts as invalid. |
| Movement magnitude | Not expressible: the client sends `moveX`/`moveY` ∈ {-1,0,1}; distance comes from the server's own speed and fixed step. |
| Attack cooldown | Server-side per-weapon cooldown in the simulation; an attack intent arriving early is simply refused by `prepareAttack`. |
| Dash cooldown | Same, via `dashCooldownMs`. |
| Interaction distance | Server-side proximity check (`isNearGroundLoot`, `isNearSkillChip`, `findActiveExtractionPoint`). |
| Inventory ownership | Inventory lives only on the server's `Player`; the client names a slot index, never an item. |
| Item state | `secureItem` refuses an empty slot or an occupied secure slot, server-side. |
| Extraction presence | Server-side zone test plus damage interruption, every tick. |
| Loadout unlocks | `createSkillLoadout` runs on the server at the join boundary. (There are no account-gated unlocks until M5.) |
| Message schema | `packages/protocol` validators, at every handler. |
| Room membership | Colyseus session identity; a message can only affect its own sender's player. |
| Party membership | No parties until M6. |
| Per-message rate limits | `InputGuard`. |
| Maximum packet sizes | Bounded by validation: fixed-shape payloads, `skillLoadoutIds` length-bounded, no free-form strings beyond bounded ids. |
| Invalid-message counters | `InputGuard` per client. |
| Temporary disconnect after repeated invalid behavior | The room closes the connection at the threshold. |
| Server-generated IDs | Player ids are Colyseus session ids; enemy, projectile, loot, and chip ids are generated in the simulation. |
| Idempotent rewards | No rewards are settled anywhere until M5; the in-memory run result is computed once, when the run ends, and is never recomputed. |

## 7. Tests (§26.3)

### 7.1 Protocol unit tests

Each validator: correct shape accepted; wrong type, missing field, `NaN`, `Infinity`, out-of-range
enum value, negative or non-integer index, oversized array, and non-object input each rejected with a
reason. Content-version compatibility accepted on match, refused otherwise.

### 7.2 Simulation unit tests (multiplayer rules)

Two players move independently from the same world; a dead player's step is inert while the other
keeps playing; a dead player's inventory drops at their position and another player can pick it up; a
skill chip taken by one player is gone for the other; two players channel the same extraction point
and each completes independently; the chaser retargets to the nearest live player when its target
dies; the per-owner active-projectile cap holds for each player separately; `removePlayerFromWorld`
drops loot and leaves other players untouched; identical seed and inputs produce identical worlds.

### 7.3 Room integration tests (technical plan §30.2)

Create a room; join multiple clients; send messages; verify synchronized state; test disconnects;
test room disposal; test extraction; test death and dropped loot — the full §30.2 list, plus: the
room locks at match start so a third client gets a different room; a client with an invalid loadout
or an incompatible content version is refused at join; client B never receives client A's inventory.

### 7.4 Adversarial authority tests (exit criterion 2)

The suite described in `docs/M4_ISSUES.md` M4.8: fabricated position, fabricated damage, fabricated
loot pickup, fabricated extraction, fabricated reward, cooldown bypass by message flooding, replayed
sequence numbers, malformed payloads, and sustained invalid traffic. Each asserts the *server's*
state is unchanged, not merely that an error was logged.

### 7.5 Browser tests (exit criterion 1, technical plan §30.3)

Two browser contexts against one server: both see two players; A's movement is visible to B; enemies
agree across both; loot picked up by A is gone for B; A extracts independently while B plays on.
Existing single-client specs are updated to the networked flow and keep asserting what they already
asserted (loadout carried into the run, arena shape, skill behavior) — now through the authoritative
snapshot.

*Revised during implementation:* three M3-era browser assertions read fields that M4 deliberately
does not publish, because they have no rendering purpose (technical plan §10.3): the effective
weapon's `recoveryMs` and `stunChance`, and a projectile's `postBounceDamageMultiplier`.
`swift_strikes`'s recovery reduction is left to the unit and caps-under-load tests that already
drive it through the real pipeline; `stunning_blows` is now asserted **better** — the browser test
lands hits until an enemy is actually stunned, rather than checking that a probability was written
into a weapon copy.

The room integration suite is split in two: the default arena, where the chasers are part of the
subject, and a chaser-free fixture arena for the rules that are about a player and the world
(pickup, secure, discard, extraction). A chaser interrupting an extraction channel is *correct*
behavior that would have made those cases fail for the wrong reason.

## 8. Issue → plan mapping (`docs/M4_ISSUES.md`)

| Issue | Plan sections |
| --- | --- |
| M4.1 protocol and validators | §3.1, §5.2-5.3, §6, §7.1 |
| M4.2 arena content + multi-player world | §2.2, §2.3, §3.2, §3.3, §4, §7.2 |
| M4.3 match room lifecycle and tick | §2.1, §2.7, §3.4, §5.5, §5.7, §7.3 |
| M4.4 synchronized + private state | §2.4, §2.5, §3.4, §5.4, §7.3 |
| M4.5 input validation and rate limiting | §2.6, §3.4, §6, §7.4 |
| M4.6 disconnect and reconnect | §3.4, §5.9, §7.3 |
| M4.7 client | §2.1, §3.5, §5.1, §7.5 |
| M4.8 adversarial tests | §7.4 |
| M4.9 two browsers | §7.5 |

## 9. Migration impact (§26.3)

- **Wire protocol breaks.** `PROTOCOL_VERSION` 1 → 2 and the content version joins the gate, so a
  browser tab loaded before this change is refused at join with the existing refresh/update message
  (D18). That is the designed behavior, not a regression.
- **`simulation-core`'s public API breaks** (`World.players`, `stepSimulation`'s signature,
  `Player.runResult`). The only consumers are in this repository and all are updated in the same
  change.
- **The client can no longer run without a server.** `pnpm dev` already starts both. The browser
  suite's Playwright config is updated to start both as well.
- **No data migration.** Nothing is persisted anywhere (D22): there is no schema, no storage, and no
  saved state to migrate.
- **No deployment impact.** No hosting, region, or environment work happens in this milestone
  (`docs/DEVELOPMENT_RULES.md`, "No deployment during local gameplay milestones").
- **CI:** unchanged in shape. The six gates plus the separate browser job (D32) still apply; the
  browser job now boots the server too.

## 10. Rollback (§26.3)

The milestone is one branch of ordered commits, each individually green. Rollback options, cheapest
first:

1. **Revert a commit.** Each commit is scoped to one issue and leaves the gates passing, so a single
   defective step can be reverted without unwinding the milestone.
2. **Revert the branch.** `main` at `8e0941a` + the M4-prep commit is a complete, playable
   single-player M3 build; nothing in M4 alters stored data, so reverting has no residue.
3. **Partial rollback is not offered for the protocol version.** If the branch is reverted, the
   protocol version reverts with it; a client and server from different sides of the revert refuse
   each other at the join boundary rather than desyncing, which is the whole point of D18.

## 11. Acceptance criteria (§26.3)

1. Two real browser contexts join one room and play simultaneously: each sees the other move,
   enemies agree across both, loot taken by one is gone for the other, and each extracts
   independently — proven by `apps/client/e2e/multiplayer.spec.ts`.
2. A client cannot set position, damage, loot, cooldown completion, extraction, or reward — proven by
   `apps/server/test/match-authority.test.ts`, where every test attempts the cheat and asserts the
   server's own state is unaffected.
3. Room integration tests pass, covering the full technical plan §30.2 list.
4. The server advances exactly one `SIMULATION_DT_MS` step per tick from the latest valid input.
5. No private data appears in synchronized state.
6. The eight §13.4 caps are unchanged in value and cap 7 is enforced per player.
7. `apps/client/src` contains no simulation stepping.
8. All six gates plus the browser suite pass.

## 12. Assumptions

1. **Eight is the room cap** (technical plan §8.1), even though concept §22.1 says "8 to 12": §8.1 is
   the architecture document and is more specific about the first implementation, and the milestone's
   own deliverable says "two to eight clients".
2. **Twelve minutes is the match duration** (concept §22.3, "suggested"), and the lobby countdown
   value is proposed — neither document specifies one.
3. **20 Hz server tick, 20 inputs/s client cap** (technical plan §9.1), which is exactly the
   `SIMULATION_DT_MS = 50` the simulation has always used.
4. **Colyseus's reconnection token is an acceptable stand-in for §34.2's account token** until M5,
   because no account system exists yet and the token is single-use and issued per socket.
5. **The match seed is not secret.** Technical plan §9.4 records it with match results; it determines
   spawn placement players can see anyway.

## 13. Non-goals

Accounts, persistence, reward settlement, secure-slot durability (M5); parties, matchmaking, join
codes (M6); the boss and boss skill cores (M7); deployment, regions, load tests, soak tests (M8+);
player-versus-player damage; client prediction and reconciliation; join-in-progress; spectating;
mobile controls; visibility/fog rules (concept §18); armor as a system; a second map.
