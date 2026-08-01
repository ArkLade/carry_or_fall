/**
 * The server reads its configuration from the process environment — an
 * untrusted boundary — so every value is validated before use and a
 * misconfigured server fails to start rather than starting half-working.
 */
import { describe, expect, it } from "vitest";

import { loadServerEnv } from "../src/config/env";

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
