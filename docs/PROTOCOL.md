# Network Protocol

Status: **M6 (party and matchmaking).** This document is authoritative for the client/server
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
| Protocol version | `PROTOCOL_VERSION` (currently `5`)                            | **Implemented** — the join gate compares on it.                                  |
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

/**
 * The match room's join options: the handshake, the pre-run skill selection, and
 * (M5) the account's access token.
 */
export interface MatchJoinOptions extends ClientHandshake {
  readonly skillLoadoutIds: readonly string[];
  readonly accessToken: string | null;
}
```

`accessToken` is the **only** thing a client says about its identity (M5,
`docs/DECISIONS.md` D45). There is no `userId` field, and there will not be one: an id a client can
send is an id it can choose. The server takes the user id out of the *verified token* instead.
Validation splits by necessity — this package bounds the shape (a non-empty string under a length
cap), and only Supabase Auth can judge authenticity. `null` means "no session", which is legal on
the wire because whether a session is *required* depends on whether the server has a project to
verify against, and the protocol package cannot know that.

Flow:

1. The client calls
   `joinOrCreate(MATCH_ROOM, { protocolVersion, contentVersion, buildVersion, skillLoadoutIds, accessToken })`.
2. The room's `onAuth(client, options)` runs the shared `authorizeHandshake` gate
   (`apps/server/src/rooms/authorize.ts`), which both rooms use so they cannot drift apart.
3. If the payload is malformed, or `isProtocolCompatible` / `isContentCompatible` is false, the
   server throws `new ServerError(PROTOCOL_MISMATCH_CODE, INCOMPATIBLE_CLIENT_MESSAGE)` — the join is
   refused and no `onJoin` runs.
4. The match room runs `validateMatchJoinOptions`, then **verifies the access token** (M5). An
   unverifiable token is refused with `UNAUTHORIZED_JOIN_CODE`; the identity that comes back is the
   one every later step uses.
5. It then runs `createSkillLoadout` on `skillLoadoutIds` — the same validator the client's picker
   uses, now on the trusted side — and refuses an illegal selection with
   `INVALID_MESSAGE_DISCONNECT_CODE` (`docs/DECISIONS.md` D38).
6. It provisions the account, finalizes any secure reservation a crashed server left pending
   (technical plan §14.3), and **checks every requested skill against the account's unlock set**
   (technical plan §19), refusing a locked one with `UNAUTHORIZED_JOIN_CODE` (D48).
7. Otherwise the client joins and the server logs `accepted client handshake`.

The connection-only `foundation_room` runs step 2 and nothing else: it takes no loadout, allocates no
match, and starts no simulation (`docs/DECISIONS.md` D40).

### Incompatibility behavior

| Constant                          | Value                                                                    |
| --------------------------------- | ------------------------------------------------------------------------ |
| `PROTOCOL_MISMATCH_CODE`          | `4001` (app-defined 4000+ range)                                         |
| `INVALID_MESSAGE_DISCONNECT_CODE` | `4002` — an illegal join, or a connection dropped for repeated abuse      |
| `UNAUTHORIZED_JOIN_CODE`          | `4003` (M5) — an unverifiable session, or a loadout naming a locked skill |
| `INCOMPATIBLE_CLIENT_MESSAGE`     | `"Your game version is out of date. Please refresh the page to update."` |

`4003` is distinct from the other two because the remedy is different and the client should say so:
refreshing does not fix a locked skill, and re-selecting a loadout does not fix an expired session.

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
export const ACTIVATE_CORE_MESSAGE_TYPE = "activate_core"; // M7

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

/**
 * M7, concept §11 option 1. The same shape, for the same reason: the client
 * names a slot. It cannot name the core, the skill that core grants, or the
 * unlock it would become — a client able to name any of those would be
 * asserting what it is owed.
 */
export interface ActivateCoreMessage {
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
| `activate_core`          | M7        | activate a carried boss core (concept §11 option 1) |
| `inventory_move`         | later     | rearrange inventory slots (concept §7.1)         |
| `equip_ground_weapon`    | later     | swap to a ground weapon                          |
| `replace_wildcard_skill` | later     | replace the wildcard through a UI rather than by walking over a chip |
| `ping`                   | later     | latency measurement                              |

**Nothing settlement-shaped will ever appear in this table.** M5's secure-slot write and reward
settlement are both triggered by the server observing its own simulation state, never by a client
message (`docs/DATA_MODEL.md` §6). Every inventory command names a *slot*, never an item and never an
outcome — including M7's `activate_core`, which is the one command whose effect is a permanent
unlock and therefore the one it would be most tempting to let a client describe.

**The three inventory commands resolve in one fixed order inside a tick**: discard, then
`activate_core`, then `secure_item` (`packages/simulation-core/src/simulation.ts`). This is a rule,
not an implementation detail, because it decides a contested outcome: a client that sends
`activate_core` and `secure_item` for the same slot in the same 50 ms step gets the activation and
not the secure, in either arrival order, because activation removes the core from the inventory and
there is then nothing in the slot to secure. The reservation opened by the losing `secure_item` is
reconciled away by `confirmSecureActions` (D44) rather than left pending.

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
  readonly boss: BossView | null; // M7; null on an arena with no lair, or once it dies
}

/**
 * M7, concept §14.3. Public, unlike the fate of the core it drops, because a
 * boss is a body in the world that everyone can see.
 *
 * `telegraphAttackIndex` names an attack in the `BossDefinition` the client
 * already holds (`-1` when nothing is winding up), so the client draws the shape
 * the server is about to resolve rather than guessing at one. That is what makes
 * §14.3's "readable" true on screen: a player who leaves the drawn shape before
 * the wind-up ends is not hit.
 */
export interface BossView {
  readonly id: string;
  readonly definitionId: string;
  readonly x: number;
  readonly y: number;
  readonly radius: number;
  readonly health: number;
  readonly maxHealth: number;
  readonly enraged: boolean;
  readonly awake: boolean;
  readonly telegraphAttackIndex: number;
  readonly telegraphRemainingMs: number;
  readonly telegraphFacing: number;
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

M5 adds a second per-owner message, sent once a player's finished run has been **written**:

```ts
export const SETTLEMENT_MESSAGE_TYPE = "settlement";

