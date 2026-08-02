# M6 Issue List — Party and Matchmaking

Status: **Planned** (implementation follows in the same change set as this document). The bounded
task list for milestone **M6**, per technical plan §38 (M6) and the repository's
per-milestone-issue-list practice established at M1–M5. M6 is implemented after M5 on branch
`m6-party`.

Read before starting: `docs/DEVELOPMENT_RULES.md`, `docs/DECISIONS.md` (D7, D8, D31, D38, D39, D42,
D43, D45, D46, D50, D52, D54), technical plan §3, §5.1, §8.1–§8.4, §10.3, §32.2, §34.1, §35, §38 M6;
concept §8.4, §15, §16, §22.1–§22.2, §23.1–§23.2, §32, §33, §34, §35.

---

## Scope

**Deliver (technical plan §38 M6):** create party, join code, party of three, match queue, shared
party markers.

**Exit criteria (technical plan §38 M6):**

1. A party joins one room together.
2. Individual inventories remain separate.

The first is a **timing** property and is not allowed to be probabilistic — see §1.2. The second is
a **security** property now that accounts exist, and gets the adversarial treatment M4 and M5 used —
see §1.6 and §11.

**Explicitly out of M6** (later milestones or never): player-versus-player damage (D41; assigned a
milestone by D59 and implemented there, not here); the boss, boss skill cores, blueprint loot (M7);
deployment, hosting, regions, CAPTCHA/Turnstile, per-IP matchmaking rate limits, load and soak tests
(M8+, technical plan §30.4/§30.5, §17.4, D50); guilds, friend lists, social graphs, or any social
persistence (technical plan §8.4 forbids them outright: "do not build guilds, friend lists, or
social graphs initially"); voice or text chat (neither document specifies one, and a chat channel is
a moderation surface M9 owns); a room browser or server list (§1.4 — it is also the thing that would
make a join code enumerable); join-in-progress (technical plan §8.3, concept §22.2 both defer it);
group-scaled enemy difficulty or party-shared loot, inventory, or rewards (§1.7, D60); a persistent
ordinary-item stash (concept §7.4 forbids it permanently); in-run leveling or a level-up draft
(`docs/DEVELOPMENT_RULES.md`); mobile controls; client-side prediction (D37); Redis, Colyseus
presence, or a second server process (D8, and §1.1 is the argument for why M6 does not need one);
any new Supabase table, column, or migration (§1.5).

## Architectural constraints (apply to every issue)

- **The simulation stays authoritative and stays in `packages/simulation-core`, on the fixed 50 ms
  step.** M6 adds **no simulation rule at all**: party membership changes no movement, collision,
  damage, loot, extraction, or reward rule. `stepSimulation` and every module it calls are untouched
  by this milestone, and the absence is asserted (§11.5).
- **Clients send intentions, never outcomes**, and technical plan §5.1 names one specifically in its
  "must not decide" list: **party membership authorization**. No client-supplied value decides who
  is in a party or which room a party lands in. §1.3 is how that is made structural rather than
  checked.
- **Runtime validation at every network boundary.** M6 adds four inbound message types and one
  inbound join-options shape; each ships with its validator in the same change (D23).
