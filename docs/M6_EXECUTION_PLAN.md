# M6 Execution Plan — Party and Matchmaking

The ordered implementation plan for milestone **M6**, on branch `m6-party`. It follows
`docs/M6_ISSUES.md` (the bounded task list). Where the two disagree, the issue list wins and this
plan is corrected.

Read before starting: `docs/DEVELOPMENT_RULES.md`, `docs/M6_ISSUES.md`, `docs/DECISIONS.md` D7, D8,
D31, D38, D39, D42, D43, D45, D46, D50, D52, D54; technical plan §5.1, §8.1–§8.4, §10.3, §34.1, §35,
§38 M6; concept §8.4, §15.3, §16, §22.1, §23.1, §35.

---

## 1. Order of work, and why this order

M6 is unusual for this repository: it adds a whole subsystem that the simulation never sees. Nothing
below touches `stepSimulation` or any rule module, so the usual "engine first, host later" ordering
does not apply. The order is instead **contract → the thing that cannot be faked → everything that
depends on it**:

1. **Protocol** — the message set and the join-code shape. Both ends check the same thing, so it is
   written once, first.
2. **Join-code generation** — pure, server-side, testable in isolation, and the security claim of
   the milestone (`docs/M6_ISSUES.md` §1.4) rests on it.
3. **`MatchRoom#reserveGroupSeats` and the group hold** — the atomic allocation
   (`docs/M6_ISSUES.md` §1.1). Written before anything that calls it, because if this is not atomic
   nothing above it can be made correct by trying harder.
4. **`MatchQueue`** — candidate selection and serialization, on top of (3).
5. **`PartyRoom`** — roster, code, leadership, and the one button that calls (4).
6. **Client** — the party connection, the loadout panel, seat consumption, markers.
7. **Adversarial tests** — last in file order only; the assertions are fixed by steps 3–5 and several
   are written alongside them.
8. **The four carried-over items** — independent of the above, done as their own commits.
9. **Documents and decisions.**

Steps 1–4 change no existing behavior a current client can observe, which is deliberate: by the time
`PartyRoom` exists (step 5), everything it calls is already covered.

## 2. Invariants to check at every step

- No party code path runs inside `stepSimulation`, or anywhere on the 50 ms step.
- No client-supplied value decides party membership, capacity, or room placement.
- No `await` between the capacity check and `reserveMultipleSeatsFor` (§4 below is where this is
  easy to break).
- The join code appears in no log line, metric, or error message.
- No access token, user id, balance, or unlock list enters synchronized party state.
- Every new untrusted input has a validator in the same change (D23).
- No test asserts a constant equals itself.

## 3. Step 1 — `packages/protocol`

```
rooms.ts       PARTY_ROOM, RoomName
messages.ts    PartyJoinOptions, the four party commands, MatchReadyMessage,
               PartyErrorMessage, PartyMemberView/PartyView/PartyStatus,
               partyMemberIds on LocalPlayerState
party-code.ts  PARTY_CODE_LENGTH, PARTY_CODE_ALPHABET, isPartyJoinCode
validation.ts  validatePartyJoinOptions, validatePartyCommandMessage,
               validateSeatReservationMessage, validatePartyErrorMessage
version.ts     PROTOCOL_VERSION 3 → 4, PARTY_JOIN_REFUSED_CODE = 4004
```

`party-code.ts` is a new file rather than another constant in `messages.ts` because both ends import
it and it is the one piece of the code's design that is a *shared* rule; generation stays on the
server.

Watch for: `validateSeatReservationMessage` runs on the **client**. It is easy to write it as a
formality; it is not one — the payload's `roomId` is what the client opens a socket to.

