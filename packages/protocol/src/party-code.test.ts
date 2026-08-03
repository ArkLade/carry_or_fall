import { describe, expect, it } from "vitest";

import { PARTY_CODE_ALPHABET, PARTY_CODE_LENGTH, isPartyJoinCode } from "./party-code";

/**
 * A code of the right length made only of alphabet characters.
 *
 * Taken from the **letters** end of the alphabet on purpose: a code drawn from
 * the digits would be unchanged by `toLowerCase()`, and the case-sensitivity
 * assertion below would then pass without testing anything.
 */
function validCode(): string {
  return PARTY_CODE_ALPHABET.slice(-PARTY_CODE_LENGTH);
}

describe("isPartyJoinCode", () => {
  it("accepts a code of the declared length drawn from the declared alphabet", () => {
    expect(isPartyJoinCode(validCode())).toBe(true);
  });

  it("refuses a code that is too short or too long", () => {
    expect(isPartyJoinCode(validCode().slice(0, -1))).toBe(false);
    expect(isPartyJoinCode(validCode() + PARTY_CODE_ALPHABET[0])).toBe(false);
    expect(isPartyJoinCode("")).toBe(false);
  });

  it("refuses the four characters the alphabet deliberately omits", () => {
    // I/L/O are the pairs a human confuses with 1/1/0 when reading a code
    // aloud; U is omitted so a random draw cannot spell an insult. A code
    // containing one did not come from this server.
    for (const character of ["I", "L", "O", "U"]) {
      expect(PARTY_CODE_ALPHABET).not.toContain(character);
      const code = character.repeat(PARTY_CODE_LENGTH);
      expect(isPartyJoinCode(code)).toBe(false);
    }
  });

  it("refuses lowercase, whitespace, and punctuation", () => {
    expect(isPartyJoinCode(validCode().toLowerCase())).toBe(false);
    expect(isPartyJoinCode(` ${validCode().slice(1)}`)).toBe(false);
    expect(isPartyJoinCode(`${validCode().slice(0, -1)}-`)).toBe(false);
  });

  it("refuses a value that is not a string at all", () => {
    for (const bad of [null, undefined, 12_345_678, ["A"], {}, true]) {
      expect(isPartyJoinCode(bad)).toBe(false);
    }
  });

  it("is anchored, so a valid code embedded in a longer string is refused", () => {
    // An unanchored pattern would accept `"…' or 1=1 -- ABCDEFGH"` and hand it
    // to the matchmaker as a filter value.
    expect(isPartyJoinCode(`x${validCode()}`)).toBe(false);
    expect(isPartyJoinCode(`${validCode()}\nABCDEFGH`)).toBe(false);
  });

  it("has an alphabet with no repeated symbol, so every symbol is equally likely", () => {
    // A duplicated character would silently bias generation toward it and cost
    // entropy the join-code argument (`docs/DECISIONS.md` D56) depends on.
    expect(new Set(PARTY_CODE_ALPHABET).size).toBe(PARTY_CODE_ALPHABET.length);
  });
});