- **No secret reaches the client bundle or any `VITE_` variable.** M6 adds no secret; it does
  introduce a value that must not be logged or broadcast (the join code, §1.4) and a value that must
  not be broadcast (a member's access token, §1.3), and both are asserted (§11.7).
- **The eight §13.4 caps stay enforced in shared code**, untouched.
- **A fresh clone with no `.env` passes every gate** (D42, D46). The browser suite continues to
  supply its own configuration and to blank the Supabase variables (D51).
- Each issue passes the standard gates (`pnpm format:check`, `pnpm lint`, `pnpm typecheck`,
  `pnpm test`, `pnpm test:integration`, `pnpm build`) plus the browser suite (`pnpm test:e2e`), and
  adds tests for any meaningful rule it introduces.

---

## §1. Scope decisions (recorded here, not improvised silently)

### 1.1 D8 holds, and it is what makes this milestone possible

The obvious reading of D8 is that it is an obstacle: one process, no Colyseus presence, no Redis, so
"matchmaking" is off the table. The opposite is true, and the reason is worth stating precisely
because it is the load-bearing fact of the whole design.

Colyseus reserves a seat by calling `Room#_reserveSeat`, which **checks capacity and records the
reservation with no `await` between the two** (`@colyseus/core@0.17.45`, `Room.mjs`): it evaluates
`hasReachedMaxClients()` and assigns `this._reservedSeats[sessionId]` in one synchronous run.
JavaScript is single-threaded, and D8 guarantees every room lives in that one thread. So a caller
that performs its own capacity check and then calls `matchMaker.reserveMultipleSeatsFor` **in the
same synchronous continuation** cannot be interleaved by any other join: no other `joinOrCreate`,
no other party, no timer.

That is an *atomic all-or-nothing group seat allocation*, obtained for free from the constraint D8
imposes. With a second process it would be false, which is the honest statement of the cost: the
allocator in `apps/server/src/party/match-queue.ts` is precisely the module a future scaling
milestone must rewrite against Colyseus presence, and it says so in its own module doc.

**So D8 does not change.** It is reaffirmed with a new consequence recorded (D55). No Redis, no
presence, no second replica, no new dependency.

### 1.2 "Every time, not usually" — the party lands together by reservation, not by window

D43 sized the browser suite's lobby window from a measurement: a second client takes **620–930 ms**
to reach the same match, and a 1000 ms window left as little as 70 ms of margin, at which point two
clients landed in *different* matches under load. The fix then was a wider window (5000 ms). A wider
window is still a race; M6's requirement — a party of three lands in one room **every time** — cannot
be met by widening it further.

M6 does not use a window at all. When a party queues:

1. The queue picks (or creates) one match room that can seat the whole party.
2. It reserves **N seats at once**, atomically (§1.1). The seats are now *held*: `hasReachedMaxClients`
   counts a reserved seat exactly like an occupied one, so no solo `joinOrCreate` and no second party
   can take them.
3. Each member is handed *its own* seat reservation and connects to it directly
   (`client.consumeSeatReservation`), which is the same primitive Colyseus's own `joinOrCreate` uses
   on its last line.
4. The match room **will not leave `countdown`** while it holds an unconsumed group seat (§1.8), so a
   slow member cannot arrive to find the match already running.

Nothing in that sequence depends on how fast a browser is. The 620–930 ms join is now spent against a
seat that is already the member's, and the only bound on it is Colyseus's own seat-reservation
timeout — 15 s by default, sixteen times the measured worst case, and it is a *deadline for a held
seat*, not a window in a race.

### 1.3 A client cannot name its own party

Technical plan §5.1 lists "party membership authorization" among the things a browser client must
not decide. There are two ways to get that wrong, and M6 avoids both structurally:

- **A client claiming a party at match join.** The obvious implementation — put a `partyId` in the
  match room's join options — is exactly the forgeable design: options are client-controlled, so any
  client could type a `partyId` and be marked as another player's ally. M6 therefore never reads a
  party from join options. The queue calls `MatchRoom#reserveGroupSeats` directly (one process, D8),
  which records `sessionId → partyId` **inside the room** before the members connect. The room reads
  its own record; the join payload has no party field to forge.
- **A client claiming a seat that is not its own.** The seat reservation the server hands a member
  contains that member's `sessionId`, and Colyseus marks a reservation consumed on first use. A
  member who forwarded their reservation to someone else would be giving away their own seat, not
  gaining one; the recipient would still be authenticated as themselves by `MatchRoom#onAuth`, which
  runs at consume time with **that member's own** join options (verified against `@colyseus/core`'s
  `Room#_onJoin`, which calls the instance `onAuth` when the reservation carries no pre-computed
  auth data).

Every existing join gate therefore still runs, per member, unchanged: the version handshake (D18,
D34), the payload validator, the Supabase token verification (D45), the slot-budget check (D38), and
the unlock check (D48). M6 adds nothing to that gate and removes nothing from it.

### 1.4 Join codes: how they are made, how long they live, why they cannot be enumerated

Concept §34 lists "party invitation method" as a deferred decision; §8.4 says only "server returns a
short code". This is the decision (D56), made in a **public repository**, so the reasoning is
written down rather than assumed.

- **Generated by the server, from a CSPRNG.** `crypto.randomInt` per character, over a 32-symbol
  alphabet (digits and uppercase letters with `I`, `L`, `O`, `U` removed — Crockford's base32 set, so
  the code survives being read aloud or typed by a human). Eight characters: **40 bits**, about
  1.1 × 10¹² codes. No counter, no timestamp, no sequence, nothing derived from a user id or a room
  id: two codes minted a millisecond apart share no structure.
- **Never chosen or influenced by a client.** The creating client sends no code, and the server
  regenerates on the (astronomically unlikely) collision with a live party.
