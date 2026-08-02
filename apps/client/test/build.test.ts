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

  it("ships no server-only secret in the production bundle (M5)", async () => {
    // `docs/DECISIONS.md` D32 records that this exact class of leak already
    // happened here: the shared root `.env`'s NODE_ENV reached Vite's client
    // build through `envDir` and shipped a dev-only debug hook into every
    // production bundle for three milestones, undetected, until a capability was
    // built specifically to look for it. The same path now carries a key that
    // bypasses row-level security, in a public repository (D25).
    //
    // Note that this build runs against the developer's real `.env` when one is
    // present, so it is the actual configured values being checked, not a
    // fixture.
    await build({ root: clientDir, logLevel: "warn" });
    const bundled = await readBuiltJs();

    // 1. The variable name itself, which is what a leak through
    //    `import.meta.env` or `process.env` would embed.
    expect(bundled).not.toContain("SUPABASE_SECRET_KEY");

    // 2. A secret key *value*, which catches a leak even if it arrived under
    //    some other name — a rename cannot smuggle it past this.
    //
    //    Matched as the prefix plus at least eight key characters, not as the
    //    bare prefix: `@supabase/supabase-js` itself contains the literal
    //    `sb_secret_` in its own key-format check
    //    (`e.startsWith("sb_publishable_") || e.startsWith("sb_secret_")`), and
    //    that library string is legitimately bundled. Asserting on the bare
    //    prefix therefore fails on a correct bundle — verified: it did, on the
    //    first run of this test — which would have meant either deleting the
    //    assertion or learning to ignore it. A real key is the prefix followed
    //    by a long random tail, so this is the shape that distinguishes them.
    expect(bundled).not.toMatch(/sb_secret_[A-Za-z0-9_-]{8,}/);

    // 3. A literal `service_role`. This project does not use the legacy
    //    Supabase JWT keys (technical plan §20.2 names the publishable/secret
    //    pair), so any mention is either a hard-coded reference or a regression
    //    to a key format nothing here should produce. Stated honestly: this
    //    catches a literal, not a legacy JWT, whose role claim is inside a
    //    base64 payload — assertion 2 is the one that catches a current-format
    //    key.
    expect(bundled).not.toContain("service_role");
  }, 120_000);

  it("ships no server-only environment variable in the production bundle (M5)", async () => {
    await build({ root: clientDir, logLevel: "warn" });
    const bundled = await readBuiltJs();

    // Every variable `.env.example` documents as server-side. `PORT`,
    // `NODE_ENV`, and `LOG_LEVEL` are deliberately absent from this list: they
    // are substrings of ordinary words ("SUPPORT", "EXPORT") or are written into
    // bundles by tooling, so asserting on them would produce a test that fails
    // for reasons unrelated to a leak. The ones listed are distinctive enough
    // that any occurrence is a real one.
    for (const serverOnly of [
      "SUPABASE_SECRET_KEY",
      "ALLOWED_ORIGINS",
      "GAME_BUILD_VERSION",
      "MATCH_SEED",
      "MATCH_LOBBY_MS",
    ]) {
      expect(bundled, `${serverOnly} reached the client bundle`).not.toContain(serverOnly);
    }

    // `SUPABASE_URL` needs care: `VITE_SUPABASE_URL` legitimately contains it as
    // a substring, and its *value* is legitimately bundled. What must not appear
    // is a bare, non-`VITE_`-prefixed reference — that would be the server's
    // variable being read from client code.
    expect(bundled).not.toMatch(/(?<!VITE_)SUPABASE_URL/);
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
