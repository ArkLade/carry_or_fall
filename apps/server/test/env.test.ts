/**
 * The server reads its configuration from the process environment — an
 * untrusted boundary — so every value is validated before use and a
 * misconfigured server fails to start rather than starting half-working.
 */
import { describe, expect, it } from "vitest";

import { assertPersistenceConfigured, hasSupabaseConfig, loadServerEnv } from "../src/config/env";

describe("loadServerEnv: MATCH_SEED", () => {
  it("defaults to no pinned seed, so each match draws a fresh random one", () => {
    // Technical plan §9.4: "give each match a random seed". Pinning is the
    // exception, for reproducible local runs and browser tests.
    expect(loadServerEnv({}).matchSeed).toBeNull();
  });

  it("accepts an in-range integer seed", () => {
    expect(loadServerEnv({ MATCH_SEED: "49" }).matchSeed).toBe(49);
    expect(loadServerEnv({ MATCH_SEED: "0" }).matchSeed).toBe(0);
    expect(loadServerEnv({ MATCH_SEED: "4294967295" }).matchSeed).toBe(4_294_967_295);
  });

  it("treats an empty value as unset rather than as zero", () => {
    // An exported-but-empty variable is a common shell accident; reading it as
    // seed 0 would silently pin every match to one layout.
    expect(loadServerEnv({ MATCH_SEED: "" }).matchSeed).toBeNull();
  });

  it("refuses a malformed or out-of-range seed instead of coercing it", () => {
    for (const seed of ["-1", "1.5", "abc", "4294967296", "NaN"]) {
      expect(() => loadServerEnv({ MATCH_SEED: seed })).toThrow(/MATCH_SEED/);
    }
  });

  it("reports every configuration problem at once", () => {
    // Failing on the first would make a multi-error misconfiguration take
    // several restarts to diagnose.
    expect(() => loadServerEnv({ MATCH_SEED: "abc", LOG_LEVEL: "loud" })).toThrow(/MATCH_SEED/);
    expect(() => loadServerEnv({ MATCH_SEED: "abc", LOG_LEVEL: "loud" })).toThrow(/LOG_LEVEL/);
  });
});

describe("loadServerEnv: MATCH_LOBBY_MS", () => {
  it("defaults to no override, so the room uses its own gameplay countdown", () => {
    expect(loadServerEnv({}).matchLobbyMs).toBeNull();
  });

  it("accepts an in-range duration, including zero for no countdown at all", () => {
    expect(loadServerEnv({ MATCH_LOBBY_MS: "1000" }).matchLobbyMs).toBe(1000);
    expect(loadServerEnv({ MATCH_LOBBY_MS: "0" }).matchLobbyMs).toBe(0);
  });

  it("treats an empty value as unset rather than as an instant match start", () => {
    // An exported-but-empty variable is a common shell accident; reading it as
    // zero would silently remove the lobby a second player needs to join.
    expect(loadServerEnv({ MATCH_LOBBY_MS: "" }).matchLobbyMs).toBeNull();
  });

  it("refuses a malformed, negative, or absurd duration instead of coercing it", () => {
    for (const lobby of ["-1", "1.5", "abc", "3600001", "NaN"]) {
      expect(() => loadServerEnv({ MATCH_LOBBY_MS: lobby })).toThrow(/MATCH_LOBBY_MS/);
    }
  });
});

