# M4 Issue List — Authoritative Multiplayer

Status: **Planned** (implementation follows in the same change set as this document). The bounded
task list for milestone **M4**, per the technical plan §38 (M4) and the repository's
per-milestone-issue-list practice established at M1/M2/M3. M4 is implemented after M3 and after the
M4-prep tuning commit (`c6b2f71`); no M3 tail defects are carried forward beyond the two recorded in
§1.6.

## Scope

**Deliver (technical plan §38 M4):** one Colyseus room, two to eight clients, authoritative
movement, authoritative combat, synchronized enemies, dropped loot, and extraction.

**Exit criteria (technical plan §38 M4):**

- Two real browsers can play.
- The client cannot set position or rewards.
- Room integration tests pass.

**Explicitly out of M4** (later milestones or never, per the authoritative documents): accounts,
Supabase, persistence, atomic reward settlement, secure-slot persistence (M5, `docs/DECISIONS.md`
D9/D16/D22); parties, join codes, matchmaking queues, party markers (M6, technical plan §8.4); the
boss and boss skill cores (M7); deployment, hosting, regions, load and soak tests (M8+, technical
plan §30.4/§30.5); mobile controls; client-side prediction and reconciliation (technical plan §11.2
explicitly forbids it before basic multiplayer correctness — see §1.2); player-versus-player damage
(§1.4); Redis, presence, or a second server process (D8).

## Architectural constraints (apply to every issue)

- **The existing simulation moves into the room; it is not forked.** `packages/simulation-core` has
  been a headless fixed-50ms-step loop since M1 precisely so this milestone could put it behind a
  server room. The server calls `createSimulation`/`stepSimulation`; the client stops calling them
  entirely. There is exactly one simulation in the system, and it runs on the server. Any
  divergence — a second stepping loop, a client-side "predicted" world, a re-implemented rule — is
  forbidden. §1.1 records what had to change inside `simulation-core` to make one world hold more
  than one player.
- **Clients send intentions, never outcomes** (`docs/DEVELOPMENT_RULES.md`; technical plan §5.1,
  §5.4). A client may report keys held, aim angle, and which inventory action it requested. It may
  never assert position, damage, enemy health, loot ownership, cooldown completion, death,
  extraction, or reward. §8 (M4.8) is the adversarial evidence for that claim.
- **Every client message is validated at the network boundary** (technical plan §10.2, §33) for
  schema, types, numeric ranges, message frequency, sequence order, and allowed state. `docs/DECISIONS.md`
  D23 comes due here: `InputMessage` shipped without a runtime validator in M1 because no untrusted
  boundary existed; the validator ships in the same change that makes the server consume the message.
- **Private data is filtered** (technical plan §10.3). A client receives its own inventory, secure
  slot, skill loadout, and run result; it never receives another player's. This is enforced by
  *transport*, not by client discipline: private fields are not in the synchronized schema at all.
- **The eight §13.4 hard caps stay in shared code and are never weakened.** Multiplayer makes cap 7
  (per-player active projectile count) meaningfully harder — projectiles from eight players share
  one world — so projectiles gain an owner and the cap is enforced per owner. That is a
  strengthening, not a relaxation.
- **Content stays data-driven** in `packages/game-content`. The arena the match runs on moves out of
  the client scene and becomes an `ArenaDefinition` (§2), because the server now owns the map and
  both ends must agree on the same geometry from one source.
- **Determinism is preserved.** One seeded PRNG per match, created by the server (technical plan
  §9.4), advanced only inside the fixed step. The client never draws from a game RNG.
- **One process, one room per match** (D7, D8). No presence coordination, no Redis, no second
  replica, no cross-room state.
- Each issue must pass the standard gates (`pnpm format:check`, `pnpm lint`, `pnpm typecheck`,
  `pnpm test`, `pnpm test:integration`, `pnpm build`) plus the browser suite (`pnpm test:e2e`), and
  add tests for any meaningful rule it introduces (`docs/TEST_PLAN.md`).

### §1. Scope decisions (recorded here, not improvised silently)

#### 1.1 `simulation-core` moves into the room, but `World` had to become multi-player

The M1 architecture bet was that the simulation could move behind a server room without being
rewritten. That bet holds for every *rule* module: `movement.ts`, `collision.ts`, `dash.ts`,
`combat/*`, `inventory.ts`, `build-effects.ts`, `skill-effects.ts`, `skill-loadout.ts`,
`extraction.ts`, `loot-drop.ts`, `skill-chip.ts`, `points.ts`, `run-result.ts`, and `prng.ts` all
move unchanged, because each is a pure function over an actor plus world data and never assumed a
single player.