`CONTENT_VERSION` is deliberately **not** bumped: no content table changes, so no stale client
disagrees about a rule (D34's own condition). The protocol bump alone refuses a stale tab.

## 4. Step 2 — `apps/server/src/party/join-code.ts`

`generateJoinCode()`, `isExpired(mintedAt, now, ttlMs)`. `crypto.randomInt` per character. The module
doc carries `docs/M6_ISSUES.md` §1.4's five properties, because the next person to touch this file is
the one who might shorten the code.

Tests: `join-code.test.ts` — shape agreement with `isPartyJoinCode`, no duplicate in 20 000 draws,
full alphabet coverage, the four ambiguous characters absent, and no shared prefix between
consecutive draws beyond chance.

## 5. Step 3 — `MatchRoom#reserveGroupSeats` and the group hold

The load-bearing method of the milestone, so its shape is fixed here:

```ts
reserveGroupSeats(
  partyId: string,
  members: readonly GroupSeatMember[],   // { sessionId, options }
  roomCache: IRoomCache,
): Promise<GroupSeatOutcome>
```

Body order, and **no `await` between the check and the reservation**:

1. Refuse unless `phase` is `waiting` or `countdown`.
2. Refuse unless `MATCH_MAX_CLIENTS - clients.length - reservedSeatCount >= members.length`.
3. Record `sessionId → partyId` for each member, and a group hold with a deadline.
4. `return matchMaker.reserveMultipleSeatsFor(roomCache, clientsData)` — called **synchronously
   after step 2**, which is what makes the allocation atomic (`docs/M6_ISSUES.md` §1.1).
5. If any seat came back `false` (structurally impossible given 1–2, kept as a defence), withdraw the
   party record and the hold, and report failure so the queue tries another room.

The hold is consumed in `onJoin` and purged on the tick; `tick()`'s `countdown` branch calls
`startMatch()` only when no unexpired hold remains.

`sessionId` for each member is generated here (`generateId`-equivalent), not by the client: it is the
id the member will have in the match, so it must come from the server.

Tests written alongside: a room in `countdown` with three held seats does not start; it starts once
the hold expires; a room holding six refuses a group of three and still reports six.

## 6. Step 4 — `apps/server/src/party/match-queue.ts`

One class, one public method, one promise chain:

```ts
class MatchQueue {
  enqueue(request: GroupQueueRequest): Promise<GroupQueueResult>;
}
```

`enqueue` appends to `this.tail = this.tail.then(...)` so allocations never interleave. Inside:
query, sort fullest-first, ask each live room, else `matchMaker.createRoom(MATCH_ROOM, {})` and
allocate there.

The module doc states plainly that this module — and only this module — is what a future scaling
milestone must rewrite against Colyseus presence, because its correctness is bought by D8.

## 7. Step 5 — `apps/server/src/rooms/PartyRoom.ts`, `PartyState.ts`

Registered with `.filterBy(["joinCode"])`; the room sets `{ joinCode }` as metadata in `onCreate`, so
Colyseus routes a joining member to the right party without the code ever being listable
(`docs/M6_ISSUES.md` §1.4).

`onAuth` runs the same five checks the match room runs, then the code check. `onJoin` adds the member
to `PartyState`. `onLeave` mirrors D39's shape without a simulation to keep them in: mark
disconnected, hold briefly, promote a new leader or dispose.

Message handlers: `queue_match` (leader only), `cancel_queue`, `refresh_join_code` (leader only),
`leave_party`, and the `"*"` fallback that counts and eventually disconnects, exactly as the match
room does.

`server.ts` gains `definePartyRoom(gameServer, { …, queue })` alongside the two existing rooms.

## 8. Step 6 — client

```
apps/client/src/party/party-connection.ts   module-level, outlives scenes
apps/client/src/scenes/LoadoutScene.ts      party panel + code entry + P/J/L/R/Enter
apps/client/src/network/match-connection.ts a second entry point: consume a seat reservation
apps/client/src/scenes/PlayScene.ts         pass the reservation through
apps/client/src/render/world-view.ts        draw a marker over partyMemberIds
apps/client/src/debug/debug-hook.ts         getParty(), getPartyMemberIds()
```

`Enter` keeps its existing meaning outside a party, which is what keeps the thirty existing browser
specs valid without editing them — and if any of them needs editing, that is the signal the panel has
changed something it should not have.

## 9. Step 7 — tests

```
apps/server/test/party-room.test.ts       create/join/code/leadership/disposal
apps/server/test/party-queue.test.ts      exit criterion 1 + the four named cases
apps/server/test/party-isolation.test.ts  exit criterion 2, adversarially
apps/client/e2e/party.spec.ts             three browser contexts, one room
```

The three server files bind a real port, so they join `vitest.config.ts`'s `integration-server`
project (D54's serialised half) rather than running in parallel with it.

## 10. Step 8 — the four carried-over items

Each its own commit, in this order because they get progressively less independent of the rest:

1. **Documents-integrity test** — no production code, immediate value as a guard on step 10.
2. **Production refusal at `createGameServer`** — one guard, one test, no behavior change for any
   supported configuration.
3. **Supabase suite account pooling** — `helpers.ts` plus the two suites; verified by running
   `pnpm test:supabase` and reporting the measured sign-in count.
4. **SDK auto-reconnection** — one shared test helper, one explicit client policy per connection.

## 11. Step 9 — documents

`docs/DECISIONS.md` (D55–D64), `docs/PROTOCOL.md` (M6 status, the new message set, protocol version
4), `docs/TEST_PLAN.md` (the three new server suites and the browser party spec), `README.md` (party
controls), `docs/DEVELOPMENT_RULES.md` (one line: party membership is server-decided).

`.env.example` is unchanged — M6 adds no configuration variable a deployment sets. The two tuning
values it does add (party code TTL, group-hold deadline) are constructor defaults overridable in
tests, like `MatchRoomDeps`' existing timings, not environment variables: a value a test needs and a
deployment never sets does not belong in the environment.

## 12. Verification

All seven gates, run twice: once with the local `.env` present, once with it renamed aside. Plus
`pnpm test:supabase` against the real project, whose result is reported separately because CI cannot
run it.

```
pnpm format:check && pnpm lint && pnpm typecheck && pnpm test && pnpm test:integration && pnpm build
pnpm test:e2e
```

## 13. What this plan will not do

No PvP damage (D41; D59 assigns it a milestone and this is not it). No boss (M7). No deployment
(M8). No migration. No new dependency. No presence, Redis, or second process (D8). No simulation
rule. No lobby, room browser, friends list, or chat.
