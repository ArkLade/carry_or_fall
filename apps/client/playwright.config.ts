/**
 * Browser end-to-end tests (technical plan §30.3, `docs/TEST_PLAN.md` §2.3).
 * Pulled forward from its originally-deferred M5 slot to now
 * (`docs/DECISIONS.md`, new entry this change) because this milestone's
 * defects could not be diagnosed without driving a real browser. Runs
 * against a real Vite dev server (never the production build — the debug
 * hook these tests rely on, `docs/TEST_PLAN.md` §2.3, is dev-only by
 * design) with a real Chromium instance, exercising the client exactly as a
 * human would: keyboard/mouse input into the canvas, no DOM text assertions
 * (Phaser renders to `<canvas>`, not real DOM nodes), state read back
 * through `window.__CARRY_OR_FALL_DEBUG__`.
 */
import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  // Every test starts a fresh page against a shared dev server; running two
  // Phaser game instances in parallel windows is unnecessary contention for
  // this small suite, so tests run serially within a single worker.
  workers: 1,
  fullyParallel: false,
  retries: process.env.CI ? 1 : 0,
  // CI writes an HTML report so a failure's trace/screenshot can be uploaded
  // as a workflow artifact (.github/workflows/ci.yml's `browser` job); local
  // runs stay terse.
  reporter: process.env.CI ? "html" : "list",
  use: {
    baseURL: "http://localhost:5173",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  // Both halves now, because from M4 the client cannot play without the
  // authoritative server: the game server first (the client's join would fail
  // without it), then the Vite dev server.
  webServer: [
    {
      command: "pnpm --filter @carry-or-fall/server run dev",
      // The server's HTTP health endpoint, which is exactly the "is it up"
      // signal it exists to provide (technical plan §38 M0).
      url: "http://localhost:2567/health",
      cwd: "../..",
      // A fixed match seed, so every spec sees the same enemy, loot, chip, and
      // extraction placement (technical plan §9.4 asks for reproducible seeded
      // tests for exactly this reason). Without it, a test that walks to "the
      // first extraction point" sometimes draws one across the map behind three
      // chasers and fails for a reason unrelated to what it is testing.
      //
      // 76 specifically: both active extraction points open on the players' side
      // of the divider, and all three chasers spawn in the far or lower half, so
      // a test walking to the near loot is not racing a chaser down the same
      // lane. The chasers are still fully present — they cross the map and kill
      // a player who stands still, which the death tests depend on — they are
      // just not sitting on top of the thing every other test has to reach.
      env: { MATCH_SEED: "76" },
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
    },
    {
      command: "pnpm run dev",
      url: "http://localhost:5173",
      reuseExistingServer: !process.env.CI,
      timeout: 30_000,
    },
  ],
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
