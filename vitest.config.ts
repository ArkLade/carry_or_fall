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
    ],
  },
});
