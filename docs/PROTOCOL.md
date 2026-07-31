# Network Protocol

Status: **M0 baseline.** This document is authoritative for the client/server wire contract. It
records what exists today and the shapes the next milestones will add, so the contract is designed
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

| Version          | Source                                                     | M0 status                                       |
| ---------------- | ---------------------------------------------------------- | ----------------------------------------------- |
| Protocol version | `PROTOCOL_VERSION` (currently `1`)                         | **Implemented** — the join gate compares on it. |
| Build version    | `GAME_BUILD_VERSION` (server) / `VITE_BUILD_VERSION` (client) | **Implemented** — exchanged, informational.  |
| Content version  | Will accompany `@carry-or-fall/game-content`               | **Reserved** — no content exists in M0.         |

- `PROTOCOL_VERSION` is a small positive integer. Bump it whenever the message contract changes in
  a way an older peer cannot understand.
- `isProtocolCompatible(peerVersion)` uses **exact-match** semantics in M0. A later milestone may
  widen it to a supported range.
- Build version is a semver-like string validated by `isBuildVersion` (`major.minor.patch` with an
  optional pre-release suffix, e.g. `0.0.0-m0`). It is displayed and logged but does not gate the
  join in M0.
- Content version is deferred: there is no game content in M0, so there is nothing whose version
  could disagree. When `game-content` gains real definitions (M2–M3), add a `CONTENT_VERSION`
  constant here and include it in the handshake and the compatibility check.

## 4. The join handshake (what exists today)

M0's only client→server assertion is the version handshake. It is delivered as **Colyseus join
options**, not as a post-join message, so the server can refuse an incompatible client at the join
boundary before it occupies a seat. (This handshake plays the role the technical plan §10 sketches
as a `client_hello`; in this codebase it is the join-options object below, validated in the room's
`onAuth`.)

```ts
// @carry-or-fall/protocol
export interface ClientHandshake {
  readonly protocolVersion: number;
  readonly buildVersion: string;
}
```

Flow:

1. The client calls `joinOrCreate(FOUNDATION_ROOM, { protocolVersion, buildVersion })`.
2. The room's `onAuth(client, options)` runs `validateClientHandshake(options)`.
3. If the payload is malformed, or `isProtocolCompatible(protocolVersion)` is false, the server
   throws `new ServerError(PROTOCOL_MISMATCH_CODE, INCOMPATIBLE_CLIENT_MESSAGE)` — the join is
   refused and no `onJoin` runs.
4. Otherwise the client joins and the server logs `accepted client handshake`.

### Incompatibility behavior

| Constant                     | Value                                                              |
| ---------------------------- | ----------------------------------------------------------------- |
| `PROTOCOL_MISMATCH_CODE`     | `4001` (app-defined 4000+ range)                                  |
| `INCOMPATIBLE_CLIENT_MESSAGE`| `"Your game version is out of date. Please refresh the page to update."` |

On the client, the rejected `joinOrCreate` promise rejects with a `MatchMakeError` carrying that
`code` and `message`; the boot scene surfaces the refresh/update text instead of connecting. This
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

**M0:** none post-join. The handshake is join options (§4).

**M1 (local combat) adds `InputMessage` as a type only.** It is implemented in
`@carry-or-fall/protocol` (`packages/protocol/src/messages.ts`) exactly per the technical plan
§10.2 shape, plus the `INPUT_MESSAGE_TYPE = "input"` message-type constant:

```ts
// @carry-or-fall/protocol (implemented)
export const INPUT_MESSAGE_TYPE = "input";

export interface InputMessage {
  readonly sequence: number; // monotonic per client, for later reconciliation
  readonly moveX: -1 | 0 | 1;
  readonly moveY: -1 | 0 | 1;
  readonly aimAngle: number; // radians
  readonly attackPressed: boolean;
  readonly dashPressed: boolean;
  readonly interactPressed: boolean;
}
```

M1 has no network, so this type is not transmitted over a socket; the local client's own input
capture only needs the subset a given M1 chunk actually consumes (movement's `moveX`/`moveY` first;
`aimAngle`/`attackPressed`/`dashPressed`/`interactPressed` are exercised by later M1 chunks). It
becomes the authoritative wire message at M4, where the server validates every input for numeric
ranges, message frequency, sequence order, allowed action state, cooldowns, and player status
(§10.2) — it stores the latest valid input and advances a fixed simulation step (§9.3). The runtime
validator (`validateInputMessage`) is deferred to M4, the first milestone with an untrusted network
boundary for it to guard (`docs/DECISIONS.md` D23). Prefer compact messages; do not resend large
JSON blobs (§10.1).

The fuller message set arrives with the systems that need it (technical plan §10.1), each added
only when its milestone lands:

| Message                  | Milestone | Purpose                                  |
| ------------------------ | --------- | ---------------------------------------- |
| `input`                  | M1        | movement / aim / attack / dash intent    |
| `attack`, `dash`         | M1        | discrete action intents (may fold into `input`) |
| `interact`               | M2        | pick up loot, begin extraction           |
| `inventory_move`, `secure_item` | M2 | inventory / secure-slot requests         |
| `equip_ground_weapon`    | M2        | swap to a ground weapon                   |
| `replace_wildcard_skill` | M3        | replace the temporary wildcard skill     |
| `ping`                   | M4        | latency measurement                       |

Message-type identifiers will live in the protocol package as string-literal constants (one source
of truth) when the first post-join message is introduced.

## 7. Server → client state

Synchronized room state is server-owned; the client only reads it. M0's state is minimal:

```ts
// @carry-or-fall/protocol — read model mirroring the server Colyseus schema
export interface FoundationRoomState {
  readonly serverBuildVersion: string;
  readonly connectedPlayers: number;
}
```

**M1+ synchronized state** grows to what the technical plan §10.3 lists — per-player id, position,
facing, health, alive status, weapon/armor type, visible skills, and a local-player inventory
summary; plus enemy positions, projectile positions, loot positions, extraction state, match
timer, and party markers. Two rules govern it:

- **Filter private data.** Other clients never receive another player's full inventory or
  secure-slot contents (§10.3).
- **Do not store transient effects in synchronized state.** Short-lived effects are one-shot events
  (§8), not persistent fields (§10.4).

## 8. One-shot events (§10.4)

Transient, fire-and-forget events are sent for things that should play once and not accrue in room
state: hit effects, sounds, damage numbers, extraction start, extraction interruption, loot-pickup
animation, and death effect. **M0 emits none.** They are introduced with the systems that produce
them (combat in M1, extraction in M2). Never persist every short-lived effect in synchronized
state.

## 9. Changing the protocol

When a change makes an older peer unable to understand the wire format:

1. Bump `PROTOCOL_VERSION` (and, once it exists, `CONTENT_VERSION`).
2. Update this document and the affected validators/shapes in `packages/protocol`.
3. Follow the dependency/version upgrade checklist (technical plan §2.7): update the lockfile, run
   all tests, run a two-client multiplayer smoke test, check protocol compatibility, and record
   migration notes.

A backward-compatible addition (a new optional field, a new message type an old peer simply never
sends) does not require a version bump, but must still be validated at the boundary.