- **Not enumerable.** `@colyseus/core@0.17.45` exposes exactly one matchmaking HTTP route,
  `POST /matchmake/:method/:roomName`, with `exposedMethods` limited to
  `joinOrCreate | create | join | joinById | reconnect`. **There is no room-listing route and no
  `getAvailableRooms` in `@colyseus/sdk@0.17.43`**, so room metadata — where the code lives, so that
  Colyseus's own `filterBy` can route a member to the right party — is not readable by any client.
  This is asserted rather than assumed (§11.7). Brute force over `matchmake/join` remains
  theoretically available and is answered by the entropy above; a wrong code returns the same
  "no rooms found" error whether or not any party exists, so a guesser learns nothing from a miss.
- **Bounded lifetime.** A code expires `PARTY_CODE_TTL_MS` (10 minutes) after it is minted, **or**
  when the party ends, whichever is first. Expiry does not end the party: the leader mints a fresh
  code with one keypress, and the old one stops working immediately. This is what keeps a code
  pasted into a public channel from being a permanent door.
- **Not single-use.** A code is a party *address*, not a ticket: two friends use the same code. Reuse
  is bounded by the party cap (three, concept §15.3) and by the TTL. "Already used" therefore means
  "used until the party is full", and a fourth holder of a valid code is refused on capacity — which
  is the case §11.3 tests.
- **Never logged, never broadcast beyond the party.** It appears in the party room's synchronized
  state, which only that party's members receive, and in no log line, metric, or error message.

### 1.5 A party is a live connection group; nothing about it is persisted

D31 made pre-run selection a local, non-persistent client screen and D38 made the chosen loadout
*join options*, deliberately avoiding a lobby. M6 must add party formation without building the
lobby those decisions avoided. It does so by making a party the smallest thing that can carry the
five deliverables:

- A party is **one Colyseus room** (`party_room`), created by its leader, addressed by a join code,
  capped at three (concept §15.3). It holds a roster, a leader, a code, and a queue status. That is
  all it holds.
- It is **not persisted**. No Supabase table, no column, no migration, no row: a party exists while
  its members' party-room connections exist and is gone when the last one goes. A page reload ends
  your membership. This keeps `supabase/migrations/` untouched, so D53's "applying is not verifying"
  obligation does not attach to this milestone (the Supabase suite is still run, for §1.10's reason).
- It is **not a lobby**. There is no room browser, no waiting for strangers, no matchmaking
  preference, no stored loadout preset, no persistent identity beyond the account M5 already gives
  every player. D31's screen keeps its shape: you pick skills locally, then you may create or join a
  party from the same screen.
- It **survives a match**, because members keep the party connection open while they play. That is
  what makes "party persists across runs" true in the only sense M6 offers it: across runs *in one
  sitting*, not across sessions. Concept §33's "party size target is three" and §8.4's seven steps
  are all satisfied; nothing in either document asks for a party that outlives a browser tab.

**Does a party persist across runs now that accounts exist?** Per-session, yes; per-account, no, and
deliberately (D57). An account-persistent party would be a social graph, which technical plan §8.4
forbids at this stage in as many words.

### 1.6 "Individual inventories remain separate" is a security property, not a UI note

Before M5 this exit criterion would have meant "the HUD does not show your teammate's bag". It means
more now: a party member is an authenticated account sitting in the same room as another
authenticated account, and the question is whether being in a party grants any read or write across
that boundary.

The answer M6 implements is **party membership grants shared presence, not shared possessions**, and
it is enforced by the same structural means M4 used rather than by a filter:

- Inventory, secure slot, skill loadout, wildcard skill, and run result are **not in the synchronized
  schema at all** (`MatchState.ts`), so there is no party-aware filtering rule to get wrong. M6 does
  not add one of them to it.
- The per-owner `player_private` message is addressed to one `sessionId` via
  `this.clients.getById(sessionId)?.send(...)`. M6 adds exactly one field to it —
  `partyMemberIds`, a list of session ids (§1.9) — and nothing else.
- There is no client → server message that names another player. `secure_item` and `discard_item`
  name a **slot index on the sender's own inventory**; a party member cannot express "slot 2 of my
  teammate" because the wire has no field for a subject.
- Settlement is triggered by the server observing *that player's* `runResult` and keyed on
  `settlementKey(matchId, userId)` with the user id taken from the token (D45). A party member cannot
  cause, redirect, or read another member's settlement.

§11.1 attacks each of these directly rather than asserting the design.

### 1.7 What M6 could break about concept §35's criteria 8 and 9, and what is deferred

Criterion 8: *solo players can survive without joining a party.* Criterion 9: *parties are useful but
not unbeatable.*

**What M6 could break, and what is done about it:**

- *A party could take a disproportionate share of a room.* Three of eight seats is 37.5%. Two parties
  of three plus two solos fill a room with 75% partied players. M6 does not cap parties per room —
  neither document asks for one, and a cap would have to be a guessed number. What M6 does instead is
  refuse to **split** a party (§1.8), which means a party that does not fit gets its own room rather
  than displacing solos from a full one.
- *Queueing as a party could be faster than queueing solo.* It is not: both paths create a room on
  demand when none is available, so neither waits on the other.
- *A party could gain a mechanical advantage.* It gains none. There is no shared loot, no shared
  inventory, no shared points, no revive, no party-only extraction behavior, no reduced enemy
  aggression, no friendly-fire exemption (there is no friendly fire — D41 defers PvP damage). The
  only in-match difference between a partied and a solo player is a **marker drawn on the party
  member's own screen**. Concept §16.2's real group advantages — coordinated combat, protecting a
  carrier, controlling contested extraction — are all emergent from three humans cooperating, which
  is what §16.3 wants, and none of them is coded.

**What is deferred, and to where:** concept §16.1's solo compensations (lower visibility, smaller
PvE aggro radius, faster extraction, easier routes) are each a *simulation rule with a number in
neither document*. Implementing them inside a matchmaking milestone would be adding gameplay rules
with invented magnitudes, which `docs/DEVELOPMENT_RULES.md` forbids and which could not be judged
without PvP existing. They belong with the balance work in the milestone D59 assigns PvP damage to,
because §16.3's whole claim — "the game should not pretend one solo player and three coordinated
players are equal in a direct fight" — is about a direct fight that does not exist yet. Recorded as
D60.

