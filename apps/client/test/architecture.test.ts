/**
 * The M4 architectural invariant, enforced rather than documented: **the client
 * does not run a simulation.**
 *
 * `docs/M4_EXECUTION_PLAN.md` §5.1 states there is exactly one simulation in the
 * system and it runs on the server. That is easy to state and easy to erode —
 * a "just for smoothing" local step, a "predicted" world, a re-implemented rule
 * — and every one of those would be a second simulation drifting away from the
 * authoritative one. This test makes that erosion fail the build.
 *
 * It deliberately does not forbid importing `@carry-or-fall/simulation-core`
 * altogether: the client legitimately shares *definitions* with the server
 * (technical plan §7.1) — constants like the extraction channel duration, and
 * pure helpers like point conversion for the HUD's preview. What it forbids is
 * the two entry points that advance or create a world.
 */
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const clientSrc = path.resolve(fileURLToPath(new URL("../src", import.meta.url)));

/** Every `.ts` file under `apps/client/src`. */
async function sourceFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await sourceFiles(full)));
    } else if (entry.name.endsWith(".ts")) {
      files.push(full);
    }
  }
  return files;
}

/** Strip block and line comments, so the module docs describing the old design do not count as usage. */
function withoutComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

describe("the client runs no simulation (docs/M4_EXECUTION_PLAN.md §5.1)", () => {
  it.each(["stepSimulation", "createSimulation"])(
    "no client source file calls %s",
    async (forbidden) => {
      const files = await sourceFiles(clientSrc);
      expect(files.length).toBeGreaterThan(0);

      const offenders = files.filter((file) => file.includes(forbidden));
      expect(offenders).toEqual([]);

      const usages: string[] = [];
      for (const file of files) {
        const source = withoutComments(await readFile(file, "utf8"));
        if (source.includes(forbidden)) {
          usages.push(path.relative(clientSrc, file));
        }
      }
      expect(usages).toEqual([]);
    },
  );

  it("still lets the client share definitions with the server", async () => {
    // The rule above is about authority, not about the package: forbidding the
    // shared package outright would push the client into re-declaring
    // constants, which is the drift the shared package exists to prevent.
    const files = await sourceFiles(clientSrc);
    const importers = files.filter((file) => file.includes("hud") || file.includes("render"));
    const sources = await Promise.all(importers.map((file) => readFile(file, "utf8")));
    expect(sources.some((source) => source.includes("@carry-or-fall/simulation-core"))).toBe(true);
  });
});

/**
 * The M5 invariant, enforced the same way: **no secret is reachable from client
 * source.**
 *
 * `build.test.ts` checks the built bundle, which is the outcome that matters.
 * This checks the *source*, which is where a leak is introduced — so a mistake
 * fails in a second rather than after a two-minute Vite build, and names the
 * file.
 */
describe("no server-only configuration is reachable from client source (M5)", () => {
  /**
   * The only variables client code may read. Anything else — including
   * `SUPABASE_SECRET_KEY` — is server configuration, and reading it here would
   * put it in a browser bundle.
   */
  const ALLOWED_ENV_KEYS = [
    "VITE_GAME_SERVER_URL",
    "VITE_BUILD_VERSION",
    "VITE_SUPABASE_URL",
    "VITE_SUPABASE_PUBLISHABLE_KEY",
    "DEV",
    "PROD",
    "MODE",
    "BASE_URL",
    "SSR",
  ];

  it("reads only allowlisted import.meta.env keys", async () => {
    const files = await sourceFiles(clientSrc);
    const violations: string[] = [];

    for (const file of files) {
      const source = withoutComments(await readFile(file, "utf8"));
      for (const match of source.matchAll(/import\.meta\.env\.([A-Za-z_$][\w$]*)/g)) {
        const key = match[1] ?? "";
        if (!ALLOWED_ENV_KEYS.includes(key)) {
          violations.push(`${path.relative(clientSrc, file)}: import.meta.env.${key}`);
        }
      }
    }

    expect(violations).toEqual([]);
  });

  it("names no server-only variable and no secret-key prefix", async () => {
    // A leak does not have to go through `import.meta.env`: a hard-coded key, or
    // a `process.env` read that some bundler inlines, would be just as fatal.
    // The bare `sb_secret_` prefix *is* forbidden here, unlike in
    // `build.test.ts`: this scans first-party source only, where the library
    // literal that forced the looser match there cannot appear.
    const forbidden = [
      "SUPABASE_SECRET_KEY",
      "sb_secret_",
      "service_role",
      "ALLOWED_ORIGINS",
      "MATCH_SEED",
      "MATCH_LOBBY_MS",
    ];
    const files = await sourceFiles(clientSrc);
    const violations: string[] = [];

    for (const file of files) {
      const source = withoutComments(await readFile(file, "utf8"));
      for (const token of forbidden) {
        if (source.includes(token)) {
          violations.push(`${path.relative(clientSrc, file)}: ${token}`);
        }
      }
      // A bare `SUPABASE_URL` (the server's variable) as opposed to the
      // `VITE_`-prefixed one the browser is allowed.
      if (/(?<!VITE_)SUPABASE_URL/.test(source)) {
        violations.push(`${path.relative(clientSrc, file)}: SUPABASE_URL (server-only)`);
      }
    }

    expect(violations).toEqual([]);
  });

  it("imports nothing from the server's progression modules", async () => {
    // The secret-key client lives in `apps/server/src/progression`. Importing any
    // of it from the browser would drag `SupabaseStore` — and the shape of the
    // trusted write path — into the bundle.
    const files = await sourceFiles(clientSrc);
    const violations: string[] = [];

    for (const file of files) {
      const source = withoutComments(await readFile(file, "utf8"));
      if (source.includes("apps/server") || /from\s+["'].*\/progression\//.test(source)) {
        violations.push(path.relative(clientSrc, file));
      }
    }

    expect(violations).toEqual([]);
  });
});
