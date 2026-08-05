# Test Plan

Status: **M7 (boss and core unlock).** The testing strategy for the project: the layers, what each covers, what
exists today, and what each future milestone must add. Follows the technical plan §30 and the
`docs/DEVELOPMENT_RULES.md` rule "Tests for every meaningful rule."

## 1. Principles

- **Test every meaningful rule.** A meaningful rule is behavior that could plausibly break: a
  validator rejecting bad input, the room refusing an incompatible client, a cap holding, a seeded
  RNG being reproducible, loot changing a build, a reward settling once.
- **Do not write tests that assert a constant equals itself.** `expect(PROTOCOL_VERSION).toBe(1)`
  proves nothing about behavior; if the constant changes the test just changes with it. Test the
  _rule_ the constant participates in instead (e.g. that `isProtocolCompatible` accepts an equal
  peer and rejects a different one).
- **Type checking is not testing.** Vitest transforms TypeScript but does not type-check it. Run
  `pnpm typecheck` (a separate `tsc --noEmit` per project) alongside the tests (technical plan
  §30.1).
- **The server is the unit under test for multiplayer rules.** Validate authoritative rules on the
  server, never by trusting a client (`DEVELOPMENT_RULES.md`; technical plan §5).
- **Automated tests do not replace playtesting.** A suite can confirm a hammer deals 20 damage; it
  cannot confirm the hit feels good. Human playtesting stays mandatory (technical plan §45).

## 2. Layers

### 2.1 Unit tests (Vitest) — `pnpm test`

Fast, dependency-free tests of pure logic in `packages/*`. Glob: `packages/*/src/**/*.test.ts`
(the Vitest `unit` project). Scope per technical plan §30.1: stat derivation, skill compatibility,
effect caps, inventory movement, secure slot, point conversion, extraction calculation, reward
payload generation, duplicate-unlock conversion, cooldown validation.

**Exists today (36 files, 478 tests)**, covering the simulation and content rules shipped through
M7, including wire validators, multiplayer, parties, persistence contracts, and the boss/core loop.
The ones worth naming here because they guard an authority invariant:

- `packages/protocol/src/validation.test.ts` — every validator accepts the exact legal shape and
  rejects the wrong type, the missing field, `NaN`/`Infinity`, the out-of-range enum, the negative
  or fractional slot index, and the oversized array. One case asserts specifically that a fabricated
  `x`/`damage`/`pointsGained` on an otherwise-valid input **does not survive validation**.
- `packages/protocol/src/version.test.ts` — protocol and content compatibility each accept an equal
  peer and reject a differing one.
- `packages/simulation-core/src/multiplayer.test.ts` — the rules only a world with several players
  can show: independent movement, one player's death not stopping another's match, a dead player's
  loot becoming lootable, a contested pickup resolving to exactly one holder, two players extracting
  independently, the chaser retargeting, the §13.4 active-projectile cap holding **per owner**, join
  and leave, and determinism from a seed plus a per-tick input script.
- `packages/game-content/src/arena.test.ts` — no spawn point sits inside a wall or outside the
  arena, there are at least eight distinct player spawns for a full room, and the open lane is
  genuinely open.

### 2.2 Room integration tests (Vitest) — `pnpm test:integration`

Exercise the authoritative Colyseus server end to end against a real listening server. Glob:
`apps/*/test/**/*.test.ts`. Scope per technical plan §30.2: create a room, join simulated clients,
send messages, verify synchronized state, test disconnects, room disposal, extraction, and
death/dropped loot.

**One gate, two Vitest projects** (`docs/DECISIONS.md` D54). `pnpm test:integration` runs
`--project integration --project integration-server`. The 11 files that bind a real TCP port and
run a real Colyseus server are the `integration-server` project. Both projects selected by this gate
are capped at **two file workers** (`maxWorkers: 2`, D72), because Vitest requires projects in one
scheduling group to share the value. Unbounded parallelism on a loaded Windows machine exposed a
native `0xC0000409` worker loss with no JavaScript error, so a whole file could silently vanish from
the counts. The bounded gate is the mitigation; the
`vitest.incomplete-run.ts` reporter is the guarantee, because it fails loudly whenever any file did
not report.

**Exists today (23 files, 225 tests; the previous 22-file/222-test readiness measurement took
224.21 seconds):**

The immediately preceding one-worker baseline was 423.67 seconds. Its 11 real-server files consumed
409.42 seconds, led by `settlement-adversarial` (100.38 s), `boss-core-decision` (95.20 s), and
`match-authority` (71.99 s). Two workers kept all 22 files / 222 tests and reduced wall time by
199.46 seconds. Aggregate test time rose from 416.61 to 435.51 seconds, the deliberate CPU/resource
contention trade for the shorter gate. Both configurations were measured after clearing ports
2567/5173 with no other repository command running; Windows background scheduling cannot be made
identical, so these are local comparison data, not a universal duration guarantee.