### 1.8 A party is never split; a room never starts under a party

Two rules, both refusals rather than adjustments, both tested:

- **Never split.** The queue admits a party to a room only if that room can seat **all** of them.
  A party of three offered a room holding six (two free seats) does not put two in and one elsewhere:
  it declines that room and takes the next candidate, creating a fresh room if none fits. §11.2 is
  that test, with exactly the six-player room the brief names.
- **Never start under them.** A match room holds a `countdown` while it has an unconsumed group seat
  reservation, so the members it just promised seats to are not left joining a running match (which
  technical plan §8.3 disables). The hold is bounded: each reservation carries a deadline, and an
  expired one is dropped so a member who never arrives cannot stall a match indefinitely. Solo joins
  are unaffected — they consume their seat within milliseconds of receiving it.

### 1.9 Party markers are rendering, and they tell a non-party player nothing

Concept §8.4.6 requires "shared visual identifiers"; §23.1 lists "party status" in the HUD.

The delivery channel is the **per-owner private message**, not synchronized state: each client is told
the session ids of *its own* party members who are present in this match, and draws a marker over
them. Consequences, stated because they are the security claim:

- A non-party player receives **nothing at all** about who is grouped — not a party id, not a colour
  index, not a count. The public `PlayerState` schema gains no field in M6.
- A client therefore learns nothing about a player it could not already see: the ids it is given are
  ids of players already in the public snapshot, and it is told only which of them are its own
  teammates, which it necessarily already knows from the party roster it is a member of.
- The marker grants **no authority**: it is drawn from a list the server sent, it changes no input the
  client may send, and there is no message whose validity depends on it. Deleting the marker code
  would change nothing except what is on screen.

The alternative — publishing party membership to everyone, so opponents can see a group coming — is a
*gameplay* choice about concept §15.1 ambush decisions that neither document makes. It is not taken,
because private is the choice that cannot leak.

### 1.10 Four items carried over from M4 and M5

M6 closes these; each is an issue below rather than a footnote.

- **Production must refuse to start without Supabase** (§9). Verified empirically first: `index.ts`
  *already* refuses (`assertPersistenceConfigured`, D46), and running
  `NODE_ENV=production tsx src/index.ts` with no credentials exits non-zero with that message. What
  is genuinely missing is that the refusal lives in the **process bootstrap**, while the two
  behaviors it exists to prevent — minting local identities (D45) and provisioning every unlock
  (D49) — are chosen in `createGameServer`, which has no guard of its own. §9 moves the invariant to
  where the behavior is decided.
