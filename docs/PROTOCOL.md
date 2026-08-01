# Network Protocol

Status: **M4 (authoritative multiplayer).** This document is authoritative for the client/server
wire contract. It records what exists today and the shapes the next milestones will add, so the contract is designed
once rather than reinvented per feature (technical plan §10, §35, §46). It is a control document,
not an authoritative design document; where it and the technical plan disagree, the technical plan
wins and this file is corrected.

## 1. Where the contract lives

The shared contract is the `@carry-or-fall/protocol` package (`packages/protocol`). It is
**framework-agnostic**: it has no `@colyseus/schema` or other runtime dependency, so both the
browser client and the authoritative server import the same version constants, identifiers,
payload shapes, and runtime validators without pulling networking code into either end.

Only definitions are shared, never authority (technical plan §7.1). The protocol package must
never carry hidden server data (loot spawn tables, anti-cheat thresholds, secret keys, unrevealed
targets).

## 2. Authority model (why messages look the way they do)

The server is authoritative (technical plan §5; `docs/DEVELOPMENT_RULES.md`). The client sends
**intentions**, never trusted outcomes:

- The client may report which keys are pressed, where the player aims, and which action the user
  requested.
- The client may never assert position reached, damage dealt, loot gained, cooldown completion,
  death, extraction success, or reward.

Every inbound message is validated at the network boundary — schema, types, numeric ranges, and
(later) frequency and allowed state — before any field is trusted. The protocol package ships the
validators (`validateClientHandshake`, `validateHealthResponse`); each returns a
`ValidationResult<T>` discriminated union so callers must check `ok` before reading `value`.

## 3. Version exchange and compatibility (§35)

The technical plan §35 requires the client and server to exchange **three** versions and to
prevent an incompatible client from joining, showing a refresh/update message instead.

| Version          | Source                                                        | Status                                                                          |
| ---------------- | ------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| Protocol version | `PROTOCOL_VERSION` (currently `2`)                            | **Implemented** — the join gate compares on it.                                  |
| Build version    | `GAME_BUILD_VERSION` (server) / `VITE_BUILD_VERSION` (client) | **Implemented** — exchanged, informational.                                      |
| Content version  | `CONTENT_VERSION` in `@carry-or-fall/game-content`            | **Implemented in M4** — the join gate compares on it (`docs/DECISIONS.md` D34). |

- `PROTOCOL_VERSION` is a small positive integer. Bump it whenever the message contract changes in
  a way an older peer cannot understand.
- `isProtocolCompatible(peerVersion)` uses **exact-match** semantics. A later milestone may widen it
  to a supported range.
- Build version is a semver-like string validated by `isBuildVersion` (`major.minor.patch` with an
  optional pre-release suffix, e.g. `0.0.0-m0`). It is displayed and logged but does not gate the
  join.
- **Content version activated in M4** (`docs/DECISIONS.md` D34), on exactly the condition this
  section previously set: `game-content` now holds real definitions. It matters because both ends
  read those tables for different purposes — the client draws melee arcs, projectile behavior cues,
  and point previews from its copy; the server computes outcomes from its copy — so a stale client
  would disagree with the server about a game rule while looking perfectly healthy.
  `isContentCompatible(peerVersion, localVersion)` takes both versions rather than importing the
  content package, keeping this package dependency-free.

## 4. The join handshake

