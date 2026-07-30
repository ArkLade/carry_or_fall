import { describe, expect, it } from "vitest";

import { PROTOCOL_VERSION, isBuildVersion, isProtocolCompatible } from "./version";

describe("protocol version", () => {
  it("is a positive integer", () => {
    expect(Number.isInteger(PROTOCOL_VERSION)).toBe(true);
    expect(PROTOCOL_VERSION).toBeGreaterThanOrEqual(1);
  });

  it("treats an equal peer version as compatible", () => {
    expect(isProtocolCompatible(PROTOCOL_VERSION)).toBe(true);
  });

  it("treats a different peer version as incompatible", () => {
    expect(isProtocolCompatible(PROTOCOL_VERSION + 1)).toBe(false);
    expect(isProtocolCompatible(PROTOCOL_VERSION - 1)).toBe(false);
  });
});

describe("isBuildVersion", () => {
  it("accepts semver-like build strings", () => {
    expect(isBuildVersion("0.0.0-m0")).toBe(true);
    expect(isBuildVersion("1.2.3")).toBe(true);
    expect(isBuildVersion("10.20.30-rc.1")).toBe(true);
  });

  it("rejects malformed or non-string values", () => {
    expect(isBuildVersion("")).toBe(false);
    expect(isBuildVersion("1.2")).toBe(false);
    expect(isBuildVersion("1.2.3.4")).toBe(false);
    expect(isBuildVersion("not-a-version")).toBe(false);
    expect(isBuildVersion(123)).toBe(false);
    expect(isBuildVersion(null)).toBe(false);
    expect(isBuildVersion(undefined)).toBe(false);
    expect(isBuildVersion("1.2.3-" + "x".repeat(100))).toBe(false);
  });
});
