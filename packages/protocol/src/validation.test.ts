import { describe, expect, it } from "vitest";

import { PROTOCOL_VERSION } from "./version";
import { validateClientHandshake, validateHealthResponse } from "./validation";

describe("validateClientHandshake", () => {
  it("accepts a well-formed handshake and returns exactly the known fields", () => {
    const result = validateClientHandshake({
      protocolVersion: PROTOCOL_VERSION,
      buildVersion: "0.0.0-m0",
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toEqual({
        protocolVersion: PROTOCOL_VERSION,
        buildVersion: "0.0.0-m0",
      });
    }
  });

  it("ignores unknown extra fields rather than passing them through", () => {
    const result = validateClientHandshake({
      protocolVersion: PROTOCOL_VERSION,
      buildVersion: "1.2.3",
      injected: "should not survive",
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(Object.keys(result.value).sort()).toEqual(["buildVersion", "protocolVersion"]);
    }
  });

  it("rejects non-object inputs", () => {
    for (const bad of [null, undefined, 42, "hello", true, [1, 2, 3]]) {
      expect(validateClientHandshake(bad).ok).toBe(false);
    }
  });

  it("rejects invalid protocol versions", () => {
    for (const version of [0, -1, 1.5, Number.NaN, "1", undefined]) {
      const result = validateClientHandshake({
        protocolVersion: version,
        buildVersion: "0.0.0-m0",
      });
      expect(result.ok).toBe(false);
    }
  });

  it("rejects invalid build versions", () => {
    for (const build of ["", "nope", "1.2", 3, undefined]) {
      const result = validateClientHandshake({
        protocolVersion: PROTOCOL_VERSION,
        buildVersion: build,
      });
      expect(result.ok).toBe(false);
    }
  });
});

describe("validateHealthResponse", () => {
  it("accepts a well-formed health body and returns exactly the known fields", () => {
    const result = validateHealthResponse({
      status: "ok",
      buildVersion: "0.0.0-m0",
      protocolVersion: PROTOCOL_VERSION,
      uptime: 12.5,
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toEqual({
        status: "ok",
        buildVersion: "0.0.0-m0",
        protocolVersion: PROTOCOL_VERSION,
        uptime: 12.5,
      });
    }
  });

  it("rejects non-object inputs", () => {
    for (const bad of [null, undefined, 42, "ok", true, []]) {
      expect(validateHealthResponse(bad).ok).toBe(false);
    }
  });

  it("rejects a non-ok status", () => {
    expect(
      validateHealthResponse({
        status: "degraded",
        buildVersion: "0.0.0-m0",
        protocolVersion: PROTOCOL_VERSION,
        uptime: 1,
      }).ok,
    ).toBe(false);
  });

  it("rejects malformed versions and uptime", () => {
    const base = {
      status: "ok",
      buildVersion: "0.0.0-m0",
      protocolVersion: PROTOCOL_VERSION,
      uptime: 1,
    };
    expect(validateHealthResponse({ ...base, buildVersion: "nope" }).ok).toBe(false);
    expect(validateHealthResponse({ ...base, protocolVersion: 0 }).ok).toBe(false);
    expect(validateHealthResponse({ ...base, uptime: -1 }).ok).toBe(false);
    expect(validateHealthResponse({ ...base, uptime: Number.NaN }).ok).toBe(false);
    expect(validateHealthResponse({ ...base, uptime: "1" }).ok).toBe(false);
  });
});