export interface SettlementMessage {
  readonly alreadySettled: boolean;      // a retry or recovery found it already settled
  readonly balances: PointTotalsPayload; // the account's five totals, after this settlement
  readonly unlockIds: readonly string[]; // everything the account now holds
  readonly newUnlockIds: readonly string[]; // only what this settlement granted
  readonly duplicateCoreIds: readonly string[]; // M7: cores converted to points, not unlocks
  readonly isAnonymous: boolean;         // technical plan §17.3's warning condition
}
```

`duplicateCoreIds` is concept §11's duplicate rule said out loud: a second copy of a boss core does
not become a second inventory object, it converts to points, and the player is told which core
became them rather than watching one vanish into a balance. Like `newUnlockIds` it is empty on an
`alreadySettled` repeat — saying "converted" twice is the visible half of a double award even when
nothing was awarded twice. It is the one field on this message a client may legally *omit*: a server
one version behind sends none, and the client's validator treats absence as "no duplicates" rather
than refusing a settlement and hiding the points the player did earn.

Its arrival — not the run ending — is what means the points are in the account. **There is no
client → server counterpart, and that absence is the design**: no message a client can send carries a
point value, an unlock, or an outcome, so there is no reward claim for the server to check
(`docs/DATA_MODEL.md` §6). A client that invents one hits the room's `"*"` handler, is counted as
invalid behavior, and is disconnected after repeated attempts (§33). The client validates this
message on receipt like any other network payload (`validateSettlementMessage`).

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

## 10. The party room (M6)

A second room name, `party_room`, alongside `match_room` and `foundation_room`. It runs no
simulation and decides no game outcome; its whole authority is deciding who is in a party, which is
what technical plan §5.1 denies the client ("party membership authorization").

### 10.1 Joining a party

```ts
export const PARTY_ROOM = "party_room";
export const MAX_PARTY_SIZE = 3; // concept §15.3

export interface PartyJoinOptions extends ClientHandshake {
  readonly joinCode: string | null; // null creates a party; a code joins one
  readonly skillLoadoutIds: readonly string[];
  readonly accessToken: string | null;
}
```

`validatePartyJoinOptions` runs the same handshake, loadout, and token checks the match room runs,
plus two rules specific to this room:

- `joinCode` must be **present**, `null` included. Colyseus builds its matchmaking filter from the
  properties a client actually sent, so an omitted `joinCode` is an *empty filter* — which matches
  any party room, i.e. a stranger's. Refusing the payload keeps that request out of matchmaking
  entirely (`docs/DECISIONS.md` D56).
- A non-null `joinCode` must satisfy `isPartyJoinCode`: eight characters over
  `PARTY_CODE_ALPHABET` (Crockford base32). Shape only — whether a party answers to it, and whether
  it has expired, is the server's to decide, and `PartyRoom#onJoin` re-checks it against the room it
  landed in.

Generation is server-only (`apps/server/src/party/join-code.ts`); this package owns the shape
because both ends check it.

### 10.2 Client → server: four fieldless commands