- **A documents-integrity test** (§10). Every `D<n>` referenced anywhere under `docs/` must have a
  matching `## D<n>.` heading in `docs/DECISIONS.md`, and the headings must run 1..N with no gap.
  D26/D27 were once deleted by a hand edit while twenty-odd references remained (D26's own
  "Restored" note records it); nothing in the repository would have caught that.
- **The Supabase suite must stop exhausting the anonymous sign-in limit** (§12). D52 raised a
  production rate limit from 30/hour to 100/hour for a test's convenience and is explicitly
  "to be reverted before M8". The fix is in the suite: pool and reuse accounts where a test does not
  need a fresh identity, wipe their rows between tests so isolation is unchanged, and delete every
  user the suite created. The resulting sign-in count is reported so the limit can go back to 30.
- **D54's SDK auto-reconnection** (§13). `@colyseus/sdk` re-enables automatic reconnection on its own
  timers once a room exceeds 5 s uptime; D54 recorded that our tests escape it only because rooms are
  short-lived. M6's party rooms live for whole matches, so the escape is gone. Addressed deliberately
  rather than left to surface as flake.

---

## §2. M6.1 — Protocol: the party contract

**Deliver:** in `packages/protocol`:

- `PARTY_ROOM = "party_room"` (`rooms.ts`), added to `RoomName`.
- `PartyJoinOptions extends ClientHandshake` — `accessToken`, `skillLoadoutIds`, and
  `joinCode: string | null` (`null` creates a party; a string joins one).
- Client → server: `QUEUE_MATCH_MESSAGE_TYPE`, `CANCEL_QUEUE_MESSAGE_TYPE`,
  `REFRESH_JOIN_CODE_MESSAGE_TYPE`, `LEAVE_PARTY_MESSAGE_TYPE` — each a bare command with no
  payload fields, and each still validated (a command whose body must be an object with nothing
  trusted in it is still an untrusted body).
- Server → client: `MATCH_READY_MESSAGE_TYPE` carrying a `SeatReservationPayload`
  (`name`, `sessionId`, `roomId`, `processId`, optional `publicAddress`) and
  `PARTY_ERROR_MESSAGE_TYPE` carrying `{ code, message }`.
- Read models: `PartyMemberView`, `PartyRoomState`, `PartyView`, `PartyStatus`
  (`"forming" | "queued" | "in_match"`).
- `partyMemberIds: readonly string[]` added to `LocalPlayerState` (§1.9).
- Join-code shape: `PARTY_CODE_LENGTH`, `PARTY_CODE_ALPHABET`, `isPartyJoinCode(value)` — shared, so
  the picker refuses a malformed code before it reaches the network and the server refuses it again
  after.
- `PARTY_JOIN_REFUSED_CODE = 4004`, distinct from 4001/4002/4003 because the remedy is different: a
  refreshed page does not fix a wrong code.
- `PROTOCOL_VERSION` 3 → 4.

**Validators (D23, all in this same change):** `validatePartyJoinOptions`,
`validatePartyCommandMessage`, `validateSeatReservationMessage` (**client-side**: the seat
reservation is a payload the client acts on by opening a socket, so it is checked before it is
trusted), `validatePartyErrorMessage`.

**Non-goals:** any field naming another player; any field carrying a reward, point value, unlock, or
outcome; a party id in `MatchJoinOptions` (§1.3).

**Tests:** every validator rejects a wrong type, a wrong length, a missing field, and an
out-of-alphabet code; `isPartyJoinCode` agrees with the generator (§3) over a large sample;
`PROTOCOL_VERSION` bumped alongside a message-set change.

## §3. M6.2 — Join-code generation

**Deliver:** `apps/server/src/party/join-code.ts` — `generateJoinCode()` using `crypto.randomInt`
over `PARTY_CODE_ALPHABET`, and `JoinCodeClock`/TTL helpers so expiry is injectable in tests.

**Rules:** §1.4's five properties. The alphabet and length live in `packages/protocol` because both
ends check the shape; only generation is server-side, because only the server may mint one.

**Tests:** generated codes always satisfy `isPartyJoinCode`; 20 000 generated codes contain no
duplicate and use the whole alphabet (a generator stuck on a subset would pass a shape check); no
generated code contains `I`, `L`, `O`, or `U`; codes are not ordered or sequential — two consecutive
codes share no common prefix beyond chance. Deliberately **not** a test that a constant equals
itself: nothing here asserts `PARTY_CODE_LENGTH === 8`.

## §4. M6.3 — `party_room`: create, join by code, roster, leadership

**Deliver:** `apps/server/src/rooms/PartyRoom.ts` and `PartyState.ts`.

