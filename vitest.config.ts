import { defineConfig } from "vitest/config";

// Two projects keep fast, pure unit tests separate from the slower integration
// tests that boot a real Colyseus server or run production builds. The root
// scripts select them with `--project unit` / `--project integration`.
export default defineConfig({
  test: {
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
          // Booting Colyseus and running real production builds is far slower
          // than a unit test; allow headroom without letting CI hang forever.
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