- `apps/server/test/match-room.test.ts` — the full §30.2 list against the match room: two clients
  join one room and start together; the room locks at match start so a third client gets a different
  match (D7); players spawn apart; movement is visible to the other client; enemies are identical
  across clients; each client receives its own private state and none of another's; incompatible
  protocol/content versions and illegal loadouts are refused at join; loot pickup, secure, discard,
  and extraction each work through real messages; a player who stands in the chasers dies and drops
  their loot; a disconnected player stays in the world but stops moving; an abandoned run drops its
  loot; a deliberate leave frees the seat; the room disposes when empty.
- `apps/server/test/match-authority.test.ts` — **the adversarial suite** (§38 M4 exit criterion 2).
  Every test attempts a cheat and asserts the server's own state is unchanged. See §3.1.
- `apps/server/test/foundation-room.test.ts` — health endpoint returns the build/protocol versions;
  `/health` CORS reflects an allowed origin and withholds it from a disallowed one; a compatible
  client joins and reads authoritative state; the connected-player count increments on join and
  decrements on leave; the room disposes once empty; an incompatible protocol version and a
  malformed handshake are each refused at join with the mismatch code and refresh message.
- `apps/server/test/build.test.ts` — the esbuild server bundle builds and emits a runnable entry.
- `apps/client/test/build.test.ts` — the Vite client production build emits `index.html`.

**Added in M6:**

- `apps/server/test/party-queue.test.ts` — **§38 M6 exit criterion 1.** A party of three lands in
  one room over consecutive allocations; a party offered a room already holding six is not split and
  takes another room, together, leaving the crowded room untouched; a party *is* seated into a room
  that can still hold it; two parties queueing at the same instant stay intact and no room exceeds
  its cap; the lobby is **held** while a promised seat is unconsumed, and starts once the hold
  expires; a member who drops mid-queue is queued without rather than split off; D39's disconnect
  policy applies unchanged to a party member mid-match; and an outstanding reservation is counted as
  an occupied seat (which is what keeps a party from overcommitting a room).
- `apps/server/test/party-isolation.test.ts` — **§38 M6 exit criterion 2, adversarially.** Three
  real accounts in one match, one attacking the others: reading a teammate's inventory, securing or
  discarding their items across every slot index, forging a message that names them as its subject,
  sharing a pickup, settling their run, fabricating a settlement, and joining with a `partyId` in
  the options to be marked as somebody's ally. Each is refused, and the refusal is asserted against
  the *victim's* authoritative state.
- `apps/server/test/party-room.test.ts` — creation, routing by code, the three-player cap, leadership
  succession, disposal, and every way a code can fail (malformed, absent, unknown, expired,
  replaced, full, client-chosen) — including that the refusal *message* reaches the client and that
  the SDK exposes no way to list rooms or read their metadata.
- `apps/server/test/sdk-reconnection.test.ts` — D54's prediction: a room held past the SDK's
  `minUptime` and then dropped stays dropped.
- `apps/server/test/architecture.test.ts` — `simulation-core` knows no party concept, the
  synchronized schema has no party field, and the marker list exists on exactly two files.
- `apps/server/test/production-persistence.test.ts` — `createGameServer` refuses a production build
  on non-persistent progression, at the seam where the local verifier and the all-unlock grant are
  chosen (D61).
- `apps/server/test/decisions-integrity.test.ts` — every `D<n>` cited under `docs/` resolves, and
  the numbering has no gap (D62).
- `apps/server/test/join-code.test.ts` — properties of the *output* of join-code generation: full
  alphabet coverage, no duplicates across 20 000 draws, no sequential structure.

These use the `@colyseus/sdk` client against a server on an ephemeral port; there is no dependency
on `@colyseus/testing` (see `docs/DECISIONS.md` D5).

### 2.3 Browser tests (Playwright) — active (pulled forward to M3)

Per technical plan §30.3: landing page, anonymous sign-in, loadout selection, joining a room, the
reconnect screen, extraction result, the account-link warning, and supported-browser smoke tests.
Do not use Playwright to verify every combat frame.

**Status: installed and active as of M3** (`docs/DECISIONS.md`, the entry recorded alongside this
change) — pulled forward from its original M5 deferral. The M3 follow-up task that added this layer
could not otherwise verify, in a real browser, that equipped skills actually apply during a running
game; four prior sessions had reported the same "cannot visually verify the client" gap. Technical
plan §30.3 requires this layer eventually, and §38 M4 requires "two real browsers can play" — both
already presuppose the capability, so building it now rather than at M5 is bringing forward
required infrastructure, not scope creep.

