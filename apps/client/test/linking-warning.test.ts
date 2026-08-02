/**
 * The §17.3 anonymous-account warning's trigger rule (M5.8).
 *
 * Technical plan §17.3 fixes the timing — "after the player gains progression" —
 * and getting it wrong is a real failure in both directions, so both directions
 * are asserted here rather than only the positive case.
 */
import { describe, expect, it } from "vitest";

import {
  ANONYMOUS_ACCOUNT_WARNING,
  hasProgression,
  shouldWarnAboutAnonymousAccount,
} from "../src/account/linking-warning";

const NOTHING = { force: 0, precision: 0, motion: 0, guard: 0, signal: 0 };
const SOMETHING = { force: 0, precision: 0, motion: 0, guard: 0, signal: 1 };

describe("hasProgression", () => {
  it("is false for a fresh account and true for a single point in any category", () => {
    expect(hasProgression(NOTHING)).toBe(false);
    for (const category of ["force", "precision", "motion", "guard", "signal"] as const) {
      expect(hasProgression({ ...NOTHING, [category]: 1 })).toBe(true);
    }
  });
});

describe("shouldWarnAboutAnonymousAccount", () => {
  it("stays quiet before the player has earned anything", () => {
    // §17.1's instant guest play is the thing being protected: a first-time
    // visitor warned about losing nothing is pure friction.
    expect(
      shouldWarnAboutAnonymousAccount({
        isAnonymous: true,
        balances: NOTHING,
        unconfigured: false,
      }),
    ).toBe(false);
  });

  it("warns once an anonymous account has progression to lose", () => {
    expect(
      shouldWarnAboutAnonymousAccount({
        isAnonymous: true,
        balances: SOMETHING,
        unconfigured: false,
      }),
    ).toBe(true);
  });

  it("stays quiet for a linked account, however much it has earned", () => {
    // A linked account is recoverable, so the warning would be untrue.
    expect(
      shouldWarnAboutAnonymousAccount({
        isAnonymous: false,
        balances: { force: 500, precision: 500, motion: 500, guard: 500, signal: 500 },
        unconfigured: false,
      }),
    ).toBe(false);
  });

  it("stays quiet when this build has no account at all", () => {
    // A fresh clone with no Supabase configuration has nothing to link, so a
    // warning about losing an account would be misleading rather than cautious.
    expect(
      shouldWarnAboutAnonymousAccount({
        isAnonymous: true,
        balances: SOMETHING,
        unconfigured: true,
      }),
    ).toBe(false);
  });

  it("keys on the balance, not on a single run's delta", () => {
    // A player who earned points, closed the tab, and came back still has
    // something to lose — so the warning must survive a session, which is what
    // makes one rule serve both the result screen and the loadout screen.
    expect(
      shouldWarnAboutAnonymousAccount({
        isAnonymous: true,
        balances: { force: 42, precision: 0, motion: 0, guard: 0, signal: 0 },
        unconfigured: false,
      }),
    ).toBe(true);
  });
});

describe("the warning text", () => {
  it("names all three of §17.3's loss conditions", () => {
    const text = ANONYMOUS_ACCOUNT_WARNING.toLowerCase();
    expect(text).toContain("storage");
    expect(text).toContain("device");
    expect(text).toContain("sign out");
    // And says what to do about it, which §17.2 is the reason for.
    expect(text).toContain("link");
  });
});