```ts
export const QUEUE_MATCH_MESSAGE_TYPE = "queue_match";
export const CANCEL_QUEUE_MESSAGE_TYPE = "cancel_queue";
export const REFRESH_JOIN_CODE_MESSAGE_TYPE = "refresh_join_code";
export const LEAVE_PARTY_MESSAGE_TYPE = "leave_party";

export type PartyCommandMessage = Record<string, never>;
```

**None of them has a field**, and that is the design rather than an omission: a command that named a
member would be a client asserting something about another player. The sender is always the subject,
and the server knows who the sender is because it assigned the session. `validatePartyCommandMessage`
still runs — an empty body arriving over a socket is untrusted like any other — and any field a
client attaches is dropped.

Leader-only commands (`queue_match`, `refresh_join_code`) are checked on the server; the client's
panel is a courtesy.

### 10.3 Server → client: the party, the seat, and refusals

The synchronized `PartyState` carries a join code, a leader session id, a status
(`forming | queued | in_match`), the code's remaining lifetime, and a member map of
`{ sessionId, displayName, isLeader, connected }`. **No access token, account id, balance, unlock
list, or inventory is in it** — being in someone's party is not a licence to read their account, and
the way that is enforced is by not putting the data in the document the party receives.

```ts
export const MATCH_READY_MESSAGE_TYPE = "match_ready";

export interface SeatReservationPayload {
  readonly name: string;
  readonly sessionId: string;
  readonly roomId: string;
  readonly processId: string;
  readonly publicAddress?: string;
}
```

`match_ready` carries the seat the server already reserved for this member in a match room. The
client turns it into a connection with `consumeSeatReservation`, and everything after the socket
opens is identical to a solo join — Colyseus runs `MatchRoom#onAuth` with **that member's own**
recorded join options, so every gate (version, token, loadout, unlocks) still runs per member.

It is validated on arrival (`validateSeatReservationMessage`), which is not a formality: `roomId` is
what the client opens a socket to and `sessionId` is the identity it will hold for the match.

`party_error` (`{ code, message }`) reports a refusal *inside* a party the member already belongs
to — not the leader, already queued, no room available, party empty. Refusals at the **door** are
deliberately coarser; see §10.4.

### 10.4 Refusal codes, and why there are two sets

| Constant                            | Value | Transport | Raised by                                     |
| ----------------------------------- | ----- | --------- | --------------------------------------------- |
| `PROTOCOL_MISMATCH_CODE`            | 4001  | WebSocket | seat-consumption gates (match, foundation)    |
| `INVALID_MESSAGE_DISCONNECT_CODE`   | 4002  | WebSocket | repeated invalid messages (§33)               |
| `UNAUTHORIZED_JOIN_CODE`            | 4003  | WebSocket | match-room identity/entitlement refusal       |
| `PARTY_JOIN_REFUSED_CODE`           | 4004  | WebSocket | `PartyRoom#onJoin`'s code check               |
| `INCOMPATIBLE_CLIENT_HTTP_STATUS`   | 426   | HTTP      | party gate, version mismatch                  |
| `INVALID_JOIN_OPTIONS_HTTP_STATUS`  | 400   | HTTP      | party gate, malformed payload                 |
| `PARTY_JOIN_REFUSED_HTTP_STATUS`    | 403   | HTTP      | party gate, unknown/expired/unentitled        |

Colyseus refuses a join in two places over two transports. A refusal raised while a seat is being
*consumed* travels over the WebSocket and carries a close code, which is why the 4000-range
constants exist. A refusal raised during *matchmaking* becomes an **HTTP status**, and a 4000-range
value is not a legal one — constructing that response throws inside Colyseus's router, so the
refusal reaches the client as an unrelated internal error and the message explaining what to do is
lost. Found exactly that way while building the party gate. `authorizeHandshake` takes the code to
use, so one version gate serves both paths.

The party door returns **one code and one message** for unknown, expired, replaced, and full,
because telling them apart would answer questions for whoever is guessing codes
(`docs/DECISIONS.md` D56).

### 10.5 What the match room gained

One field, on the **private** message only:

```ts
export interface LocalPlayerState {
  // …
  readonly partyMemberIds: readonly string[]; // this player's own teammates, in this match
}
```

The synchronized `MatchState` schema gains nothing. A non-party client is told nothing about who is
grouped; a party member is told only ids it already holds from its own roster, of players already in
the public snapshot (`docs/DECISIONS.md` D58).

There is deliberately **no** `partyId` in `MatchJoinOptions`. A party is recorded inside the match
room by the queue, over an in-process call, before the members connect — so there is no field for a
client to forge.
