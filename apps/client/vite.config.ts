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

export default defineConfig({
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
});
