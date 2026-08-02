import { describe, expect, it } from "vitest";

import {
  ALL_UNLOCKS,
  DEFAULT_UNLOCK_IDS,
  DEFAULT_UNLOCKS,
  findUnlock,
  lockedContentIds,
  THRESHOLD_UNLOCKS,
  unlocksEarnedAt,
  type PointBalances,
} from "./unlocks";
import { ALL_SKILLS } from "./skills";
import { ALL_WEAPONS } from "./weapons";

const ZERO: PointBalances = { force: 0, precision: 0, motion: 0, guard: 0, signal: 0 };

function balance(partial: Partial<PointBalances>): PointBalances {
  return { ...ZERO, ...partial };
}

describe("unlock content", () => {
  it("names only content that exists", () => {
    // An unlock for a deleted or misspelled id would be a row nothing can spend
    // — and, because the join gate refuses anything not unlocked, a skill no
    // account could ever legally bring.
    const skillIds = new Set(ALL_SKILLS.map((skill) => skill.id));
    const weaponIds = new Set(ALL_WEAPONS.map((weapon) => weapon.id));

    for (const unlock of ALL_UNLOCKS) {
      const known = unlock.unlockType === "skill" ? skillIds : weaponIds;
      expect(known.has(unlock.id), `${unlock.id} names no ${unlock.unlockType}`).toBe(true);
    }
  });

  it("covers every shipped skill exactly once", () => {
    // The two halves must partition the skill table: a skill in neither could
    // never be selected by any account, and a skill in both would be earnable
    // after already being granted.
    const skillUnlockIds = ALL_UNLOCKS.filter((unlock) => unlock.unlockType === "skill").map(
      (unlock) => unlock.id,
    );

    expect([...skillUnlockIds].sort()).toEqual([...ALL_SKILLS.map((skill) => skill.id)].sort());
    expect(new Set(skillUnlockIds).size).toBe(skillUnlockIds.length);
  });

  it("lets a fresh account play the documented default loadout (D31)", () => {
    // `LoadoutScene`'s pre-selected loadout must be legal on a brand-new
    // account, or the first thing a new player sees is a refused join.
    for (const id of ["ricochet", "extended_reach", "bulwark_strike"]) {
      expect(DEFAULT_UNLOCK_IDS).toContain(id);
    }
    expect(
      lockedContentIds(["ricochet", "extended_reach", "bulwark_strike"], DEFAULT_UNLOCK_IDS),
    ).toEqual([]);
  });

  it("gates the rest behind thresholds a fresh account has not met", () => {
    const defaults = new Set(DEFAULT_UNLOCK_IDS);
    for (const unlock of THRESHOLD_UNLOCKS) {
      expect(defaults.has(unlock.id)).toBe(false);
      expect(unlock.requires).not.toBeNull();
    }
    expect(unlocksEarnedAt(ZERO)).toEqual([]);
  });

  it("leaves Guard with no unlock, which is a recorded gap", () => {
    // docs/M5_ISSUES.md §1.1: concept §6.4's unlock targets are armor types and
    // shield skills; armor is unimplemented and the one shield skill is a
    // default. This asserts the gap so that adding a Guard unlock later has to
    // come here and say so, rather than the gap quietly persisting unnoticed.
    const guardUnlocks = THRESHOLD_UNLOCKS.filter(
      (unlock) => unlock.requires?.category === "guard",
    );
    expect(guardUnlocks).toEqual([]);

    // A large Guard balance still earns nothing, which is the player-visible
    // consequence.
    expect(unlocksEarnedAt(balance({ guard: 10_000 }))).toEqual([]);
  });
});

describe("unlocksEarnedAt", () => {
  it("is inclusive at the threshold and exclusive one point below", () => {
    const stunning = findUnlock("stunning_blows");
    expect(stunning?.requires).toEqual({ category: "force", amount: 40 });

    expect(unlocksEarnedAt(balance({ force: 39 })).map((unlock) => unlock.id)).toEqual([]);
    expect(unlocksEarnedAt(balance({ force: 40 })).map((unlock) => unlock.id)).toEqual([
      "stunning_blows",
    ]);
  });

  it("only counts the category a threshold names", () => {
    // 200 points of the wrong category must not open a Precision unlock.
    expect(unlocksEarnedAt(balance({ force: 200 })).map((unlock) => unlock.id)).toEqual([
      "stunning_blows",
    ]);
  });

  it("returns the tiers of one category cumulatively", () => {
    // Signal has two tiers; crossing the higher one must not drop the lower,
    // because settlement inserts the whole returned set.
    expect(unlocksEarnedAt(balance({ signal: 40 })).map((unlock) => unlock.id)).toEqual([
      "homing_arrows",
    ]);
    expect(unlocksEarnedAt(balance({ signal: 100 })).map((unlock) => unlock.id)).toEqual([
      "homing_arrows",
      "returning_shot",
    ]);
  });

  it("returns everything satisfied, not a difference, so re-settling is a no-op", () => {
    const everything = balance({ force: 100, precision: 100, motion: 100, signal: 100 });
    const first = unlocksEarnedAt(everything);
    const second = unlocksEarnedAt(everything);
    expect(second).toEqual(first);
    expect(first).toHaveLength(THRESHOLD_UNLOCKS.length);
  });
});

describe("lockedContentIds", () => {
  it("reports ids the account does not hold", () => {
    expect(lockedContentIds(["ricochet", "homing_arrows"], DEFAULT_UNLOCK_IDS)).toEqual([
      "homing_arrows",
    ]);
  });

  it("reports an unknown id as locked rather than silently allowing it", () => {
    expect(lockedContentIds(["not_a_skill"], DEFAULT_UNLOCK_IDS)).toEqual(["not_a_skill"]);
  });

  it("accepts an id once its unlock row exists", () => {
    expect(lockedContentIds(["homing_arrows"], [...DEFAULT_UNLOCK_IDS, "homing_arrows"])).toEqual(
      [],
    );
  });
});

describe("default provisioning", () => {
  it("provisions ids, not definitions, and holds no duplicates", () => {
    expect(DEFAULT_UNLOCK_IDS).toHaveLength(DEFAULT_UNLOCKS.length);
    expect(new Set(DEFAULT_UNLOCK_IDS).size).toBe(DEFAULT_UNLOCK_IDS.length);
  });
});
