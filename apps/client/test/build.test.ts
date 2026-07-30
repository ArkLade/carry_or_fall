import { access } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { build } from "vite";
import { describe, expect, it } from "vitest";

const clientDir = path.resolve(fileURLToPath(new URL("..", import.meta.url)));

describe("client production build", () => {
  it("produces a bundled index.html", async () => {
    // Drives the real Vite production build (Phaser bundling included).
    await build({ root: clientDir, logLevel: "warn" });
    await expect(access(path.join(clientDir, "dist", "index.html"))).resolves.toBeUndefined();
  }, 120_000);
});