Everything a client asserts at join time is delivered as **Colyseus join options**, not as a
post-join message, so the server can refuse it at the join boundary before it occupies a seat. (This
plays the role the technical plan §10 sketches as a `client_hello`; in this codebase it is the
join-options object below, validated in the room's `onAuth`.)

```ts
// @carry-or-fall/protocol
export interface ClientHandshake {
  readonly protocolVersion: number;
  readonly contentVersion: number;
  readonly buildVersion: string;
}

/** The match room's join options: the handshake plus the pre-run skill selection. */
export interface MatchJoinOptions extends ClientHandshake {
  readonly skillLoadoutIds: readonly string[];
}
```

Flow:

1. The client calls `joinOrCreate(MATCH_ROOM, { protocolVersion, contentVersion, buildVersion, skillLoadoutIds })`.
2. The room's `onAuth(client, options)` runs the shared `authorizeHandshake` gate
   (`apps/server/src/rooms/authorize.ts`), which both rooms use so they cannot drift apart.
3. If the payload is malformed, or `isProtocolCompatible` / `isContentCompatible` is false, the
   server throws `new ServerError(PROTOCOL_MISMATCH_CODE, INCOMPATIBLE_CLIENT_MESSAGE)` — the join is
   refused and no `onJoin` runs.
4. The match room then runs `validateMatchJoinOptions` and `createSkillLoadout` on
   `skillLoadoutIds` — the same validator the client's picker uses, now on the trusted side — and
   refuses an illegal selection with `INVALID_MESSAGE_DISCONNECT_CODE` (`docs/DECISIONS.md` D38).
5. Otherwise the client joins and the server logs `accepted client handshake`.

The connection-only `foundation_room` runs step 2 and nothing else: it takes no loadout, allocates no
match, and starts no simulation (`docs/DECISIONS.md` D40).

### Incompatibility behavior

| Constant                          | Value                                                                    |
| --------------------------------- | ------------------------------------------------------------------------ |
| `PROTOCOL_MISMATCH_CODE`          | `4001` (app-defined 4000+ range)                                         |
| `INVALID_MESSAGE_DISCONNECT_CODE` | `4002` — an illegal join, or a connection dropped for repeated abuse      |
| `INCOMPATIBLE_CLIENT_MESSAGE`     | `"Your game version is out of date. Please refresh the page to update."` |

On the client, the rejected `joinOrCreate` promise rejects with a `MatchMakeError` carrying that
`code` and `message`; the scene surfaces the refresh/update text instead of connecting. This
prevents a stale browser tab from talking to a newer server (§35).

## 5. HTTP contract: health endpoint

Independent of the WebSocket, the server exposes an HTTP health endpoint the client fetches to
prove HTTP reachability (technical plan §38 M0 exit criterion "client can reach health endpoint").

```ts
// @carry-or-fall/protocol
export const HEALTH_PATH = "/health";

export interface HealthResponse {
  readonly status: "ok";
  readonly buildVersion: string;
  readonly protocolVersion: number;
  readonly uptime: number;
}
```

- `GET /health` returns `HealthResponse` as JSON.
- Because the client and server are different origins, the response reflects
  `Access-Control-Allow-Origin` **only** for an origin in the server's `ALLOWED_ORIGINS`; other
  origins receive the body with no CORS grant — never a wildcard (technical plan §20.3).
- The client validates the body with `validateHealthResponse` before displaying it.

## 6. Client → server messages

Every message below is validated by a function in `packages/protocol/src/validation.ts` before any
field is read, and each handler receives `unknown` so it cannot proceed without a successful
`ValidationResult`. `docs/DECISIONS.md` D23 is discharged here: `InputMessage` shipped in M1 without
a validator because no untrusted boundary existed, and `validateInputMessage` arrives in the same
change that first makes the server consume it.

```ts
// @carry-or-fall/protocol
export const INPUT_MESSAGE_TYPE = "input";
export const SECURE_ITEM_MESSAGE_TYPE = "secure_item";
export const DISCARD_ITEM_MESSAGE_TYPE = "discard_item";

export interface InputMessage {
  readonly sequence: number; // strictly increasing per client; a replay is dropped
  readonly moveX: -1 | 0 | 1;
  readonly moveY: -1 | 0 | 1;
  readonly aimAngle: number; // radians
  readonly attackPressed: boolean;
  readonly secondaryAttackPressed: boolean;
  readonly dashPressed: boolean;
  readonly interactPressed: boolean;
}

/** Technical plan §14.2's shape exactly. The client names a slot, never an item. */
export interface SecureItemMessage {
  readonly sourceSlot: number;
}
export interface DiscardItemMessage {
  readonly sourceSlot: number;
}
```

**What these shapes cannot say is the point.** There is no field, on any message, for a position, a
damage number, an enemy's health, a pickup, a cooldown completion, a death, an extraction, or a
reward. A client that invents one is sending decoration: the validator rebuilds the message from its
known fields and the simulation never sees the rest. A client that invents a whole *message type*
reaches the room's catch-all handler, which counts it and drops it.

Behind the validators, one `InputGuard` per connection enforces what a pure validator cannot know
(technical plan §33): message frequency, strictly increasing sequence, whether this player may act at
all right now (the match is running and their run is not over), and an invalid-message counter that
closes the connection at its threshold with `INVALID_MESSAGE_DISCONNECT_CODE`.

The server stores the latest valid input per player and advances the world by exactly one
`SIMULATION_DT_MS` step per tick (§9.3). Sending faster buys nothing: the extra messages are
rate-limited, and distance, cooldowns, and interaction range are all computed from server state.

Still not implemented, and each added only when its milestone lands (technical plan §10.1):

| Message                  | Milestone | Purpose                                          |
| ------------------------ | --------- | ------------------------------------------------ |
| `input`                  | M4        | movement / aim / attack / dash / interact intent |
| `secure_item`            | M4        | move an inventory slot into the secure slot      |
| `discard_item`           | M4        | discard an inventory slot                        |
| `inventory_move`         | later     | rearrange inventory slots (concept §7.1)         |
| `equip_ground_weapon`    | later     | swap to a ground weapon                          |
| `replace_wildcard_skill` | later     | replace the wildcard through a UI rather than by walking over a chip |
| `ping`                   | later     | latency measurement                              |

## 7. Server → client state

Synchronized room state is server-owned; the client only reads it. Two rooms publish state.

`foundation_room` (the connection-only probe, `docs/DECISIONS.md` D40) publishes the M0 shape:

```ts
export interface FoundationRoomState {
  readonly serverBuildVersion: string;
  readonly connectedPlayers: number;
}
```

`match_room` publishes the match. `MatchRoomState` mirrors the server's Colyseus schema (keyed
collections, read structurally so the client needs no `@colyseus/schema` dependency); `MatchView` is
the plain snapshot the client copies out of it each patch and renders:

```ts
export interface MatchView {
  readonly phase: MatchPhase; // waiting | countdown | running | ending
  readonly arenaId: string;   // resolved against @carry-or-fall/game-content
  readonly serverBuildVersion: string;
  readonly seed: number;
  readonly tick: number;
  readonly countdownRemainingMs: number;
  readonly matchRemainingMs: number;
  readonly players: readonly PlayerView[];
  readonly enemies: readonly EnemyView[];
  readonly projectiles: readonly ProjectileView[];
  readonly groundLoot: readonly GroundLootView[];
  readonly skillChips: readonly SkillChipView[];
  readonly extractionPoints: readonly ExtractionPointView[];
}
```

Two rules govern it, and M4 satisfies the first **structurally**:

- **Filter private data (§10.3).** Inventory, secure slot, skill loadout, wildcard skill, and run
  result are not fields of the synchronized schema *at all*. They cannot leak to another client
  because they are never in the document every client receives. Each client instead gets its own
  `LocalPlayerState` as a `player_private` message, addressed to it alone and resent only when it
  changes. There is no filtering rule to misconfigure.
- **Do not store transient effects in synchronized state (§10.4).** See §8.

```ts
export const PRIVATE_STATE_MESSAGE_TYPE = "player_private";

export interface LocalPlayerState {
  readonly playerId: string;
  readonly inventory: readonly (string | null)[]; // content ids; null is an empty slot
  readonly secureSlotItemId: string | null;
  readonly skillIds: readonly string[];
  readonly wildcardSkillId: string | null;
  readonly runResult: RunResultPayload | null;
}
```

Items and skills travel as **content ids**, resolved locally against the shared content tables. That
keeps messages small and keeps the server from shipping content data as if it were state — and it is
safe precisely because the join gate refuses a client whose content version differs (§3).

The static map is not synchronized either: `arenaId` names an `ArenaDefinition` both ends already
have, so the walls a client draws are the walls the server collides against, sent once as a string.

## 8. One-shot events (§10.4)

Transient, fire-and-forget events exist for things that should play once and not accrue in room
state: hit effects, sounds, damage numbers, extraction start, extraction interruption, loot-pickup
animation, and death effect.

`stepSimulation` returns hit events every step, and the room **discards them**: no client renders
them yet, so a broadcast channel nothing consumes would be an empty layer (`docs/DECISIONS.md` D35).
What matters is the invariant either way — no short-lived effect is ever stored in synchronized
state. When a client grows a use for them (damage numbers, hit flashes), they are broadcast as a
transient message and forgotten, never added as schema fields.

## 9. Changing the protocol

When a change makes an older peer unable to understand the wire format:

1. Bump `PROTOCOL_VERSION`, and `CONTENT_VERSION` when the content tables changed with it.
2. Update this document and the affected validators/shapes in `packages/protocol`.
3. Follow the dependency/version upgrade checklist (technical plan §2.7): update the lockfile, run
   all tests, run a two-client multiplayer smoke test, check protocol compatibility, and record
   migration notes.

A backward-compatible addition (a new optional field, a new message type an old peer simply never
sends) does not require a version bump, but must still be validated at the boundary.
