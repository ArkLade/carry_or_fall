import { describe, expect, it } from "vitest";

import {
  PROTOCOL_VERSION,
  isBuildVersion,
  isContentCompatible,
  isProtocolCompatible,
} from "./version";

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

describe("isContentCompatible", () => {
  it("accepts a peer whose content tables match the local ones", () => {
    expect(isContentCompatible(3, 3)).toBe(true);
  });

  it("refuses a peer running older or newer content", () => {
    // A stale tab would draw arcs, projectile behavior, and point previews from
    // a different content table than the one deciding outcomes (technical plan
    // §35; `docs/DECISIONS.md` D34).
    expect(isContentCompatible(2, 3)).toBe(false);
    expect(isContentCompatible(4, 3)).toBe(false);
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
