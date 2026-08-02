/**
 * Browser end-to-end tests (technical plan §30.3, `docs/TEST_PLAN.md` §2.3).
 * Runs against a real Vite dev server (never the production build — the debug
 * hook these tests rely on is dev-only by design) and the real authoritative
 * game server, with a real Chromium instance, exercising the client exactly as
 * a human would: keyboard/mouse input into the canvas, no DOM text assertions
 * (Phaser renders to `<canvas>`, not real DOM nodes), state read back through
 * `window.__CARRY_OR_FALL_DEBUG__`.
 *
 * **This file is the suite's entire configuration.** It deliberately supplies
 * every variable both servers need, rather than inheriting them from the
 * repository-root `.env`. That `.env` is gitignored (`docs/DEVELOPMENT_RULES.md`:
 * only `.env.example` is tracked), so it cannot exist on a fresh clone or on a
 * CI runner — and a suite that depends on a file which by policy can never be
 * committed is a suite that only ever passes on the machine that wrote it.
 */
import { defineConfig, devices } from "@playwright/test";

const isCI = process.env.CI !== undefined && process.env.CI !== "";

/** The ports both servers are pinned to; the client's URL below must agree with them. */
const CLIENT_ORIGIN = "http://localhost:5173";
const SERVER_PORT = "2567";

/**
 * Everything the **game server** needs. Only `PORT` and `ALLOWED_ORIGINS` are
 * required for it to serve this suite at all; the rest is what makes the suite
 * fast and reproducible.
 */
const gameServerEnv = {
  PORT: SERVER_PORT,
  ALLOWED_ORIGINS: CLIENT_ORIGIN,
  GAME_BUILD_VERSION: "0.0.0-e2e",
  LOG_LEVEL: "warn",

  // A fixed match seed, so every spec sees the same enemy, loot, chip, and
  // extraction placement (technical plan §9.4 asks for reproducible seeded tests
  // for exactly this reason). Without it, a test that walks to "the first
  // extraction point" sometimes draws one across the map behind three chasers
  // and fails for a reason unrelated to what it is testing.
  //
  // 76 specifically: both active extraction points open on the players' side of
  // the divider, and all three chasers spawn in the far or lower half, so a test
  // walking to the near loot is not racing a chaser down the same lane. The
  // chasers are still fully present — they cross the map and kill a player who
  // stands still, which the death tests depend on — they are just not sitting on
  // top of the thing every other test has to reach.
  MATCH_SEED: "76",

  // Five seconds, down from the gameplay default of eight but **not** as low as
  // it could be, and the difference matters.
  //
  // The countdown starts when the first client joins and the room locks when it
  // expires (technical plan §8.3), so it is also the entire window in which a
  // *second* browser can reach the same match. Measured on an unloaded machine,
  // that second join takes 620-930 ms: page focus, an edge-triggered Enter read
  // on an animation frame, the Phaser scene transition, and the join handshake.
  // An earlier attempt at a one-second lobby left 70-380 ms of margin, which held
  // when a two-client spec ran alone and did not when it ran inside the full
  // suite — the two clients then landed in *different* matches, and every
  // assertion about the other player waited out its timeout. Verified directly:
  // at 300 ms the clients split every single time.
  //
  // Five seconds is roughly five times the measured join, so the margin survives
  // a loaded or slower machine. `joinSameMatch` additionally asserts the two
  // clients really did land together, so if this is ever too tight again the
  // failure says so immediately instead of looking like a slow test.
  MATCH_LOBBY_MS: "5000",

  // **No Supabase, deliberately** (M5). Blanked rather than merely unset,
  // because the server's `dev` script loads the repository-root `.env` through
  // `--env-file-if-exists` (`docs/DECISIONS.md` D20) and Node does not override
  // an already-set variable — so leaving these out means a developer *with*
  // credentials runs a different suite than CI does, which is the exact
  // divergence D42 exists to prevent. Found the hard way: the first M5 run of
  // this suite failed on the developer's machine and would have passed on CI.
  //
  // The consequences are all wanted. The suite runs on the in-memory
  // progression store, so it tests the game rather than a network round trip to
  // a hosted database; it cannot spend the anonymous sign-in rate limit (30 per
  // hour per IP, `docs/DECISIONS.md` D50) on thirty test runs; and it leaves no
  // junk anonymous users in a real project. The real schema's evidence is
  // `pnpm test:supabase`, which is the suite that *should* need credentials.
  SUPABASE_URL: "",
  SUPABASE_SECRET_KEY: "",
} as const;

