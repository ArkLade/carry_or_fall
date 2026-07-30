/**
 * Production build for the server. esbuild bundles our source together with the
 * source-only workspace package `@carry-or-fall/protocol` (which ships no build
 * output) into a single runnable file, while leaving runtime npm dependencies
 * external so they resolve from node_modules at run time. This keeps the output
 * minimal without vendoring Colyseus or Express into the bundle.
 */
import { build } from "esbuild";

// Runtime dependencies that must NOT be bundled. Everything else reachable from
// the entry point (our code + the protocol package source) is bundled in.
const external = ["@colyseus/core", "@colyseus/ws-transport", "@colyseus/schema", "express"];

try {
  await build({
    entryPoints: ["src/index.ts"],
    outfile: "dist/index.js",
    bundle: true,
    platform: "node",
    target: "node24",
    format: "esm",
    sourcemap: true,
    external,
    logLevel: "info",
  });
  console.log("server build complete → apps/server/dist/index.js");
} catch (error) {
  console.error(error);
  process.exit(1);
}
