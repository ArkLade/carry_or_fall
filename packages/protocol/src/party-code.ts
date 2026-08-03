/**
 * The shape of a party join code (M6.1, `docs/M6_ISSUES.md` §1.4).
 *
 * Both ends need this: the client refuses a malformed code before it reaches
 * the network (so a typo is a message on the screen rather than a round trip),
 * and the server refuses it again at the join boundary (because the client's
 * check is a courtesy and the server's is the authority — the same split D38
 * established for the skill loadout).
 *
 * **Generation is deliberately not here.** Minting a code needs a CSPRNG and
 * belongs to the server alone (`apps/server/src/party/join-code.ts`); a client
 * that could produce a code could squat one. This module owns only the shared
 * rule for what a well-formed code looks like.
 *
 * The alphabet is Crockford's base32 set: digits and uppercase letters with
 * `I`, `L`, `O`, and `U` removed. The first three are removed because a code is
 * meant to be read aloud or typed from a screenshot and `1/I/L` and `0/O` are
 * the pairs humans confuse; `U` is removed because its presence is what lets a
 * random draw spell something a player would rather not send to a friend.
 *
 * Thirty-two symbols over eight characters is 40 bits — about 1.1 x 10^12
 * codes. That number is the primary defence against guessing, and
 * `docs/DECISIONS.md` D56 states the rest of the argument (no room-listing
 * route, a bounded lifetime, a party cap, and an identical answer for a miss
 * whether or not any party exists).
 */

/** Crockford base32: no `I`, `L`, `O`, or `U`. */
export const PARTY_CODE_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

/** Characters per code. Eight, over a 32-symbol alphabet, is 40 bits. */
export const PARTY_CODE_LENGTH = 8;

const PARTY_CODE_PATTERN = new RegExp(`^[${PARTY_CODE_ALPHABET}]{${String(PARTY_CODE_LENGTH)}}$`);

/**
 * Whether `value` is a well-formed join code. Shape only — whether a party
 * actually answers to it, and whether it has expired, are the server's to
 * decide.
 *
 * Case-sensitive on purpose: the alphabet is uppercase, so accepting lowercase
 * here would mean two spellings of one code and two things to keep in agreement.
 * Callers that take human input uppercase it first (see `LoadoutScene`'s code
 * entry), which is a presentation concern rather than a protocol one.
 */
export function isPartyJoinCode(value: unknown): value is string {
  return typeof value === "string" && PARTY_CODE_PATTERN.test(value);
}