/**
 * Everything the **client** needs. Vite reads `VITE_*` from the environment as
 * well as from `.env`, and environment values win — so these apply whether or
 * not a developer has a local `.env`, which keeps a local run and a CI run
 * testing the same configuration.
 */
const clientEnv = {
  VITE_GAME_SERVER_URL: `ws://localhost:${SERVER_PORT}`,
  VITE_BUILD_VERSION: "0.0.0-e2e",

  // Blanked for the same reason as the server's pair above, and one more: a
  // browser that found real credentials here would sign in anonymously against
  // the live project on every one of the thirty specs, creating thirty
  // unrecoverable users a run and burning the §17.4 sign-in rate limit. The
  // client treats absent configuration as "this build has no accounts" and stays
  // fully playable, which is what these tests exercise.
  VITE_SUPABASE_URL: "",
  VITE_SUPABASE_PUBLISHABLE_KEY: "",
} as const;

export default defineConfig({
  testDir: "./e2e",
  // Every test starts a fresh page against a shared dev server; running two
  // Phaser game instances in parallel windows is unnecessary contention for
  // this small suite, so tests run serially within a single worker.
  workers: 1,
  fullyParallel: false,

  // No retries, on purpose. A retry is worth its cost when failures are genuinely
  // random; here the known flake sources were each traced to a cause and fixed
  // (background-tab animation-frame throttling, over-fetching state per poll, a
  // pickup that could overshoot its range, a walker that read "slow" as
  // "blocked"). With those gone, a failure is information, and retrying it
  // doubles the worst-case run time to hide the very signal worth having.
  retries: 0,

  // Stop after a handful of failures. A systematic breakage — a server that did
  // not start, a missing debug hook — fails every test identically, and there is
  // nothing to learn from watching it happen thirty times. This is what keeps a
  // broken suite from burning half an hour of CI to say one thing.
  maxFailures: isCI ? 3 : 0,

  // Well above the slowest test's honest duration (the death tests need a chaser
  // to cross the map and grind a player down), and low enough that a hang is
  // reported rather than waited out.
  timeout: 120_000,
  expect: { timeout: 10_000 },

  // CI writes an HTML report so a failure's trace/screenshot can be uploaded as
  // a workflow artifact (`.github/workflows/ci.yml`'s `browser` job); local runs
  // stay terse.
  reporter: isCI ? "html" : "list",
  use: {
    baseURL: CLIENT_ORIGIN,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },

  // Both halves, because from M4 the client cannot play without the
  // authoritative server: the game server first (the client's join would fail
  // without it), then the Vite dev server.
  webServer: [
    {
      command: "pnpm --filter @carry-or-fall/server run dev",
      // The server's HTTP health endpoint, which is exactly the "is it up"
      // signal it exists to provide (technical plan §38 M0).
      url: `http://localhost:${SERVER_PORT}/health`,
      cwd: "../..",
      env: gameServerEnv,
      reuseExistingServer: !isCI,
      timeout: 60_000,
    },
    {
      command: "pnpm run dev",
      url: CLIENT_ORIGIN,
      env: clientEnv,
      reuseExistingServer: !isCI,
      // A cold CI runner compiles Phaser on first request, which is slower than
      // any warm local start.
      timeout: 60_000,
    },
  ],
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
