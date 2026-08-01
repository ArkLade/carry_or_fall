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
