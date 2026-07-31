import { fileURLToPath, URL } from "node:url";

import { defineConfig } from "vite";

// Anchor Vite to this package directory so both the `vite` CLI and the
// programmatic `build()` call in the integration test resolve index.html
// regardless of the working directory they are invoked from.
const root = fileURLToPath(new URL(".", import.meta.url));

// Load `.env` from the monorepo root (not this package). The repo keeps a
// single root `.env` — documented by `.env.example` — that carries both the
// client `VITE_*` vars and the server vars, so point Vite there explicitly.
const envDir = fileURLToPath(new URL("../../", import.meta.url));

export default defineConfig(({ command }) => ({
  root,
  envDir,
  server: {
    port: 5173,
    strictPort: true,
  },
  build: {
    target: "es2023",
    outDir: "dist",
    emptyOutDir: true,
    sourcemap: true,
  },
  // The shared root `.env` sets `NODE_ENV=development` for the server
  // (`docs/DECISIONS.md` D20). Loading that same file via `envDir` above
  // also feeds Vite's own production/development detection, which would
  // otherwise make `import.meta.env.DEV` true even in a `vite build` output
  // (verified: without this, dev-only code stayed in the production
  // bundle). `command` is reliably "serve" for `vite`/`vite dev` and
  // "build" for `vite build`/the programmatic `build()` API regardless of
  // NODE_ENV, so defining the two constants from it instead of trusting
  // Vite's NODE_ENV-influenced default keeps dev-only code (e.g. the debug
  // hook, `docs/TEST_PLAN.md` §2.3) verifiably out of production.
  define: {
    "import.meta.env.DEV": JSON.stringify(command === "serve"),
    "import.meta.env.PROD": JSON.stringify(command !== "serve"),
  },
}));
