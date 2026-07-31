# Test Plan

Status: **M0 baseline.** The testing strategy for the project: the layers, what each covers, what
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

**Exists today (3 files, 19 tests):**

- `packages/protocol/src/validation.test.ts` — `validateClientHandshake` and
  `validateHealthResponse` accept well-formed input, strip unknown fields, and reject malformed
  shapes/types/ranges.
- `packages/protocol/src/version.test.ts` — `isProtocolCompatible` accepts an equal peer and
  rejects a differing one; `isBuildVersion` accepts semver-like strings and rejects malformed ones.
- `packages/simulation-core/src/prng.test.ts` — the seeded PRNG is reproducible for a seed,
  differs across seeds, stays within `[0, 1)` / `[0, maxExclusive)`, and rejects a non-positive or
  non-integer bound.

`game-content` has no tests yet because it ships only type placeholders; content tests arrive with
the first real definitions (see `docs/CONTENT_AUTHORING.md`).

### 2.2 Room integration tests (Vitest) — `pnpm test:integration`

Exercise the authoritative Colyseus server end to end against a real listening server. Glob:
`apps/*/test/**/*.test.ts` (the Vitest `integration` project). Scope per technical plan §30.2:
create a room, join simulated clients, send messages, verify synchronized state, test disconnects,
room disposal, extraction, and death/dropped loot.

**Exists today (3 files, 9 tests):**

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
(`loadout.spec.ts`, `skills.spec.ts`), run via `pnpm run test:e2e` (or, at the client package,
`pnpm run test:e2e`). Tests drive a real Chromium instance against the real Vite **dev** server
(never the production build) with real keyboard/mouse events into the `<canvas>` — Phaser renders to
canvas, not DOM nodes, so no test asserts on DOM text. State is read back through a dev-only debug
hook (`apps/client/src/debug/debug-hook.ts`), installed on `window.__CARRY_OR_FALL_DEBUG__` only
when `import.meta.env.DEV` is true:

```ts
export interface CarryOrFallDebugHook {
  readonly getWorld: () => World | null; // the current simulation World, or null before a run starts
  readonly getActiveSceneKey: () => string | null; // "loadout" | "play" | "boot" | null
}
```

The hook is **observation only** — every method returns state the client already computed; nothing
on it can change game state, issue input, or run a game rule (technical plan §5.1's "client sends
intent, renders state" is unaffected by a read-only observer). It is verified absent from the
production bundle by `apps/client/test/build.test.ts` (an assertion the built JS output does not
contain the hook's `window` key), which runs under the existing `pnpm test:integration` gate — not
part of the Playwright suite itself.

**CI wiring:** the Playwright suite runs as a **separate CI job** (`.github/workflows/ci.yml`'s
`browser` job), not a seventh step in the existing `verify` job. Reason: browser tests are
categorically slower (a real Chromium instance, real animation-frame timing, `walkToward`-style
navigation against a live, moving enemy) and have different failure modes (timing sensitivity,
headless-rendering quirks) than the six fast, deterministic gates; keeping them separate means a
slow or flaky browser run never blocks or slows the fast feedback loop those six gates provide,
matching this task's explicit "do not slow or destabilize the existing six gates."

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
  a client cannot set position or rewards, two clients interact correctly.
- **M5 (accounts/progression):** extracted points persist, secure-slot progress persists after
  death, and duplicate settlement does not double-award (idempotency).
- **M6–M9:** party/matchmaking, boss-core decisions, deployment smoke, and load/soak/perf per the
  layers above.

## 5. Commands and CI

| Command                   | Layer                    | Runs in CI |
| ------------------------- | ------------------------ | ---------- |
| `pnpm typecheck`          | Types (not a test layer) | Yes        |
| `pnpm test`               | Unit                     | Yes        |
| `pnpm test:integration`   | Room integration + build | Yes        |
| `pnpm build`              | Production build         | Yes        |

The required CI workflow runs all of the above on every push and pull request (technical plan §31;
`.github/workflows/ci.yml`). Browser, load, and soak layers are scheduled or on-demand jobs added
when those layers exist. CI never deploys.