**What exists today:** `apps/client/playwright.config.ts` and 35 tests across six specs:
`arena.spec.ts`, `boss.spec.ts`, `loadout.spec.ts`, `multiplayer.spec.ts`, `party.spec.ts`, and
`skills.spec.ts`. They run via `pnpm run test:e2e` and drive a real Chromium instance against
the real Vite **dev** server (never the production build) **and the real game server**, which the
Playwright config now starts as a second `webServer`: from M4 the client cannot play without it.
Input is real keyboard/mouse events into the `<canvas>` — Phaser renders to canvas, not DOM nodes,
so no test asserts on DOM text. State is read back through a dev-only debug hook
(`apps/client/src/debug/debug-hook.ts`), installed on `window.__CARRY_OR_FALL_DEBUG__` only when
`import.meta.env.DEV` is true:

```ts
export interface CarryOrFallDebugHook {
  readonly getSnapshot: () => MatchView | null; // the latest authoritative snapshot
  readonly getLocalPlayerId: () => string | null; // this client's own player id
  readonly getPrivateState: () => LocalPlayerState | null; // this client's inventory/skills/result
  readonly getConnectionStatus: () => string;
  readonly getActiveSceneKey: () => string | null; // "loadout" | "play" | "boot" | null
}
```

From M4 what the hook exposes is **what the server sent**, not a locally simulated world — the client
no longer has one — and specifically the latest *authoritative* snapshot rather than the interpolated
render frame, so rendering smoothness never changes what a test sees.

`multiplayer.spec.ts` is §38 M4's first exit criterion: two independent browser **contexts** (not
two pages in one context — separate storage, separate sockets, the closest thing to two machines)
join one server and play the same match. It asserts each sees the other move, enemies agree across
both, loot taken by one is gone for the other and cannot be taken twice, and one client extracts
independently while the other plays on.

