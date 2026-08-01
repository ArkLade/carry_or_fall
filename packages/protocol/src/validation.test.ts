import { describe, expect, it } from "vitest";

import { PROTOCOL_VERSION } from "./version";
import {
  validateClientHandshake,
  validateDiscardItemMessage,
  validateHealthResponse,
  validateInputMessage,
  validateMatchJoinOptions,
  validateSecureItemMessage,
} from "./validation";

const CONTENT_VERSION = 1;

/** A legal handshake, spread into cases that vary exactly one field. */
const handshake = {
  protocolVersion: PROTOCOL_VERSION,
  contentVersion: CONTENT_VERSION,
  buildVersion: "0.0.0-m0",
};

/** A legal input message, spread into cases that vary exactly one field. */
const input = {
  sequence: 1,
  moveX: 0,
  moveY: 0,
  aimAngle: 0,
  attackPressed: false,
  secondaryAttackPressed: false,
  dashPressed: false,
  interactPressed: false,
};

/** Matches `simulation-core`'s `INVENTORY_SIZE`; the room supplies the real value. */
const SLOT_COUNT = 6;
/** Matches `simulation-core`'s `MAX_SKILL_SLOTS`. */
const MAX_SKILL_IDS = 3;

describe("validateClientHandshake", () => {
  it("accepts a well-formed handshake and returns exactly the known fields", () => {
    const result = validateClientHandshake(handshake);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toEqual(handshake);
    }
  });

  it("ignores unknown extra fields rather than passing them through", () => {
    const result = validateClientHandshake({ ...handshake, injected: "should not survive" });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(Object.keys(result.value).sort()).toEqual([
        "buildVersion",
        "contentVersion",
        "protocolVersion",
      ]);
    }
  });

  it("rejects non-object inputs", () => {
    for (const bad of [null, undefined, 42, "hello", true, [1, 2, 3]]) {
      expect(validateClientHandshake(bad).ok).toBe(false);
    }
  });

  it("rejects invalid protocol versions", () => {
    for (const version of [0, -1, 1.5, Number.NaN, "1", undefined]) {
      expect(validateClientHandshake({ ...handshake, protocolVersion: version }).ok).toBe(false);
    }
  });

  it("rejects a handshake with no content version, which is what a pre-M4 client sends", () => {
    const { protocolVersion, buildVersion } = handshake;
    expect(validateClientHandshake({ protocolVersion, buildVersion }).ok).toBe(false);
  });

  it("rejects invalid content versions", () => {
    for (const version of [0, -1, 2.5, Number.NaN, "1", null]) {
      expect(validateClientHandshake({ ...handshake, contentVersion: version }).ok).toBe(false);
    }
  });

  it("rejects invalid build versions", () => {
    for (const build of ["", "nope", "1.2", 3, undefined]) {
      expect(validateClientHandshake({ ...handshake, buildVersion: build }).ok).toBe(false);
    }
  });
});

describe("validateMatchJoinOptions", () => {
  it("accepts a handshake plus a legal skill selection", () => {
    const result = validateMatchJoinOptions(
      { ...handshake, skillLoadoutIds: ["ricochet", "extended_reach"] },
      MAX_SKILL_IDS,
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.skillLoadoutIds).toEqual(["ricochet", "extended_reach"]);
      expect(result.value.protocolVersion).toBe(PROTOCOL_VERSION);
    }
  });

  it("accepts an empty selection (a player may enter with no skills)", () => {
    const result = validateMatchJoinOptions({ ...handshake, skillLoadoutIds: [] }, MAX_SKILL_IDS);
    expect(result.ok).toBe(true);
  });

  it("rejects a selection that is not an array", () => {
    for (const bad of [undefined, null, "ricochet", 3, { 0: "ricochet" }]) {
      expect(
        validateMatchJoinOptions({ ...handshake, skillLoadoutIds: bad }, MAX_SKILL_IDS).ok,
      ).toBe(false);
    }
  });

  it("rejects an oversized selection before it ever reaches the loadout rules", () => {
    const tooMany = ["a", "b", "c", "d"];
    expect(
      validateMatchJoinOptions({ ...handshake, skillLoadoutIds: tooMany }, MAX_SKILL_IDS).ok,
    ).toBe(false);
  });

  it("rejects non-string, empty, and oversized ids", () => {
    for (const bad of [[1], [null], [""], ["x".repeat(65)], [{}]]) {
      expect(
        validateMatchJoinOptions({ ...handshake, skillLoadoutIds: bad }, MAX_SKILL_IDS).ok,
      ).toBe(false);
    }
  });

  it("rejects an otherwise-legal selection carried by an incompatible handshake", () => {
    const result = validateMatchJoinOptions(
      { ...handshake, contentVersion: "nope", skillLoadoutIds: ["ricochet"] },
      MAX_SKILL_IDS,
    );
    expect(result.ok).toBe(false);
  });
});

