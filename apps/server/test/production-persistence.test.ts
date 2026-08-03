/**
 * A production server must not run on non-persistent progression (M6.8,
 * `docs/M6_ISSUES.md` §9, §11.6; `docs/DECISIONS.md` D61).
 *
 * `assertPersistenceConfigured` already guarded the **process** (D46), and
 * `env.test.ts` covers it. What was missing is a guard at the seam where the
 * consequences are actually chosen: `createGameServer` reads "is this store
 * Supabase-backed" and, from that single fact, decides to mint a fresh local
 * identity per join (D45) and to provision every unlock (D49). Both are right
 * for development and wrong for a deployment — and an invariant enforced only
 * in `index.ts` is one that any second entry point walks straight past.
 *
 * So these tests assert the **two named behaviors** rather than the guard's
 * existence: no `LocalTokenVerifier`, and no all-unlock provisioning, can be
 * selected under `NODE_ENV=production`.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { assertPersistenceSelected } from "../src/config/env";
import type { Logger } from "../src/logger";
import { MemoryStore } from "../src/progression/memory-store";
import { createGameServer } from "../src/server";

const silentLogger: Logger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
};

function build(): ReturnType<typeof createGameServer> {
  return createGameServer({
    buildVersion: "0.0.0-test",
    logger: silentLogger,
    allowedOrigins: ["http://localhost:5173"],
    progression: { store: new MemoryStore() },
  });
}

describe("createGameServer refuses a production build without persistence", () => {
  let previous: string | undefined;

  beforeEach(() => {
    previous = process.env["NODE_ENV"];
  });

  afterEach(() => {
    if (previous === undefined) {
      delete process.env["NODE_ENV"];
    } else {
      process.env["NODE_ENV"] = previous;
    }
  });

  it("throws when NODE_ENV=production and the store is the in-memory one", () => {
    process.env["NODE_ENV"] = "production";
    expect(() => build()).toThrow(/Refusing to build a production game server/);
  });

  it("names the consequence, not just the rule", () => {
    // An operator reading this in a crash log should learn what would have been
    // lost, not merely that a check failed.
    process.env["NODE_ENV"] = "production";
    expect(() => build()).toThrow(/discarded when the process exits/);
  });

  it("builds normally in development and test, which is what CI and a fresh clone run", () => {
    for (const nodeEnv of ["development", "test"]) {
      process.env["NODE_ENV"] = nodeEnv;
      const handle = build();
      expect(handle.gameServer).toBeDefined();
    }
  });

  it("builds normally when NODE_ENV is unset", () => {
    delete process.env["NODE_ENV"];
    expect(() => build()).not.toThrow();
  });
});

describe("assertPersistenceSelected", () => {
  it("refuses exactly the one combination that loses a deployment's progression", () => {
    expect(() => assertPersistenceSelected("production", false)).toThrow();

    // Everything else is a legitimate configuration, including the one that
    // matters most: a production server that *is* persistent.
    expect(() => assertPersistenceSelected("production", true)).not.toThrow();
    expect(() => assertPersistenceSelected("development", false)).not.toThrow();
    expect(() => assertPersistenceSelected("test", false)).not.toThrow();
    expect(() => assertPersistenceSelected(undefined, false)).not.toThrow();
  });

  it("is not fooled by a value that merely looks like production", () => {
    // `loadServerEnv` rejects anything but the three known values, but this
    // function takes the raw string, so it says explicitly what it treats as
    // production: the exact word, and nothing else.
    for (const nodeEnv of ["Production", "PRODUCTION", "production ", "prod", "staging"]) {
      expect(() => assertPersistenceSelected(nodeEnv, false)).not.toThrow();
    }
  });
});
