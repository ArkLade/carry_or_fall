import { describe, expect, it } from "vitest";

import { PROTOCOL_VERSION } from "./version";
import { validateClientHello } from "./validation";

describe("validateClientHello", () => {
  it("accepts a well-formed payload and returns exactly the known fields", () => {
    const result = validateClientHello({
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
    const result = validateClientHello({
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
      expect(validateClientHello(bad).ok).toBe(false);
    }
  });

  it("rejects invalid protocol versions", () => {
    for (const version of [0, -1, 1.5, Number.NaN, "1", undefined]) {
      const result = validateClientHello({
        protocolVersion: version,
        buildVersion: "0.0.0-m0",
      });
      expect(result.ok).toBe(false);
    }
  });

  it("rejects invalid build versions", () => {
    for (const build of ["", "nope", "1.2", 3, undefined]) {
      const result = validateClientHello({
        protocolVersion: PROTOCOL_VERSION,
        buildVersion: build,
      });
      expect(result.ok).toBe(false);
    }
  });
});