Three things had to change, and all three are the same change: `World` was declared single-player
(`docs/M1_EXECUTION_PLAN.md`, `world.ts`: "M2 is still local and single-player … so `World` holds
exactly one `player`, not a collection").

1. **`World.player: Player` becomes `World.players: readonly Player[]`, and `Player` gains an `id`.**
   `stepSimulation(world, input)` becomes `stepSimulation(world, inputsByPlayerId)`.
2. **`World.runResult` moves to `Player.runResult`.** Death and extraction end *that player's* run,
   not the match (concept §17.1: "successful extraction immediately ends the run for that player").
   The world keeps stepping while other players are alive.
3. **`Projectile` gains `ownerId`**, so cap 7 is per player and shield-on-hit credits the shooter.

Two small consequences follow: `enemy.ts`'s chaser targets the **nearest live player** (its own M1
doc already anticipated this: "nearest player — trivially the only player in M1's single-player
local run"), and players need to be added to and removed from a world (`addPlayerToWorld`,
`removePlayerFromWorld`) because joining and leaving are now real events.

This is recorded as a modification, not a clean lift, and the final report says so. No rule module
was duplicated, and no second simulation exists.

#### 1.2 Client-side lag handling: interpolation only, no prediction

Technical plan §11.1 is the source and is unambiguous: "server-authoritative movement, client
interpolation, optional immediate local animation response, **no sophisticated client prediction**",
and §11.2 adds "do not implement prediction before basic multiplayer correctness." M4 therefore
renders every entity — including the local player — by interpolating between the two most recent
authoritative snapshots. The client asserts no outcome, keeps no speculative world, and never
rewinds or reconciles.

The cost is honest and stated: the local player's movement lags input by up to one server tick plus
network latency. Whether that is acceptable is a measurement §11.2 defers until multiplayer is
correct, which is what this milestone is for.

#### 1.3 The content version activates in the handshake now

`docs/PROTOCOL.md` §3 recorded the content version as **Reserved**, with the explicit condition
"when `game-content` gains real definitions (M2–M3), add a `CONTENT_VERSION` constant here and
include it in the handshake and the compatibility check." That condition is satisfied: there are
weapons, enemies, loot, skills, and now an arena.

It activates. `CONTENT_VERSION` lives in `@carry-or-fall/game-content` (it versions content, so it
belongs with content), travels in the join handshake, and is gated by exact match exactly like the
protocol version. The reason it matters *now* and did not before: the client renders melee arcs,
projectile behavior cues, loot values, and point previews from its own copy of the content tables,
while the server computes outcomes from its copy. A client with a stale content table would draw a
different arc than the one that hit, or preview points that will not be awarded — a silent
disagreement about game rules, which is exactly what §35 exists to prevent.

`PROTOCOL_VERSION` also bumps 1 → 2, because the message contract changed incompatibly (new room
name, new required handshake fields, a new field on `InputMessage`, two new message types).

#### 1.4 Player-versus-player damage is deferred; death looting is not

Technical plan §38 M4's deliverable list does not include PvP, and concept §15 is a system with its
own rules (contested extraction, ambush, group balance §16) whose numbers exist nowhere. M4 ships
no player-versus-player damage: projectiles and melee swings resolve against enemies only.