describe("loadServerEnv: Supabase (M5)", () => {
  const SECRET = "sb_secret_example_value_not_a_real_key";
  const URL_VALUE = "https://example.supabase.co";

  it("defaults to no persistence when neither variable is set", () => {
    // A fresh clone has no `.env` at all (`docs/DECISIONS.md` D42/D46), and the
    // server must still start — on the in-memory store, loudly.
    const env = loadServerEnv({});
    expect(env.supabaseUrl).toBeNull();
    expect(env.supabaseSecretKey).toBeNull();
  });

  it("accepts both together", () => {
    const env = loadServerEnv({ SUPABASE_URL: URL_VALUE, SUPABASE_SECRET_KEY: SECRET });
    expect(env.supabaseUrl).toBe(URL_VALUE);
    expect(hasSupabaseConfig(env)).toBe(true);
  });

  it("rejects one without the other, in both directions", () => {
    // Half-configured is a misconfiguration, not a partial setup: a server that
    // started this way would fail later, at a join, with a much worse error.
    expect(() => loadServerEnv({ SUPABASE_URL: URL_VALUE })).toThrow(/must be set together/);
    expect(() => loadServerEnv({ SUPABASE_SECRET_KEY: SECRET })).toThrow(/must be set together/);
  });

  it("rejects a publishable key pasted into the secret slot", () => {
    // The likeliest real mistake, and one that would otherwise present as
    // "everything fails once a player tries to save".
    expect(() =>
      loadServerEnv({
        SUPABASE_URL: URL_VALUE,
        SUPABASE_SECRET_KEY: "sb_publishable_example_value",
      }),
    ).toThrow(/must be a secret key/);
  });

  it("never puts the key's value in the error it throws", () => {
    // An invalid-configuration error is exactly the sort of thing that ends up
    // in a log aggregator, an issue report, or a screenshot.
    const leakyValue = "sb_publishable_SUPER_SECRET_LOOKING_VALUE_12345";
    try {
      loadServerEnv({ SUPABASE_URL: URL_VALUE, SUPABASE_SECRET_KEY: leakyValue });
      expect.unreachable("expected the invalid key to throw");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      expect(message).toContain("SUPABASE_SECRET_KEY");
      expect(message).not.toContain(leakyValue);
      expect(message).not.toContain("SUPER_SECRET_LOOKING_VALUE");
    }
  });

  it("rejects a URL that is not absolute", () => {
    expect(() => loadServerEnv({ SUPABASE_URL: "not-a-url", SUPABASE_SECRET_KEY: SECRET })).toThrow(
      /SUPABASE_URL/,
    );
  });
});

describe("assertPersistenceConfigured (M5)", () => {
  it("refuses to start a production server with no persistence", () => {
    // The in-memory fallback is what lets CI and a fresh clone run. The danger of
    // a fallback is a real deployment silently landing on it and discarding every
    // player's progression without erroring once — closed off here, at startup.
    const env = loadServerEnv({ NODE_ENV: "production" });
    expect(() => assertPersistenceConfigured(env)).toThrow(/Refusing to start/);
  });

  it("allows production once Supabase is configured", () => {
    const env = loadServerEnv({
      NODE_ENV: "production",
      SUPABASE_URL: "https://example.supabase.co",
      SUPABASE_SECRET_KEY: "sb_secret_example_value_not_a_real_key",
    });
    expect(() => assertPersistenceConfigured(env)).not.toThrow();
  });

  it("allows development and test without it, which is what CI runs on", () => {
    for (const nodeEnv of ["development", "test"]) {
      expect(() => assertPersistenceConfigured(loadServerEnv({ NODE_ENV: nodeEnv }))).not.toThrow();
    }
  });
});

describe("loadServerEnv: SUPABASE_URL scheme", () => {
  const SECRET = "sb_secret_example_value_not_a_real_key";

  it("rejects a URL whose scheme is not http(s)", () => {
    // A stray character (`hhttps://…`) parses cleanly as a URL and then fails
    // several layers down inside the Supabase client, naming neither the
    // variable nor the file. This turns it into one line at startup.
    for (const bad of ["hhttps://project.supabase.co", "postgres://host/db", "ftp://host"]) {
      expect(() => loadServerEnv({ SUPABASE_URL: bad, SUPABASE_SECRET_KEY: SECRET })).toThrow(
        /SUPABASE_URL must be an http\(s\) URL/,
      );
    }
  });

  it("accepts http and https", () => {
    for (const good of ["https://project.supabase.co", "http://localhost:54321"]) {
      expect(loadServerEnv({ SUPABASE_URL: good, SUPABASE_SECRET_KEY: SECRET }).supabaseUrl).toBe(
        good,
      );
    }
  });
});
