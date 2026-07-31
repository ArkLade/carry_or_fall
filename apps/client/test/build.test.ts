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
});
