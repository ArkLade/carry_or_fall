/**
 * The anonymous-account warning (M5.8, technical plan §17.3,
 * `docs/DATA_MODEL.md` §7).
 *
 * §17.3 states both the content and the timing: an anonymous account cannot be
 * recovered after clearing browser storage, using another device, or signing out
 * without linking — and "the UI should explain this clearly **after the player
 * gains progression**".
 *
 * That timing is a real constraint in both directions. Shown too early it is
 * friction on the instant-guest-play §17.1 exists to protect, warning about the
 * loss of nothing. Shown too late it is a notification that something already
 * irrecoverable was at stake. So the trigger is the first settlement that
 * actually awards this anonymous account points: the first moment there is
 * something to lose.
 *
 * The rule is a pure function so it can be tested without a browser, and so the
 * scenes that display it cannot each drift into their own version of "has this
 * player earned anything yet".
 */
import type { PointTotalsPayload } from "@carry-or-fall/protocol";

/** Whether any of the five categories carries a positive amount. */
export function hasProgression(points: PointTotalsPayload): boolean {
  return (
    points.force > 0 ||
    points.precision > 0 ||
    points.motion > 0 ||
    points.guard > 0 ||
    points.signal > 0
  );
}

export interface WarningInput {
  /** Whether the signed-in account is anonymous, as the *server* reported it. */
  readonly isAnonymous: boolean;
  /** The account's balances after the settlement that just landed. */
  readonly balances: PointTotalsPayload;
  /** True once this build has no Supabase project: there is no account to lose. */
  readonly unconfigured: boolean;
}

/**
 * Whether to show the warning.
 *
 * Note what it keys on: the **balance**, not the delta. A player who earns
 * points, closes the tab, and returns still has something to lose, so the
 * warning stays visible for as long as the account is both anonymous and
 * non-empty. `docs/DATA_MODEL.md` §7 calls this "first shown at settlement, then
 * persistent on the loadout screen" — one rule produces both.
 */
export function shouldWarnAboutAnonymousAccount(input: WarningInput): boolean {
  if (input.unconfigured || !input.isAnonymous) {
    return false;
  }
  return hasProgression(input.balances);
}

/**
 * The warning text. §17.3's three loss conditions, verbatim in substance, plus
 * what to do about it. Kept here rather than inline in a scene so the two places
 * that show it cannot say different things.
 */
export const ANONYMOUS_ACCOUNT_WARNING = [
  "You are playing as a guest. This account cannot be recovered if you",
  "clear your browser storage, switch to another device, or sign out.",
  "Your points and unlocks would be gone for good.",
  "Link an email or sign-in provider to keep them.",
].join("\n");
