# Test Plan

Status: **M4 (authoritative multiplayer).** The testing strategy for the project: the layers, what each covers, what
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

**Exists today (28 files, 341 tests)**, covering the simulation rules M1–M3 established, the content
definitions, and — added in M4 — the wire validators and the multi-player rules. The ones worth
naming here because they guard an M4 invariant:

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
`--project integration --project integration-server`. The six files that bind a real TCP port and
run a real Colyseus server are the `integration-server` project and run **one file at a time**
(`fileParallelism: false`); everything else stays parallel. Run together on a loaded machine they
oversubscribe it, and on Windows an oversubscribed fork intermittently dies natively — the worker
exits with `0xC0000409` and no JavaScript error, so its whole file silently vanishes from the
counts. Serialising them is the mitigation; the `vitest.incomplete-run.ts` reporter is the
guarantee, because it fails loudly whenever any file did not report.

**Exists today (6 files, 71 tests):**

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

**What exists today:** `apps/client/playwright.config.ts` and `apps/client/e2e/*.spec.ts`
(`loadout.spec.ts`, `skills.spec.ts`, `arena.spec.ts`, and — new in M4 —
`multiplayer.spec.ts`), run via `pnpm run test:e2e`. Tests drive a real Chromium instance against
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
breakage fails every test identically and there is nothing to learn from watching it happen thirty
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

**Not yet covered:** anonymous sign-in, joining a room, the reconnect screen, the account-link
warning (all require M4+ networking/M5 accounts, which do not exist yet); supported-browser smoke
tests beyond Chromium (deferred; no cross-browser requirement yet).

### 2.3.1 Session durability

The browser suite runs thirty tests against **one** server process and abandons every match by
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
- **M6–M9:** party/matchmaking, boss-core decisions, deployment smoke, and load/soak/perf per the
  layers above.

## 5. Commands and CI

| Command                   | Layer                    | Runs in CI |
| ------------------------- | ------------------------ | ---------- |
| `pnpm typecheck`          | Types (not a test layer) | Yes        |
| `pnpm test`               | Unit                     | Yes        |
| `pnpm test:integration`   | Room integration + build | Yes        |
| `pnpm build`              | Production build         | Yes        |
| `pnpm test:e2e`           | Browser (Playwright)     | Yes, as a separate job (D32) |
| `pnpm test:supabase`      | Real Supabase project    | **No** — needs credentials (D46) |

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