- `maxClients = MAX_PARTY_SIZE = 3` (concept §15.3).
- `onAuth`: the **same** gate the match room runs — `authorizeHandshake` (D18/D34),
  `validatePartyJoinOptions`, token verification (D45), `createSkillLoadout` (D38), unlock check
  (D48) — because a party member's loadout is the loadout they will carry into the match, so
  refusing it here is refusing it at the earliest honest moment.
- Creation: `joinCode === null` → the room mints a code and the joiner becomes leader.
  Joining: a code → Colyseus's `filterBy(["joinCode"])` routes to the room whose metadata carries it;
  `onAuth` re-checks the code against the room's current one and its TTL, and refuses with
  `PARTY_JOIN_REFUSED_CODE` if it has expired or been replaced.
- Synchronized `PartyState`: `joinCode`, `leaderSessionId`, `status`, and a member map of
  `{ sessionId, displayName, isLeader, connected }`. **No access token, no user id, no balances, no
  unlock list, no inventory** — the state a party member sees about another member is a name and a
  connection light.
- Leadership: the creator leads; if the leader leaves, the earliest-joined remaining member is
  promoted; the last member leaving disposes the room and with it the code.
- Disconnect (D39's shape, applied to a room with no simulation): an unconsented drop marks the
  member `connected: false` and holds their seat for a short window; reconnecting restores it;
  letting it lapse removes them from the roster. A member who drops **while queued** is handled in
  §5.

**Non-goals:** chat, ready-checks, kick/ban, invites by user id, party names, persistence.

**Tests:** §11.3.

## §5. M6.4 — The match queue: atomic group seat allocation

**Deliver:** `apps/server/src/party/match-queue.ts`.

- `MatchQueue#enqueue(request)` — serialized through a single promise chain, so concurrent parties are
  processed one at a time and the "two parties queue at once" case is deterministic rather than
  lucky. This is the *queue* technical plan §38 M6 asks for and §8.3 calls "short": it resolves
  immediately, because a room is created on demand when none fits (§1.7), so nobody waits on a
  population that does not exist yet.
- Candidate selection: `matchMaker.query({ name: MATCH_ROOM, locked: false })`, fullest-first, each
  candidate asked — through the live room instance, `matchMaker.getLocalRoomById` (D8, §1.1) — whether
  it can seat the **whole** party right now.
- Allocation: `MatchRoom#reserveGroupSeats(partyId, members, roomCache)` performs the capacity check
  and `matchMaker.reserveMultipleSeatsFor` with no `await` between them (§1.1), records
  `sessionId → partyId`, and registers the group hold (§1.8).
- Failure: if no room fits, create one and allocate there. If *that* fails, the party is told so with
  a `party_error` and stays in `forming`; no member is left holding a seat in a room the others
  are not in.

**Non-goals:** skill-based matchmaking, region selection, queue priority, backfill, join-in-progress.

**Tests:** §11.2.

## §6. M6.5 — `match_room` changes

**Deliver:** three additions to `apps/server/src/rooms/MatchRoom.ts`, all outside `stepSimulation`:

1. `reserveGroupSeats(...)` (§5) plus the `sessionId → partyId` registry it writes.
2. The group hold: `countdown` does not advance to `running` while an unexpired group reservation is
   unconsumed; `onJoin` clears the member's hold; expired holds are purged on the tick.
3. `partyMemberIds` in the private-state message: for each player, the session ids of the *other*
   members of their party who are currently in this room. Folded into `privateStateSignature` so it
   is resent when a teammate joins, dies, or leaves.

**Non-goals:** a `partyId` field on the public `PlayerState` schema (§1.9); any party-aware gameplay
rule; any change to `onAuth`'s existing four checks.

**Tests:** §11.1, §11.2.

## §7. M6.6 — Client: the party connection

**Deliver:** `apps/client/src/party/party-connection.ts` — a module-level connection that outlives a
scene, because the party must survive `LoadoutScene → PlayScene → LoadoutScene` (§1.5). It exposes
the party view, create/join/leave/queue/refresh-code commands, and the seat reservation delivered by
`match_ready`. Its reconnection policy is explicit rather than inherited (§13).

**Non-goals:** any client-side decision about membership, capacity, or which room the party enters.

**Tests:** the seat-reservation validator (§2); the party view mapper.

## §8. M6.7 — Client: loadout-screen party panel, seat consumption, markers

**Deliver:**

- `LoadoutScene`: a party panel showing the roster, the code, and the status; `P` creates a party,
  `J` opens code entry (typed characters, Backspace, Enter to submit, Escape to cancel), `L` leaves,
  `R` refreshes the code (leader only). **`Enter` keeps its meaning**: start a run. In a party, the
  leader's Enter queues the party; a member's Enter says the leader starts the match. Not in a party,
  it starts a solo run exactly as before — which is why all thirty existing browser specs stay valid.
- `MatchConnection`: a second entry point that **consumes a seat reservation** instead of calling
  `joinOrCreate`. Everything after the socket opens is identical.
- `PlayScene`: accepts a seat reservation in its scene data and passes it through.
- `WorldView`: draws a marker over each id in `partyMemberIds`, and over nobody else.
- Debug hook: `getParty()` and `getPartyMemberIds()`, read-only like every other method on it.

**Non-goals:** a lobby screen, a room browser, a friends list, party chat, a party cosmetic.

**Tests:** §11.4.

## §9. M6.8 — Production refuses to start without persistence, at the seam that decides

**Deliver:** `createGameServer` refuses to build a server when `NODE_ENV=production` and the store it
was given is not Supabase-backed — the same invariant `index.ts` already enforces, moved to where the
two consequences are actually chosen (the token verifier, D45; the unlock grants, D49). `index.ts`
keeps its earlier, cheaper check so a misconfiguration still fails before a socket is opened.

**Tests:** §11.6.

## §10. M6.9 — Documents integrity test

**Deliver:** `docs`-scoped test asserting: every `D<n>` reference under `docs/` resolves to a
`## D<n>.` heading in `docs/DECISIONS.md`; headings are unique; headings run `1..N` with no gap; and
`DECISIONS.md` is append-only in the sense that matters — a superseded entry is *marked* superseded
and still present, so a heading may never disappear.

**Tests:** §11.8.

## §11. M6.10 — Tests

### 11.1 `party-isolation.test.ts` — exit criterion 2, adversarially

A real server, a real party of three in one match room, and one member attacking the others. Each
must be **refused**, and refusal must be observable rather than assumed:

1. **Inventory read.** Member A's `player_private` messages are collected; none carries B's or C's
   inventory, secure slot, skills, wildcard, or run result. The public snapshot is inspected for the
   same fields, in case a later change adds one to the schema.
2. **Inventory take.** A sends `secure_item`/`discard_item` for every slot index while B holds items;
   B's inventory is unchanged and A's own is what changed (or nothing did).
3. **A forged message naming another player.** A sends `{ type: "secure_item", sourceSlot: 0,
   targetPlayerId: <B> }` and `{ type: "steal_item", … }`; the first ignores the extra field entirely
   and the second lands in the `"*"` handler, is counted, and disconnects A after repeated attempts.
4. **Secure slot.** A secures an item; B's secure slot stays empty and B's private state never
   mentions A's item.
5. **Loot.** A and B contest one ground item; exactly one gets it and the other's inventory does not
   contain it — party membership grants no shared pickup.
6. **Progression.** A's settlement awards A only; B's and C's balances are unchanged, and the
   settlement message A receives is not delivered to B or C.
7. **Settlement forging.** A sends a fabricated `settlement` message naming B; nothing is written and
   A is counted invalid.
8. **Party membership forging.** A client joins the match room directly with `partyId` in its options
   and is *not* marked as anyone's teammate — the field is never read (§1.3).

### 11.2 `party-queue.test.ts` — exit criterion 1, and the four named cases

1. **A party of three lands in one room, repeatedly.** Asserted on room id and on each member's view
   of the roster, over several consecutive allocations so a one-off pass is not mistaken for the
   guarantee.
2. **A party of three offered a room already holding six** does not split: all three land in a
   *different* room, together, and the six-player room still holds six.
3. **Two parties queue at once**: six seats are allocated with no overlap and no overcommit; each
   party is intact; a room never exceeds `MATCH_MAX_CLIENTS`.
4. **A member disconnects mid-queue**: the allocation either includes them (their seat is held and
   expires cleanly) or the party queues without them, but never lands two members in one room and one
   in another. **A member disconnects mid-match**: D39's window applies to them exactly as it does to
   a solo player, and their teammates' markers reflect it.
5. **A room does not start under an unconsumed group reservation**, and does start once the hold
   expires.

### 11.3 `party-room.test.ts`

Create; join by code; the third member fills the party; a **fourth** holder of a valid code is refused
on capacity; a **malformed** code is refused by the validator without reaching matchmaking; an
**unknown** code is refused with `PARTY_JOIN_REFUSED_CODE`; an **expired** code is refused while the
party still exists, and a refreshed code works; leadership passes when the leader leaves; the room
disposes when the last member leaves; a non-leader's `queue_match` is ignored; the synchronized state
never contains an access token or a user id.

### 11.4 `party.spec.ts` (browser, three contexts)

Three independent browser contexts — three real Chromiums, three storages, three sockets. One creates
a party and reads its code off its own screen state; the other two join with it; the leader queues;
all three land in **one room**, asserted as: each client's snapshot lists the same three player ids,
each client's own id is among them, the seeds and arena agree, and each client's marker list names
exactly the other two. Then: each client's private inventory is its own, and a pickup by one is not in
another's inventory.

### 11.5 Architecture assertions

`apps/client/src` still contains no `stepSimulation`/`createSimulation` (existing);
`packages/simulation-core/src` contains no occurrence of `party`, so the claim "M6 adds no simulation
rule" is checked rather than stated; `MatchState.ts` declares no party field.

### 11.6 Production-refusal test

`createGameServer` throws under `NODE_ENV=production` with a memory store, and the message names the
consequence. Both named behaviors are asserted specifically: no `LocalTokenVerifier` and no
all-unlock provisioning can be selected in production.

### 11.7 Secret- and code-exposure assertions

The join code never appears in a log line (asserted against a capturing logger across create, join,
refuse, and expire); the party room's synchronized state carries no `accessToken`; the production
client bundle contains no new server-only variable name; `@colyseus/sdk`'s client surface exposes no
room-listing method (§1.4's non-enumerability claim, checked against the installed package rather
than remembered).

### 11.8 Documents-integrity test

Described in §10. It passes at the moment it is written (D1–D54 are all present and referenced) and
its value is entirely prospective, which is stated in its own module doc so nobody mistakes a green
run for an idle test.

## §12. M6.11 — The Supabase suite stops spending the sign-in limit

**Deliver:** a pooled-account helper in `apps/server/test-supabase/helpers.ts`:

- `acquireAccount()` hands out an account from a per-file pool, signing in only when the pool must
  grow.
- `resetAccount(userId)` deletes that user's rows from all seven tables through the service client,
  so a reused account starts each test as empty as a fresh one — isolation is preserved by wiping,
  not by creating.
- Every pooled user is deleted in the file's teardown, so the suite leaves no anonymous users behind
  (D50's accumulation problem, which Supabase never cleans up).
- The suite counts its own sign-ins and prints the total, so the number in the report is measured.

The two files that genuinely need a *fresh* identity keep one, and say why: the row-level-security
file links an anonymous account to a permanent one (property 7), which mutates the account
permanently.

**Tests:** the suite is the test. Its pass, and its sign-in count, are reported.

## §13. M6.12 — SDK auto-reconnection, deliberately

**Deliver:** D54's recorded hazard, closed rather than avoided:

- Server-side integration tests that need an unconsented drop to **stay** dropped set
  `room.reconnection.enabled = false` on the SDK room before dropping it, via one shared helper so it
  is not remembered per test.
- The client's *party* connection has an explicit policy: reconnection stays enabled (a party
  outliving a network blip is the desired behavior), bounded by the party room's own reconnect window,
  and a failure surfaces as a status the panel shows rather than a silent retry loop.
- The client's *match* connection keeps its existing single explicit reconnect attempt (M4) and
  disables the SDK's automatic one, so there is exactly one reconnection policy in force rather than
  two racing.

**Tests:** a room held open past the SDK's 5 s `minUptime` and then dropped does not reconnect when
the policy says it must not — which is the case D54 predicted would start firing.

---

## §14. Verification

All seven gates, twice: once with the local `.env` present, once with it renamed aside (D42/D46's
fresh-clone check).

```
pnpm format:check && pnpm lint && pnpm typecheck && pnpm test && pnpm test:integration && pnpm build
pnpm test:e2e
```

Plus `pnpm test:supabase` against the real project — not because M6 touches
`supabase/migrations/` (it does not, §1.5), but because §12 changes that suite and a suite whose
change is unverified is not a fix.

## §15. What this milestone will not do

No PvP damage (D41, D59). No boss or boss core (M7). No deployment, hosting, or rate-limit
configuration (M8). No migration, table, or column. No new dependency. No new simulation rule, no
change to the fixed 50 ms step, no weakening of a §13.4 cap. No second server process, no presence,
no Redis (D8 holds — §1.1). No social graph, friends list, or chat. No secret anywhere outside the
gitignored `.env`.
