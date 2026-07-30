import { execFile } from "node:child_process";
import { access } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);
const serverDir = path.resolve(fileURLToPath(new URL("..", import.meta.url)));

describe("server production build", () => {
  it("bundles a runnable server entry point", async () => {
    // Runs the real esbuild config the same way `pnpm build` does.
    await execFileAsync(process.execPath, ["esbuild.config.mjs"], { cwd: serverDir });
    await expect(access(path.join(serverDir, "dist", "index.js"))).resolves.toBeUndefined();
  }, 60_000);
});
