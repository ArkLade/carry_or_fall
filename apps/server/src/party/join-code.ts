/**
 * Minting party join codes (M6.2, `docs/M6_ISSUES.md` §1.4; the decision is
 * `docs/DECISIONS.md` D56).
 *
 * This repository is public, so the properties a code must have are written
 * down here rather than assumed by whoever reads the eight-character string and
 * thinks it looks short:
 *
 * 1. **Unpredictable.** Every character is drawn from `crypto.randomInt`, a
 *    CSPRNG. Not `Math.random`, which is seeded per process and whose output
 *    can be reconstructed from a handful of observed values.
 * 2. **Unrelated to anything.** No counter, no timestamp, no room id, no user
 *    id, no hash of any of them. Two codes minted a millisecond apart share no
 *    structure, so seeing one tells you nothing about the next.
 * 3. **Large enough.** Thirty-two symbols over eight characters is 40 bits:
 *    about 1.1 x 10^12 codes. Against even ten thousand simultaneously live
 *    parties, a guess lands with probability under 10^-8.
 * 4. **Server-only.** A client never proposes a code. One that could would
 *    squat memorable ones, or pick a code an accomplice already knows.
 * 5. **Short-lived.** {@link isJoinCodeExpired} bounds a code's life
 *    independently of the party's, so a code pasted into a public channel stops
 *    working while the party plays on.
 *
 * Non-enumerability is not this module's doing and is stated where it belongs
 * (D56): `@colyseus/core@0.17.45` exposes exactly one matchmaking route,
 * `POST /matchmake/:method/:roomName`, and no room-listing route at all, so the
 * room metadata a code lives in is not readable by any client.
 *
 * The *shape* of a code — alphabet and length — lives in
 * `@carry-or-fall/protocol` instead, because both ends check it. Only minting
 * is here.
 */
import { PARTY_CODE_ALPHABET, PARTY_CODE_LENGTH } from "@carry-or-fall/protocol";
import { randomInt } from "node:crypto";

/**
 * How long a minted code admits new members (`docs/DECISIONS.md` D56).
 *
 * Ten minutes: long enough to send a friend a code and have them load the game,
 * short enough that a code posted somewhere public is a door that closes.
 * Expiry does not end the party — the leader mints a replacement with one
 * keypress, and the old code stops working the moment they do.
 *
 * Proposed and balance-deferred like every other number neither authoritative
 * document supplies.
 */
export const PARTY_CODE_TTL_MS = 10 * 60 * 1_000;

/**
 * Mint a fresh join code.
 *
 * `randomInt(max)` is rejection-sampled by Node itself, so the distribution
 * over the alphabet is uniform — a naive `randomBytes(n)[i] % 32` would be too,
 * for a 32-symbol alphabet, but only by the accident that 32 divides 256, and
 * that accident would silently stop holding the day someone adds a symbol.
 */
export function generateJoinCode(): string {
  let code = "";
  for (let index = 0; index < PARTY_CODE_LENGTH; index += 1) {
    code += PARTY_CODE_ALPHABET[randomInt(PARTY_CODE_ALPHABET.length)];
  }
  return code;
}

/** Whether a code minted at `mintedAtMs` has passed its time-to-live. */
export function isJoinCodeExpired(mintedAtMs: number, nowMs: number, ttlMs: number): boolean {
  return nowMs - mintedAtMs >= ttlMs;
}

/** Milliseconds left before a code expires; never negative. */
export function joinCodeRemainingMs(mintedAtMs: number, nowMs: number, ttlMs: number): number {
  return Math.max(0, mintedAtMs + ttlMs - nowMs);
}