describe("validateInputMessage", () => {
  it("accepts a well-formed input and returns exactly the known fields", () => {
    const result = validateInputMessage({
      ...input,
      sequence: 7,
      moveX: -1,
      moveY: 1,
      aimAngle: Math.PI / 2,
      attackPressed: true,
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toEqual({
        sequence: 7,
        moveX: -1,
        moveY: 1,
        aimAngle: Math.PI / 2,
        attackPressed: true,
        secondaryAttackPressed: false,
        dashPressed: false,
        interactPressed: false,
      });
    }
  });

  it("drops fabricated outcome fields instead of passing them through", () => {
    // The whole point of the authority model: a client can decorate its input
    // with a position, a damage number, or a reward, and none of it survives
    // validation — the validated value carries only intent.
    const result = validateInputMessage({
      ...input,
      x: 9999,
      y: 9999,
      position: { x: 1, y: 2 },
      damage: 999,
      pointsGained: { force: 5000 },
      extracted: true,
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(Object.keys(result.value).sort()).toEqual([
        "aimAngle",
        "attackPressed",
        "dashPressed",
        "interactPressed",
        "moveX",
        "moveY",
        "secondaryAttackPressed",
        "sequence",
      ]);
    }
  });

  it("rejects non-object inputs", () => {
    for (const bad of [null, undefined, 0, "input", true, []]) {
      expect(validateInputMessage(bad).ok).toBe(false);
    }
  });

  it("rejects out-of-range or non-integer sequences", () => {
    for (const sequence of [-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, 2_147_483_648, "1"]) {
      expect(validateInputMessage({ ...input, sequence }).ok).toBe(false);
    }
  });

  it("rejects movement axes outside -1, 0, 1 — the client cannot ask to move faster", () => {
    for (const moveX of [2, -2, 0.5, 100, Number.NaN, "1", true, null]) {
      expect(validateInputMessage({ ...input, moveX }).ok).toBe(false);
    }
    for (const moveY of [2, -2, 0.5, 100, Number.NaN, "1", true, null]) {
      expect(validateInputMessage({ ...input, moveY }).ok).toBe(false);
    }
  });

  it("rejects a non-finite or absurd aim angle", () => {
    for (const aimAngle of [Number.NaN, Number.POSITIVE_INFINITY, -Infinity, 1e9, "0", null]) {
      expect(validateInputMessage({ ...input, aimAngle }).ok).toBe(false);
    }
  });

  it("rejects non-boolean action flags", () => {
    for (const key of [
      "attackPressed",
      "secondaryAttackPressed",
      "dashPressed",
      "interactPressed",
    ]) {
      for (const bad of [1, 0, "true", null, undefined]) {
        expect(validateInputMessage({ ...input, [key]: bad }).ok).toBe(false);
      }
    }
  });
});

describe("validateSecureItemMessage / validateDiscardItemMessage", () => {
  for (const [name, validate] of [
    ["secure_item", validateSecureItemMessage],
    ["discard_item", validateDiscardItemMessage],
  ] as const) {
    it(`${name}: accepts every in-range slot index`, () => {
      for (let slot = 0; slot < SLOT_COUNT; slot += 1) {
        const result = validate({ sourceSlot: slot }, SLOT_COUNT);
        expect(result.ok).toBe(true);
        if (result.ok) {
          expect(result.value.sourceSlot).toBe(slot);
        }
      }
    });

    it(`${name}: rejects an out-of-range, fractional, or non-numeric slot`, () => {
      for (const sourceSlot of [-1, SLOT_COUNT, 99, 1.5, Number.NaN, "2", null, undefined]) {
        expect(validate({ sourceSlot }, SLOT_COUNT).ok).toBe(false);
      }
    });

    it(`${name}: rejects a payload naming an item instead of a slot`, () => {
      // A client does not own the inventory and cannot assert what is in it.
      expect(validate({ itemId: "power_core" }, SLOT_COUNT).ok).toBe(false);
    });

    it(`${name}: rejects non-object inputs`, () => {
      for (const bad of [null, undefined, 2, "2", []]) {
        expect(validate(bad, SLOT_COUNT).ok).toBe(false);
      }
    });
  }
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
