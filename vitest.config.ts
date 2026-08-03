import { defineConfig } from "vitest/config";

/**
 * The integration files that bind a real TCP port and run a real Colyseus
 * server with real `@colyseus/sdk` clients. They are serialised into their own
 * project (`docs/DECISIONS.md` D54): run in parallel with each other and with
 * the two files that spawn full production builds, they oversubscribe the box,
 * and on Windows an oversubscribed fork intermittently dies natively rather
 * than failing a test.
 */
const realServerTests = [
  "apps/server/test/boss-core-decision.test.ts",
  "apps/server/test/foundation-room.test.ts",
  "apps/server/test/join-gate.test.ts",
  "apps/server/test/match-authority.test.ts",
  "apps/server/test/match-lifecycle.test.ts",
  "apps/server/test/match-room.test.ts",
  "apps/server/test/party-isolation.test.ts",
  "apps/server/test/party-queue.test.ts",
  "apps/server/test/party-room.test.ts",
  "apps/server/test/sdk-reconnection.test.ts",
  "apps/server/test/settlement-adversarial.test.ts",
];

// Projects keep fast, pure unit tests separate from the slower integration tests
// that boot a real Colyseus server or run production builds. The root scripts
// select them with `--project unit`, and `--project integration
// --project integration-server` for both halves of the integration gate.
export default defineConfig({
  test: {
    // `default` prints the summary; the second refuses to let a run that lost a
    // worker be read as a passing one (D54).
    reporters: ["default", "./vitest.incomplete-run.ts"],
    projects: [
      {
        test: {
          name: "unit",
          environment: "node",
          include: ["packages/*/src/**/*.test.ts"],
        },
      },
      {
        test: {
          name: "integration",
          environment: "node",
          include: ["apps/*/test/**/*.test.ts"],
          exclude: realServerTests,
          // Booting Colyseus and running real production builds is far slower
          // than a unit test; allow headroom without letting CI hang forever.
          testTimeout: 60_000,
          hookTimeout: 60_000,
        },
      },
      {
        test: {
          // The real-server half, one file at a time. See `realServerTests`.
          name: "integration-server",
          environment: "node",
          include: realServerTests,
          fileParallelism: false,
          testTimeout: 60_000,
          hookTimeout: 60_000,
        },
      },
      {
        test: {
          // The only suite that talks to a real Supabase project (M5,
          // `docs/DATA_MODEL.md` §9). Deliberately its own project rather than a
          // fourth gate: CI has no credentials and cannot reach a project
          // (`docs/DECISIONS.md` D46), so it is never part of `pnpm test` or
          // `pnpm test:integration`. Run it with `pnpm test:supabase` against a
          // project built from `supabase/migrations/`; without credentials every
          // file in it skips rather than fails.
          name: "supabase",
          environment: "node",
          include: ["apps/server/test-supabase/**/*.test.ts"],
          testTimeout: 60_000,
          hookTimeout: 60_000,
        },
      },
    ],
  },
});