What *does* arrive, for free and correctly, is concept §15.2's first three bullets: when a player
dies, their normal inventory items drop as ground loot, those items are visible and lootable by
**any** player in the room, and the secure slot is not dropped. That behavior already existed in M2
single-player; putting eight players in one world is what makes it meaningful. Contested extraction
(§15.1's last bullet) also arrives free: two players channeling the same point both progress
independently and both can extract.

#### 1.5 Match creation: one lobby countdown, then late join disabled

Technical plan §8.3's recommended first implementation is "short queue, server creates room, players
join during a brief lobby, match starts together, late join disabled", and concept §22.2 recommends
"fixed match start or short lobby countdown". M4 implements exactly that with the §8.2 lifecycle:
`waiting` → `countdown` → `running` → `ending` → disposed. The countdown starts when the first
client joins; when it expires the room **locks** (Colyseus `lock()`), which is what makes
`joinOrCreate` route the next client to a *new* room and keeps D7's "one room equals one match"
true. A solo player is not blocked: the countdown expires and the match starts with one player.

There is no matchmaking queue, no party code, and no lobby UI beyond a countdown readout — those are
M6.

#### 1.6 The two M3 caps that were unreachable stay unreachable

`docs/M3_ISSUES.md` §1 recorded that cap 5 (split projectiles cannot split again) and cap 6 (child
projectiles cannot create parent effects) have no mechanic to exercise them, because split is boss-core
territory (concept §11/§29.4, M7). M4 adds no split mechanic, so this is unchanged and is restated here
rather than quietly dropped. The functions remain in `combat/caps.ts` with their unit tests.

#### 1.7 `foundation_room` stays, alongside `match_room`

The M0 room is not deleted. Joining the match room now has side effects — it consumes one of eight
seats and starts a lobby countdown — so a connection-only probe that allocates no match is a
genuinely different capability, and it is the one `BootScene` uses to report connection health and
the one a future deployment health check (M8) wants. The drift risk that would justify deleting it
(two copies of the version gate) is removed instead by extracting the handshake gate into one shared
`authorizeHandshake` helper both rooms call. Recorded in `docs/DECISIONS.md`.

#### 1.8 Disconnect mid-run: stationary and vulnerable, then abandoned

Technical plan §34.1 specifies the policy: short reconnect window, the disconnected player remains in
the room, becomes stationary and vulnerable, reconnect restores control, failure to reconnect results
in death or abandonment, and disconnected players are never invulnerable. M4 implements that policy.

§34.2's reconnect authentication (valid account token, matching identity) cannot be implemented —
there are no accounts until M5 — so M4 uses Colyseus's own single-use reconnection token, which is
issued to that socket and not guessable by another client. That is the strongest identity available
and it is recorded as the reason.

Because persistence does not exist (D9, D16, D27), an abandoned player's run is **lost**: their
carried loot drops on the ground for others, and no points are settled, including the secure slot.
The secure slot's promise remains local-only per D27 and is not honored across a disconnect. M5 is
the milestone that fixes this, and it must.

## Issues

Each issue is a self-contained change with its own tests. They are ordered by dependency.

### M4.1 — Protocol: version gate, message shapes, and the runtime validators D23 requires

The whole wire contract, in `packages/protocol`, before anything consumes it.

1. `PROTOCOL_VERSION` 1 → 2; `MATCH_ROOM = "match_room"` added to `rooms.ts`.
2. `CONTENT_VERSION` added to `@carry-or-fall/game-content`; `isContentCompatible(peer, local)`
   added to the protocol package (two arguments, so the protocol package does not depend on the
   content package).
3. `MatchJoinOptions extends ClientHandshake` adds `contentVersion` and `skillLoadoutIds`
   (§1.3, M4.7).
4. `InputMessage` gains `secondaryAttackPressed` (the bow trigger; `docs/PROTOCOL.md` §6 already
   permits folding discrete `attack` intents into `input`).
5. `SecureItemMessage` and `DiscardItemMessage` are added as separate message types, matching
   technical plan §14.2's `{ type: "secure_item", sourceSlot: 2 }` shape exactly, rather than being
   folded into the per-tick input message — a one-shot inventory command must not be resent 20 times
   a second.
6. Runtime validators for every one of them: `validateMatchJoinOptions`, `validateInputMessage`,
   `validateSecureItemMessage`, `validateDiscardItemMessage`. Each returns the existing
   `ValidationResult<T>` union, rejects (never coerces) anything malformed, and enforces numeric
   ranges: `moveX`/`moveY` ∈ {-1, 0, 1} exactly, `aimAngle` finite, `sequence` a non-negative
   integer below a bound, `sourceSlot` an integer in `[0, INVENTORY_SIZE)`, `skillLoadoutIds` an
   array of at most `MAX_SKILL_SLOTS` short strings.
7. The read model the client renders from — `MatchView`, `PlayerView`, `EnemyView`, `ProjectileView`,
   `GroundLootView`, `SkillChipView`, `ExtractionPointView`, `MeleeSwingView` — plus
   `LocalPlayerState` (the private half) and the `PRIVATE_STATE_MESSAGE_TYPE` constant. Public and
   private are separate types so "a remote player has no inventory" is a fact the compiler knows.

Tests: every validator rejects the wrong type, the out-of-range value, the missing field, the
`NaN`/`Infinity` value, and the oversized array; and accepts the exact legal shape.

### M4.2 — The arena becomes content; the world becomes multi-player

1. `packages/game-content/src/arena.ts`: `ArenaDefinition` (walls, player spawn points, enemy spawn
   points and count, ground-loot and skill-chip spawn points, extraction candidates) and
   `testArena`, carrying over the exact geometry the M4-prep commit tuned in `PlayScene`. The server
   owns the map now, and the client must render the same walls, so it cannot stay in a client scene.
   At least eight distinct player spawn points, because eight players must not start stacked.
2. `simulation-core` becomes multi-player exactly as §1.1 describes: `World.players`, `Player.id`,
   `Player.runResult`, `Projectile.ownerId`, `stepSimulation(world, inputsByPlayerId)`,
   `addPlayerToWorld`, `removePlayerFromWorld`, `nearestLivePlayer`.
3. Per-step ordering is fixed and documented so eight players produce one deterministic result:
   per-player intents and attacks in stable id order → shared projectile step → enemy merge, kills,
   and drops → enemy movement toward the nearest live player and contact damage → per-player pickup,
   extraction, and run end.

Tests: two players in one world move independently; one player's death does not stop the other's
simulation; a dead player's inventory drops where they died and the survivor can pick it up; the
per-player active-projectile cap is enforced per owner (player A firing does not consume player B's
budget, and neither can exceed the cap); the chaser retargets when the nearest player dies; removing
a player drops their loot and leaves the world otherwise intact; identical seeds and identical input
sequences produce identical worlds.

### M4.3 — The match room: lifecycle and the authoritative tick

`apps/server/src/rooms/MatchRoom.ts`.

1. Registered as `match_room`, `maxClients = 8` (technical plan §8.1), `autoDispose`.
2. `onAuth` runs the shared `authorizeHandshake` (protocol + content version) and then validates the
   join options' `skillLoadoutIds` through `createSkillLoadout` — the same function the client's
   picker uses, now on the trusted side. An invalid loadout is refused at the join boundary, like an
   incompatible version.
3. Lifecycle per §8.2 and §1.5: `waiting` → `countdown` (started by the first join) → `running`
   (room locks) → `ending` → dispose. A fixed maximum match duration of 12 minutes (concept §22.3)
   ends the match; so does every player having died or extracted.
4. `setSimulationInterval` at `SIMULATION_DT_MS` (50 ms = 20 ticks/s, technical plan §9.1/§9.3). The
   room advances the simulation by exactly one fixed step per tick using the latest valid input
   stored per player, and never by a wall-clock delta.
5. The match seed is generated on the server (§9.4) and logged with the room id.

Tests: two clients join one room and both reach `running`; the room locks at match start so a third
`joinOrCreate` lands in a different room; the room disposes when empty; the match ends when all
players have died or extracted; a client joining with an over-budget loadout is refused at join.

### M4.4 — Synchronized state, and private data that never leaves the server

`apps/server/src/rooms/MatchState.ts` plus the world → schema reconciler.

1. A Colyseus v4 `schema()` state holding only public data: phase, countdown/match timers, arena id,
   server build version, and keyed maps of players, enemies, projectiles, ground loot, skill chips,
   and extraction points.
2. The reconciler updates entities **in place by id** and adds/removes only what changed, so
   Colyseus's delta encoding does its job instead of a full resend every tick.
3. Private state (inventory, secure slot, skill loadout, wildcard skill, run result) is **not in the
   schema**. It is sent to its owner only, as a `player_private` message, and only when it changes.

Tests: client B's view contains client A's position and health but no inventory field at all; a
private message arrives only at its owner; the point preview a client shows comes from its own
private state; an item picked up by A disappears from the ground for both A and B.

### M4.5 — Input validation, rate limiting, and invalid-message handling

`apps/server/src/rooms/input-guard.ts`, wired into the room's message handlers.

Per technical plan §33: input rate, movement magnitude, attack and dash cooldowns, interaction
distance, inventory ownership, item state, extraction presence, message schema, and room membership
are all validated or structurally impossible. Concretely:

1. Every inbound message goes through its M4.1 validator first. A failure increments that client's
   invalid-message counter and the message is dropped — never partially applied.
2. Input frequency is capped (technical plan §9.1: "client input messages capped at 20 per second");
   a sustained overrun counts as invalid rather than being silently absorbed.
3. `sequence` must strictly increase; an out-of-order or replayed input is dropped.
4. Messages from a player who is dead, extracted, or not in the `running` phase are dropped.
5. A client that accumulates too many invalid messages is disconnected (§33's "temporary disconnect
   after repeated invalid behavior").
6. Movement magnitude, cooldowns, interaction distance, and extraction presence need no new check:
   the server computes them from the simulation, and the client's message cannot express them at
   all. That is the strongest form of validation and is stated deliberately.

Tests: §8's adversarial suite.

### M4.6 — Disconnect, reconnect, and abandonment

Per §1.8 and technical plan §34.1.

1. Unconsented `onLeave` marks the player disconnected and awaits reconnection for a short window.
   The player stays in the world, receives empty input (stationary), and remains a valid target for
   contact damage (never invulnerable).
2. A successful reconnect restores control and re-binds the client's session.
3. A failed reconnect removes the player and drops their carried loot on the ground.
4. A consented leave (the player quits) removes them immediately, with the same loot drop.

Tests: a disconnected player's position stops changing but their health can still fall; a reconnect
within the window restores control and the same player identity; a lapsed window removes them and
leaves their loot where they stood; a consented leave does not hold a seat.

### M4.7 — The client: one seam, now the room boundary

1. `LoadoutScene` unchanged in purpose (concept §8.3 still requires pre-run selection), but Enter now
   hands the validated loadout to the connection layer as **join options**, not to a local simulation
   (§1.5, D7: the loadout is fixed at join because the match starts together and late join is off).
2. `apps/client/src/network/match-connection.ts`: joins `match_room`, converts the synchronized
   schema into a `MatchView` snapshot, tracks the private-state message, exposes connection status,
   sends input at no more than 20 messages per second, and attempts one reconnection.
3. `PlayScene` no longer imports `createSimulation`/`stepSimulation`. It captures input, sends it,
   and renders the latest authoritative snapshot with interpolation between the last two (§1.2).
4. `WorldView` renders **all** players (the local one distinguished), and the HUDs read the local
   player's public view plus the private state.
5. The debug hook exposes the authoritative snapshot, the local player id, the private state, and
   the connection status — read-only, dev-only, unchanged in character.

Tests: an architectural unit test asserts `apps/client/src` contains no reference to
`stepSimulation` or `createSimulation`, so a second simulation cannot reappear by accident; the
browser suite (§9) covers the rest.

### M4.8 — Adversarial authority tests (exit criterion: "client cannot set position or rewards")

A dedicated integration suite whose every test *tries to cheat* and asserts the server refuses. Not
happy-path coverage.

1. **Position it did not reach.** A client sends an input message carrying extra `x`/`y`/`position`
   fields; and a client sends a fabricated `set_position`-style message. The player's authoritative
   position is unchanged, and it only ever changes at the movement speed the simulation allows.
2. **Damage it did not deal.** A client sends a fabricated damage/kill message naming a real enemy
   id. Enemy health is unchanged.
3. **Loot it did not pick up.** A client presses interact far from any loot for several seconds, and
   separately sends a fabricated pickup message naming a real ground-loot id. Its inventory stays
   empty and the loot stays on the ground.
4. **Extraction it did not complete.** A client holds interact outside every extraction zone for
   longer than the channel duration, and separately sends a fabricated extraction-complete message.
   No run result is produced and no points are awarded.
5. **A cooldown it did not wait out.** A client sends attack inputs every tick for several seconds.
   The number of projectiles actually created is bounded by the weapon's attack interval, not by the
   message rate.
6. **Rewards.** A client sends a fabricated reward/points message. The run result it eventually
   receives is computed from what it actually carried.
7. **Malformed and hostile payloads.** Wrong types, `NaN`, `Infinity`, out-of-range enums, oversized
   arrays, replayed sequence numbers, and a message flood — each is rejected, and sustained abuse
   disconnects the client.

### M4.9 — Two real browsers (exit criterion: "two real browsers can play")

`apps/client/e2e/multiplayer.spec.ts`, using two Playwright browser contexts against one server, per
the capability D32 added at M3.

1. Both contexts join the same room and see two players.
2. Movement by A is visible to B (B's view of A's position changes in the direction A moved).
3. Enemies are consistent across both clients (same ids, same count, positions agree within one
   interpolation step).
4. Loot picked up by A disappears from B's view, and B cannot pick it up afterwards.
5. Extraction resolves independently: A extracts and receives an extraction result while B is still
   playing, and B's own outcome is computed separately.

The Playwright config gains a second `webServer` entry for the game server, since the browser suite
now needs both halves running.

## Definition of done for M4

- Every issue above is implemented with tests.
- The three §38 M4 exit criteria are each backed by named, passing tests.
- `docs/PROTOCOL.md`, `docs/TEST_PLAN.md`, `docs/DECISIONS.md`, `docs/CONTENT_AUTHORING.md`, and the
  package descriptions are updated in the same change as the behavior they describe.
- All six gates plus the browser suite pass.
- The final report states whether `simulation-core` moved unchanged, and what that says about the M1
  decision.
