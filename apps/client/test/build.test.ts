import { access, readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { build } from "vite";
import { describe, expect, it } from "vitest";

import { DEBUG_HOOK_KEY } from "../src/debug/debug-hook";

const clientDir = path.resolve(fileURLToPath(new URL("..", import.meta.url)));

async function readBuiltJs(): Promise<string> {
  const assetsDir = path.join(clientDir, "dist", "assets");
  const files = await readdir(assetsDir);
  const jsFiles = files.filter((file) => file.endsWith(".js"));
  const contents = await Promise.all(
    jsFiles.map((file) => readFile(path.join(assetsDir, file), "utf8")),
  );
  return contents.join("\n");
}

describe("client production build", () => {
  it("produces a bundled index.html", async () => {
    // Drives the real Vite production build (Phaser bundling included).
    await build({ root: clientDir, logLevel: "warn" });
    await expect(access(path.join(clientDir, "dist", "index.html"))).resolves.toBeUndefined();
  }, 120_000);

  it("strips the dev-only debug hook from the production bundle (docs/TEST_PLAN.md §2.3)", async () => {
    await build({ root: clientDir, logLevel: "warn" });
    const bundled = await readBuiltJs();
    expect(bundled).not.toContain(DEBUG_HOOK_KEY);
  }, 120_000);

  it("ships no test-only configuration in the production bundle", async () => {
    // The browser suite shortens the lobby countdown and pins the match seed so
    // it does not spend real seconds waiting for a human-timescale timer. Both
    // are *server* configuration, read from the process environment exactly like
    // `PORT` — the point of this assertion is that they stayed there. A knob
    // that let a browser shorten its own countdown or choose its own seed would
    // be a client asserting a match rule, which is precisely what the authority
    // model forbids (technical plan §5.1).
    await build({ root: clientDir, logLevel: "warn" });
    const bundled = await readBuiltJs();
    for (const testOnlyKnob of ["MATCH_LOBBY_MS", "MATCH_SEED"]) {
      expect(bundled).not.toContain(testOnlyKnob);
    }
  }, 120_000);
});
