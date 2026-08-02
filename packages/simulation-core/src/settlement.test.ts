import { describe, expect, it } from "vitest";

import { honingStone, resonantCore, warlordsSeal } from "@carry-or-fall/game-content";

import { createEmptyInventory } from "./inventory";
import { buildDeathResult, buildExtractionResult } from "./run-result";
import { buildRewardPayload, reservationKey, settlementKey } from "./settlement";

const CONTENT_VERSION = 2;

function inventoryWith(
  ...items: readonly (typeof honingStone)[]
): ReturnType<typeof createEmptyInventory> {
  const inventory = [...createEmptyInventory()];
  items.forEach((item, index) => {
    inventory[index] = item;
  });
  return inventory;
}

describe("buildRewardPayload", () => {
  it("carries only the secure slot's points when the run ended in death", () => {
    // Concept §4.4: normal inventory drops, the secure slot converts. The payload
    // must not quietly award loot the player lost on the ground.
    const result = buildDeathResult(inventoryWith(honingStone, resonantCore), warlordsSeal);
    const payload = buildRewardPayload(result, CONTENT_VERSION);

    expect(payload.outcome).toBe("died");
    expect(payload.points).toEqual(warlordsSeal.points);
    expect(payload.itemsConverted).toBe(1);
    expect(payload.itemsLost).toBe(2);
  });

  it("carries inventory plus secure slot when the run ended in extraction", () => {
    const result = buildExtractionResult(inventoryWith(honingStone, resonantCore), warlordsSeal);
    const payload = buildRewardPayload(result, CONTENT_VERSION);

    expect(payload.outcome).toBe("extracted");
    expect(payload.points).toEqual({
      force: honingStone.points.force + resonantCore.points.force + warlordsSeal.points.force,
      precision:
        honingStone.points.precision +
        resonantCore.points.precision +
        warlordsSeal.points.precision,
      motion: honingStone.points.motion + resonantCore.points.motion + warlordsSeal.points.motion,
      guard: honingStone.points.guard + resonantCore.points.guard + warlordsSeal.points.guard,
      signal: honingStone.points.signal + resonantCore.points.signal + warlordsSeal.points.signal,
    });
    expect(payload.itemsConverted).toBe(3);
    expect(payload.itemsLost).toBe(0);
  });

  it("awards nothing for a death with an empty secure slot", () => {
    const result = buildDeathResult(inventoryWith(honingStone), null);
    const payload = buildRewardPayload(result, CONTENT_VERSION);

    expect(payload.points).toEqual({ force: 0, precision: 0, motion: 0, guard: 0, signal: 0 });
    expect(payload.itemsConverted).toBe(0);
    expect(payload.itemsLost).toBe(1);
  });

  it("stamps the content version the point values came from", () => {
    // A payload written under one content table and read under another has to be
    // interpretable; the only way to interpret it is to know its source.
    const result = buildExtractionResult(inventoryWith(honingStone), null);
    expect(buildRewardPayload(result, 7).contentVersion).toBe(7);
  });
});

describe("settlementKey", () => {
  it("is a pure function of the match and user, so a retry reproduces it", () => {
    // The whole crash-safety argument rests on this: a server that does not know
    // whether its write landed must be able to recompute the identical key.
    const first = settlementKey("11111111-1111-4111-8111-111111111111", "user-a");
    const second = settlementKey("11111111-1111-4111-8111-111111111111", "user-a");
    expect(second).toBe(first);
  });

  it("separates two players in one match, and one player across two matches", () => {
    const matchA = "11111111-1111-4111-8111-111111111111";
    const matchB = "22222222-2222-4222-8222-222222222222";

    expect(settlementKey(matchA, "user-a")).not.toBe(settlementKey(matchA, "user-b"));
    expect(settlementKey(matchA, "user-a")).not.toBe(settlementKey(matchB, "user-a"));
  });

  it("agrees with the reservation key, so recovery reconstructs the settlement key", () => {
    // docs/DATA_MODEL.md §4.4: recovery reads a reservation row and settles under
    // the key that match's own settlement would have used. If these two ever
    // diverged, a recovered reward would be a *second* award rather than the
    // same one.
    const matchId = "33333333-3333-4333-8333-333333333333";
    expect(reservationKey(matchId, "user-a")).toBe(settlementKey(matchId, "user-a"));
  });
});