The hook is **observation only** — every method returns state the client already received; nothing
on it can change game state, issue input, or run a game rule (technical plan §5.1's "client sends
intent, renders state" is unaffected by a read-only observer). It is verified absent from the
production bundle by `apps/client/test/build.test.ts` (an assertion the built JS output does not
contain the hook's `window` key), which runs under the existing `pnpm test:integration` gate — not
part of the Playwright suite itself.

`apps/client/test/architecture.test.ts` sits alongside it under the same gate and enforces the M4
invariant the whole milestone rests on: no file under `apps/client/src` references
`stepSimulation` or `createSimulation`. There is one simulation and it runs on the server; a
"just for smoothing" local step would fail the build.

**The suite configures itself.** `playwright.config.ts` supplies every variable both servers need —
the client's `VITE_GAME_SERVER_URL` and `VITE_BUILD_VERSION`, the server's `PORT`,
`ALLOWED_ORIGINS`, `MATCH_SEED`, and `MATCH_LOBBY_MS` — through its `webServer` `env` blocks. It
must, and the rule is worth stating plainly: **an automated suite may not depend on a file that
policy forbids committing.** The repository-root `.env` is gitignored (`DEVELOPMENT_RULES.md`: only
`.env.example` is tracked), so it cannot exist on a CI runner or a fresh clone. A suite that reads it
passes only on the machine that created it. Verify any change here the same way: rename your local
`.env` aside and run the suite.

`MATCH_LOBBY_MS` is **sized from a measurement, not a guess**, and the reason is worth keeping.
The countdown starts when the first client joins and the room locks when it expires (technical plan
§8.3), so it is also the entire window in which a *second* browser can reach the same match. That
second join measures 620-930 ms unloaded. A one-second lobby therefore left as little as 70 ms of
margin: it held when a two-client spec ran alone and failed inside the full suite, where the clients
landed in **different matches** and every assertion about "the other player" waited out its timeout —
which looked like a mysteriously slow test rather than a broken premise. Confirmed by shrinking the
window to 300 ms, at which the clients split on every attempt. Five seconds is roughly five times the
measured join; `joinSameMatch` also asserts the two clients really did land together, so a future
violation is named immediately instead of being paid for in timeouts.

Two of those variables are about time rather than reachability. `MATCH_SEED` pins spawn placement so
a test that walks to "the first extraction point" gets the same one every run (technical plan §9.4
asks for reproducible seeded tests). `MATCH_LOBBY_MS` shortens the pre-match countdown from eight
seconds to one: the countdown exists so a human can join a friend's match (concept §22.2), and a
suite that drives both clients itself is only watching a timer. Both are **server** configuration,
read from the environment exactly like `PORT`; `apps/client/test/build.test.ts` asserts neither
appears in the client production bundle, because a client able to set its own countdown or seed would
be a client asserting a match rule.

**CI wiring:** the Playwright suite runs as a **separate CI job** (`.github/workflows/ci.yml`'s
`browser` job), not a seventh step in the existing `verify` job. Reason: browser tests are
categorically slower (a real Chromium instance, real animation-frame timing, `walkToward`-style
navigation against a live, moving enemy) and have different failure modes (timing sensitivity,
headless-rendering quirks) than the six fast, deterministic gates; keeping them separate means a
slow or flaky browser run never blocks or slows the fast feedback loop those six gates provide.

**A broken browser suite must fail cheaply.** Three settings enforce that, because a systematic
breakage fails every test identically and there is nothing to learn from watching it happen 35
times:

- `maxFailures: 3` in CI stops the run after a handful of failures.
- `retries: 0`. A retry earns its cost when failures are genuinely random; the flake sources this
  suite had were each traced to a cause and fixed, so a failure now carries information and retrying
  it only doubles the worst-case run time to hide the signal.
- `timeout-minutes: 25` on the `browser` job, so a hang is cut off rather than running to GitHub's
  six-hour default.

**The suite fails fast when it cannot observe anything.** Every read goes through
`window.__CARRY_OR_FALL_DEBUG__?.…`, and optional chaining on an absent hook yields `undefined` —
indistinguishable from "not ready yet", so a client built without the hook does not fail, it makes
every test wait out its timeout. `gotoGame` therefore asserts the hook exists before anything else
and names the likely cause (the suite pointed at a production build rather than the dev server).

**Known test-harness lesson (recorded so it is not rediscovered):** `LoadoutScene`'s digit/Enter
keys are read via Phaser's edge-triggered `JustDown`, polled once per animation frame. Playwright's
default `page.keyboard.press()` sends a near-zero-duration keydown+keyup that can land and clear
within a single frame Phaser's `update()` never observes — confirmed empirically (bare `press()`
calls failed roughly 60% of the time in a repeated trial). Every keypress in this suite instead
holds the key down for a short, real duration (`apps/client/e2e/helpers.ts`'s `pressKey`), which is
also a more faithful simulation of an actual human keypress.

**Not yet covered:** real-project anonymous authentication, the reconnect screen, the account-link
warning, and supported-browser smoke tests beyond Chromium (deferred; no cross-browser requirement
yet). Room joining is exercised throughout the suite. The credentialed Supabase contract/RLS suite
is a separate gate (§2.5), not a browser test.

### 2.3.0 Timing rule: wait for the thing, never for a duration that implies it

Everything the browser suite drives is sampled by Phaser inside a
`requestAnimationFrame` loop; everything it observes is decided by a server stepping at a fixed
50 ms. Neither clock belongs to the test runner. A helper that holds a key for 80 ms, or expects a
walk to cover 30 px per poll, is really asserting **how fast the machine is** — which holds on a
development machine and stops holding on CI, where the failure then looks like a game defect.

Three helpers state the requirement instead of betting on it, each recording the measurement that
motivated it:

- `pressKey`/`interactFor` hold until the page has actually **rendered frames**. A press that falls
  between two frames is never sampled; for `interactFor` that would be a **false pass**, since it is
  used to establish that a player pressed interact and got nothing.
- `fireAndObserve` holds the attack button until the server publishes the shot, rather than clicking
  for a fixed 80 ms and hoping a frame caught it.
- `walkToward` sizes each key hold to the distance remaining and releases it when the browser sees
  the **authoritative player cover that distance**. A host sleep is not server time: if the runner is
  descheduled, key-up arrives late and the server correctly keeps applying the previous input. The
  old fixed-150 ms walker first failed by running at a 25% duty cycle; its host-timed replacement
  could fail in the other direction by overshooting under load. Each ordinary hold now advances
  only the dominant remaining axis: WASD cannot express an arbitrary target angle, and treating
  every two-axis target as 45 degrees made the shorter axis overshoot and oscillate. The current
  release condition is game state, evaluated inside Chromium, not elapsed host time or repeated CDP
  round trips.

Multiplayer state waits follow the same rule. `pickUpAt`, extraction completion, remote movement,
remote loot removal, and remote run-over conditions are evaluated against the latest snapshot
inside Chromium. Only the final matching state crosses CDP; the old loops transferred a complete
match or private state every 100–200 ms, making the wait's own observation cost machine-dependent.

**Auditing the margins.** `E2E_MARGIN=1 pnpm test:e2e` prints one `BUDGET` line per budgeted wait,
with used-against-budget. A budget routinely more than ~75% consumed is a failure waiting for a
slower machine. Worst margins measured after the M6 audit: `walkToward` 53%, the extraction test's
idle window 56%, `dieToChasers` 69%, `waitForSnapshot` 70%, `attackChaserUntil` 95%, `pickUpAt` 99%.
Re-run this whenever the arena's danger changes — adding the M7 boss did change it.

**A wait the audit cannot see is a wait the audit cannot certify.** `reportMargin` is exported for
exactly that reason: a spec that waits inline spends a budget just as a helper does, and until M7
the audit only ever measured `helpers.ts`. The M7 boss suite added a wait *inside a spec* — and it
was the one wait in the suite whose cost is not time but the player's health (§2.3.0c). It was
therefore invisible to a table that nevertheless reported a 72% floor for the whole suite. Any new
inline wait calls `reportMargin`.

### 2.3.0b Three ways to invalidate a browser run without failing a test

All three have cost a real run, and all look exactly like a product defect —
every test failing at "the client has not joined a room" — so they are written
down rather than re-diagnosed each time.

**A stale server on port 2567 or 5173.** `playwright.config.ts` sets
`reuseExistingServer: !isCI`, which is right for local iteration and lethal
after a previous run left a server behind: the suite silently adopts a process
started with different configuration, and every join hangs. **Kill anything
listening on 2567 and 5173 before a browser run.** Checking is not enough if you
check before the wrong step — check immediately before invoking the suite.

**Editing client source while the suite runs.** The Vite dev server is watching,
so a save hot-reloads the page mid-test and the run in progress loses its room.
This is not a flake to re-run past; it is the edit. Finish editing, then run.

**Writing Playwright artifacts inside `apps/client`.** Vite watches the client
root, and Playwright writes live trace resources while a test runs. With the
default `apps/client/test-results` directory, those writes were source changes
to Vite: it repeatedly reloaded both pages, the walker overshot while input was
still held, and healthy gameplay tests failed. `playwright.config.ts` therefore
writes artifacts to the repository-root `.playwright-test-results` directory;
the architecture suite enforces that the directory remains outside Vite's root.

### 2.3.0c Budgets paid in health, not in wall clock

`walkToward`'s rule — spend server time, not machine time — assumes the only cost of a slow machine
is *waiting*. `apps/client/e2e/boss.spec.ts` is the suite's one exception, and it is worth stating
because the assumption is otherwise invisible: that spec deliberately walks a player **into** the
Warden's aggro radius and stands still there, and a stationary player inside that radius is losing
health the whole time. A poll round trip there is not merely slow; it is damage.

Measured against the real simulation (`packages/simulation-core/src/boss.test.ts`, "disengagement: a
visitor at full health can leave", which is CI's copy of these numbers):

| Fact                                                                | Measured                  |
| ------------------------------------------------------------------- | ------------------------- |
| Warden damage to a player who aggros it and retreats immediately     | **0**                     |
| Warden damage per second to a player standing at the approach point  | **~16** (100 hp in 6.3 s) |
| …standing adjacent to the boss                                       | **~22** (100 hp in 4.6 s) |
| Time before the boss is demonstrably out of its lair (>20 px)        | **~1000 ms**              |
| Health that observation costs (one `warden_nova`)                    | **26 of 100**             |
| Chasers' distance behind the player on arrival at the lair           | **~100-185 px** (~1-2 s)  |

The boss's *first* act at the approach point is a 900 ms `warden_nova` wind-up, and a telegraphing
boss does not move — so there is no route to the evidence "it left its lair" that does not cost one
nova. What there is a route to is bounding the stay: `boss.spec.ts`'s `SORTIE_BUDGET_MS` is 2000 ms,
~1.9x the ~1050 ms the evidence needs, and the worst case it can cost was measured end-to-end at
**40 of 100 health remaining**. The shape it replaced — two `expect.poll` blocks with 20-second
timeouts — bounded the stay by *how fast the machine could answer*, which on an idle machine is
~2 s (the player leaves at 74 health) and on a loaded CI runner is not (3-4 s of standing is fatal).
That is what failed, and it failed as `walkToward: the player died en route`.

**This is not a balance defect in the boss.** Disengagement is free: a player who aggros the Warden
and turns around takes **zero** damage, because `awake` is measured from the *lair* to the player
(320 px) rather than from the boss, so 80 px of retreat — under half a second — ends the engagement
permanently, against a boss whose shortest wind-up is 400 ms. The leash is doing its job; the test
was standing still in front of it.

### 2.3.1 Session durability

The browser suite runs 35 tests against **one** server process and abandons every match by
closing a browser rather than leaving politely, which makes it a small soak test whether or not it
was meant to be one. `apps/server/test/match-lifecycle.test.ts` covers that shape directly: it
creates and abandons matches in sequence and asserts rooms are disposed and step timing stays flat.

The server carries the §32.2 metrics needed to see this from the outside — active rooms, average and
maximum tick duration, event-loop lag, and heap/RSS — reported periodically as one structured log
line (`apps/server/src/metrics.ts`). Measured across a full browser session: active rooms peaked at
4 and ended at 0, average tick time went from 0.450 ms to 0.229 ms, event-loop lag from 14.7 ms to
7.2 ms, and RSS from 96 MB to 93 MB. **The server does not degrade across a session**, and that is
now a measurement anyone can repeat rather than an assumption.

### 2.4 Load tests — deferred (M8/M9)

Per technical plan §30.4: purpose-built bot clients (`packages/test-bots`, not yet created) that
join, move, attack, collect, die, extract, disconnect, and reconnect; run progressively
(1×8 → 5×8 → 10×8 → target) and measure CPU, memory, event-loop lag, outbound bandwidth,
state-patch size, room tick duration, database settlement latency, and error rate. Never accept a
generic connection-capacity claim as proof for this game.

### 2.5 Soak tests — deferred (M9)

Per technical plan §30.5: long runs to detect memory leaks, rooms that fail to dispose,
disconnected clients retained in memory, growing projectile collections, reward-retry loops, and
log-volume problems.

### 2.6 What a security test has to look like

An authority claim cannot be evidenced by a happy-path test. "The client cannot set position" is not
demonstrated by a client that never tries; it is demonstrated by a client that tries several ways and
fails every time. `apps/server/test/match-authority.test.ts` is written to that standard:

- Every test performs a cheat — a fabricated message type, or a well-formed message carrying an
  extra claim — and asserts on **authoritative server state** afterwards: the position the server has
  for that player, the enemy's health, what is on the ground, what is in the inventory, whether a run
  result exists, how many projectiles were actually created.
- No test is satisfied by "an error was logged" or "the promise rejected".
- The cheats cover each thing `docs/DEVELOPMENT_RULES.md` forbids a client from asserting: position
  reached, damage dealt, loot gained, cooldown completion, extraction success, and reward — plus
  replayed sequence numbers, malformed payloads, out-of-range slots, flooding, and one client trying
  to move, damage, or extract *another* client.

## 3. Good vs. bad tests

| Meaningful (write these)                                                        | Vacuous (do not)                          |
| ------------------------------------------------------------------------------- | ----------------------------------------- |
| `isProtocolCompatible(PROTOCOL_VERSION + 1)` is `false`                         | `expect(PROTOCOL_VERSION).toBe(1)`        |
| An incompatible join is refused with `PROTOCOL_MISMATCH_CODE`                   | `expect(PROTOCOL_MISMATCH_CODE).toBe(4001)` |
| The PRNG yields the same sequence for the same seed                             | `expect(SIMULATION_RULESET_VERSION).toBe(0)` |
| `/health` withholds the CORS header from a disallowed origin                    | asserting the health JSON has four keys and nothing else |
| A projectile skill stack cannot exceed the weapon's `maxBounces` cap (M3)       | re-stating a cap constant                 |

## 4. What each milestone must add

Each milestone's exit criteria (technical plan §38) imply its tests:

- **M1 (local combat):** unit tests for combat math — damage, cooldown gating, melee arc/hit,
  projectile caps, collision — and seeded, reproducible enemy behavior. No network required.
- **M2 (loot/extraction):** loot changes the derived build; securing an item removes its active
  effect; death and extraction convert differently; point conversion is correct.
- **M3 (skills):** supported combinations work, invalid combinations are rejected, and no
  combination breaches the shared hard caps (no recursive effect explosion).
- **M4 (multiplayer):** room integration — authoritative movement and combat, synchronized enemies,
  a client cannot set position or rewards, two clients interact correctly. Delivered as three
  layers: multi-player simulation rules as unit tests, the §30.2 room list plus an adversarial
  authority suite as integration tests, and two real browser contexts against one server
  (`apps/client/e2e/multiplayer.spec.ts`) for "two real browsers can play".
- **M5 (accounts/progression):** extracted points persist, secure-slot progress persists after
  death, and duplicate settlement does not double-award (idempotency). The third needs
  **adversarial** evidence, not a happy path: the same run settled twice, concurrent settlement of
  one run, a retry after a failure the caller cannot distinguish from success, a client replaying a
  settlement message, and a crash between the simulation ending and the write landing — plus the
  same crash on either side of a secure-slot reservation. Delivered as a **contract suite written
  once and run against two backends** (`apps/server/test/progression-contract.ts`): the in-memory
  store in CI, and real PostgreSQL under `pnpm test:supabase`. Those are different claims and are
  reported separately — see §5.
- **M6 (party/matchmaking):** a party joins one room together, and individual inventories remain
  separate. The first is a **timing** property and must not be probabilistic — the tests assert the
  mechanism (atomic group seat reservation, a held lobby) rather than a lucky run, because a wider
  window is still a race (`docs/DECISIONS.md` D55). The second is a **security** property now that
  accounts exist, and gets M4/M5's adversarial treatment: one party member attacking another's
  inventory, secure slot, loot, progression, and settlement (§2.6). Delivered as three layers:
  server integration suites for the queue and the isolation attacks, and three real browser contexts
  forming a party and landing in one room (`apps/client/e2e/party.spec.ts`).
- **M7 (boss and rare skill):** the three boss-core decisions produce three different outcomes and
  cannot be combined, and settlement stays idempotent with a boss core in it. Both need
  **adversarial** evidence, and both get M5's treatment rather than a happy path:
  `apps/server/test/boss-core-decision.test.ts` attacks the decision over a real socket — every
  slot tried after activation, activation racing a secure request inside one 50 ms step in both
  orders, a payload naming a skill instead of a slot — and
  `apps/server/test/settlement-adversarial.test.ts`'s second block re-runs M5's whole set (settled
  twice, settled concurrently, retried after an indistinguishable failure, replayed by the client,
  crashed on each side of the write) against a settlement carrying a core. The browser layer
  (`apps/client/e2e/boss.spec.ts`) covers only what a browser can add: that the boss reaches the
  client at all, and that its leash holds — which is what the rest of the browser suite's timing
  margins rest on.
- **M8–M9:** deployment smoke and load/soak/perf per the layers above. PvP damage and the concept
  §16 solo/group balance rules are M7B (D59).

### 4.1 The §13.4 hard caps, and which are reachable from live gameplay

The eight caps live in `packages/simulation-core/src/combat/caps.ts` and are enforced in shared
code. "Reachable" here means *a player can drive this cap through the real pipeline* — fire a real
weapon, with real skills, and have the clamp decide the outcome — as opposed to being provable only
by calling the clamp directly. A cap that only its own unit test can reach is a cap nobody has
checked is wired in.

Through M6, two were unreachable, and `docs/M1_ISSUES.md` said so rather than pretending otherwise.
M7's `split_return` makes both reachable, because it is the first content that creates a child
projectile at all.

| #   | Cap                                  | Reachable | Driven from live gameplay by                                              |
| --- | ------------------------------------ | --------- | ------------------------------------------------------------------------- |
| 1   | projectiles per attack               | Yes       | `multishot` + a bow volley (`combat/ranged.test.ts`, `split-caps.test.ts`) |
| 2   | bounces per projectile               | Yes       | `ricochet` off arena walls (`e2e/skills.spec.ts`)                          |
| 3   | pierces per projectile               | Yes       | `piercing_rounds` through chasers (`e2e/skills.spec.ts`)                   |
| 4   | returns per projectile               | Yes       | `returning_shot` down the open lane (`e2e/arena.spec.ts`)                  |
| 5   | a child projectile may not split     | **Yes (M7)** | `split_return`: a split child that hits a target produces no grandchild (`split-caps.test.ts`) |
| 6   | a child may not create a parent effect | **Yes (M7)** | `split_return`: a split child that expires does not return (`split-caps.test.ts`) |
| 7   | active projectiles per player        | Yes       | sustained fire with `multishot` + `split_return` (`skill-caps-under-load.test.ts`, `split-caps.test.ts`) |
| 8   | bounded target-search radius          | Yes       | homing clamps/rejects targets outside the bound (`ranged.test.ts`)         |

Caps 5 and 6 are tested the way an authority rule has to be: with a **liar**. `split-caps.test.ts`
constructs a child projectile that claims `splitCount: 3`, and another that claims
`canReturn: true`, and asserts the engine refuses both — the gate reads the child *flag*, not the
projectile's own account of what it is allowed to do. An identical non-child projectile is run
alongside as the control, so the test cannot pass because nothing happened.

## 5. Commands and CI

| Command                   | Layer                    | Runs in CI |
| ------------------------- | ------------------------ | ---------- |
| `pnpm typecheck`          | Types (not a test layer) | Yes        |
| `pnpm test`               | Unit                     | Yes        |
| `pnpm test:integration`   | Room integration + build | Yes        |
| `pnpm build`              | Production build         | Yes        |
| `pnpm test:e2e`           | Browser (Playwright)     | Yes, as a separate job (D32) |
| `pnpm test:supabase`      | Real Supabase project    | **No** — needs credentials (D46) |

### The margin audit

`E2E_MARGIN=1 pnpm test:e2e` prints a `BUDGET` line per timed wait (§2.3.0). It is the audit that
answers "did this change make the browser suite tighter" with a number, against a **40% floor**.

M7 added a boss to the shared arena, so it was re-run at the end of that milestone — and the first
run of it was wrong in a way worth recording, because the mistake is easy to repeat. It reported a
72% worst margin and justified it with "the boss cannot be the reason a later run gets tighter,
because it is leashed to a lair at least a leash radius from every route the suite walks". That
sentence is true of every spec **except the one whose subject is the boss**: `boss.spec.ts` walks
into the lair deliberately. The audit had measured the routes that avoid the boss and concluded
something about the suite. It also could not have measured the wait that mattered, because that wait
was inline in the spec and only `helpers.ts` called `reportMargin` (§2.3.0).

Both are fixed: `reportMargin` is exported, and the two budgets that were spent inside specs rather
than inside helpers — `boss.spec.ts`'s observation window and `multiplayer.spec.ts`'s extraction
idle window — now report. The by-construction claim still holds where it was actually meant, for
the routes the *rest* of the suite walks; for `boss.spec.ts` the bound is a measured health budget
instead (§2.3.0c).

**M7A-readiness re-run with every spec covered** (worst margin per label across the full 35-test run
with a repository-root `.env` present):

| Budget | Worst margin | Worst case |
| --- | ---: | ---: |
| `extractionIdleWindow` | **49%** | 10.142 s of 20 s |
| `waitForRunResult` | 62% | 5.686 s of 15 s |
| `waitForSnapshot` | 73% | 2.168 s of 8 s |
| `dieToChasers` | 75% | 14.967 s of 60 s |
| `walkToward` | 79% | 5.163 s of 25 s |
| `matchRunning` (the five-second lobby) | 81% | 5.632 s of 30 s |
| `attackChaserUntil` | 96% | 1.917 s of 45 s |
| `bossSortie` | 98% | 50 ms of 2 s |
| `activeScene:loadout` | 99% | 207 ms of 30 s |
| `partyCreated` | 99% | 166 ms of 30 s |
| `partyJoined` | 99% | 162 ms of 30 s |
| `partyMemberMarkers` | 99% | 152 ms of 30 s |
| `pickUpAt` | 99% | 237 ms of 25 s |
| `waitForMatchState:ground_loot_missing` | 99% | 94 ms of 10 s |
| `waitForMatchState:player_run_over` | 99% | 114 ms of 10 s |
| `waitForMatchState:player_x_below` | 99% | 98 ms of 10 s |
| `activeScene:play` | 100% | 164 ms of 60 s |
| `partySize` | 100% | 146 ms of 60 s |

Nothing is under the 40% floor. The extraction idle window remains the tightest product premise,
not a poll timeout; the extraction-result observation itself has 62% margin. The five-second lobby,
party formation, scene transitions, teammate-marker delivery, and every inline deadline now report.

**M7A baseline stabilization re-run.** After moving live Playwright artifacts outside Vite's
watched root and correcting non-45-degree walker steering, two consecutive full 35-test runs passed.
Their worst margins were 62% (`waitForRunResult`), 63% (`extractionIdleWindow`), 72%/74%
(`waitForSnapshot`), 78% (`dieToChasers`), and 79%/82% (`walkToward`). No gameplay timeout or arena
coordinate changed.

The remaining fixed waits are actions or sampling intervals, not silent completion claims:
`pressKey` has a minimum 50 ms hold plus two rendered frames; party-code typing uses a 40 ms human
keystroke delay; the negative multiplayer interaction holds E for 400 ms plus frames; pickup's
1.5-second attempt is inside the reported 25-second `pickUpAt` budget; combat helpers' 60–150 ms
animation/retreat samples are inside their reported outer budgets; and `bossSortie`'s 25 ms sample
interval is inside its reported two-second budget. `moveFor`, `meleeAttackFor`, and
`rangedAttackFor` retain fixed-duration implementations but have no callers, so they spend no suite
window. Per-test `test.setTimeout` values are outer hang guards; the 35 Playwright durations report
their use directly, and no test approached its guard in this run. `bossSortie` can finish in about
50 ms because `walkToArenaPoint`'s own final approach already spends about a second inside the aggro
radius, so the boss has usually left its lair before the window opens; the 2000 ms budget is sized
for the case where it has not (§2.3.0c), not for the case measured here.

`pnpm test:supabase` **pools and reuses anonymous accounts** rather than creating one per test
(`docs/DECISIONS.md` D63). Anonymous sign-in is a production rate limit and Supabase never cleans up
anonymous users, so the suite signs in a handful of times per run instead of three dozen, wipes each
borrowed account's rows between tests (which is the isolation the contract suite actually needs), and
deletes every account it created in teardown. It prints its own sign-in count so the number is
measured rather than estimated.

The required CI workflow runs all of the above on every push and pull request (technical plan §31;
`.github/workflows/ci.yml`). Browser, load, and soak layers are scheduled or on-demand jobs added
when those layers exist. CI never deploys.

### What needs a real Supabase project, and why the split is stated rather than blurred

`pnpm test:supabase` (`apps/server/test-supabase/`) is the only suite that talks to a real project.
It runs with `SUPABASE_URL` and `SUPABASE_SECRET_KEY` from the environment and **skips** when they
are absent, so a fresh clone and a CI runner pass without it (D42's rule, D46's application).

The division of evidence is exact, and any report of M5 says which claim rests on which run:

- The in-memory run proves **the server calls the persistence contract correctly** — the ordering
  around a secure reservation, the retry that reuses one key and one payload, the recovery path.
- Only the PostgreSQL run proves **the SQL implementing that contract is correct** — that
  `settle_match_reward` is genuinely atomic, that its `on conflict` guard holds under real
  concurrent transactions rather than under a single-threaded event loop, and that every
  row-level-security policy denies what it should (`docs/DATA_MODEL.md` §5.4's eight properties,
  including a user failing to update their own balance and the `is_anonymous` claim tested in both
  directions).

An in-process fake cannot demonstrate the second set. Running the same test bodies against both is
what keeps the first from being mistaken for it.
