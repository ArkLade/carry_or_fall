/**
 * Join-code generation (M6.2, `docs/M6_ISSUES.md` §3).
 *
 * These assert *properties of the output*, not the constants that produced it.
 * A test that checked `PARTY_CODE_LENGTH === 8` would pass for a generator that
 * returned `"AAAAAAAA"` every time, which is the failure worth catching: the
 * security argument in `docs/DECISIONS.md` D56 rests on the codes being
 * unpredictable and spread over the whole alphabet, not on the length constant
 * having a particular value.
 */
import { describe, expect, it } from "vitest";

import { PARTY_CODE_ALPHABET, isPartyJoinCode } from "@carry-or-fall/protocol";

import {
  PARTY_CODE_TTL_MS,
  generateJoinCode,
  isJoinCodeExpired,
  joinCodeRemainingMs,
} from "../src/party/join-code";

/** Enough draws that a badly biased generator shows up, cheap enough to run every time. */
const SAMPLE = 20_000;

function sample(): string[] {
  return Array.from({ length: SAMPLE }, () => generateJoinCode());
}

describe("generateJoinCode", () => {
  it("always produces a code the shared shape check accepts", () => {
    for (const code of sample()) {
      expect(isPartyJoinCode(code), `rejected its own output: ${code}`).toBe(true);
    }
  });

  it("draws from the whole alphabet, not a subset of it", () => {
    // A generator stuck on, say, the digits would pass every shape check while
    // costing 40 bits of entropy down to 26.
    const seen = new Set(sample().join(""));
    expect(seen.size).toBe(PARTY_CODE_ALPHABET.length);
  });

  it("produces no duplicate across twenty thousand draws", () => {
    // At 40 bits the birthday-collision probability over 20 000 draws is about
    // 1.8 x 10^-4, so a duplicate here means the generator is repeating, not
    // that we got unlucky.
    const codes = sample();
    expect(new Set(codes).size).toBe(codes.length);
  });

  it("is not sequential: consecutive codes do not share a growing prefix", () => {
    // A counter- or timestamp-derived code would have consecutive draws
    // agreeing on their leading characters almost every time. Over 20 000
    // consecutive pairs, agreement on even the first character should happen
    // about 1/32 of the time.
    const codes = sample();
    let sharedFirstCharacter = 0;
    for (let index = 1; index < codes.length; index += 1) {
      if (codes[index]![0] === codes[index - 1]![0]) {
        sharedFirstCharacter += 1;
      }
    }
    expect(sharedFirstCharacter / (codes.length - 1)).toBeLessThan(0.1);
  });

  it("spreads roughly evenly over the alphabet in the first position", () => {
    const counts = new Map<string, number>();
    for (const code of sample()) {
      const first = code[0]!;
      counts.set(first, (counts.get(first) ?? 0) + 1);
    }
    const expected = SAMPLE / PARTY_CODE_ALPHABET.length;
    for (const symbol of PARTY_CODE_ALPHABET) {
      const count = counts.get(symbol) ?? 0;
      // Generous bounds: this is a smoke test for a broken modulo or a
      // truncated range, not a statistical proof.
      expect(count, `symbol ${symbol} appeared ${String(count)} times`).toBeGreaterThan(
        expected * 0.5,
      );
      expect(count).toBeLessThan(expected * 1.5);
    }
  });
});

describe("join-code expiry", () => {
  it("is live before its time-to-live and dead at it", () => {
    const mintedAt = 1_000_000;
    expect(isJoinCodeExpired(mintedAt, mintedAt, PARTY_CODE_TTL_MS)).toBe(false);
    expect(isJoinCodeExpired(mintedAt, mintedAt + PARTY_CODE_TTL_MS - 1, PARTY_CODE_TTL_MS)).toBe(
      false,
    );
    // Inclusive at the boundary: a code that has run exactly its lifetime is
    // spent, not "about to be".
    expect(isJoinCodeExpired(mintedAt, mintedAt + PARTY_CODE_TTL_MS, PARTY_CODE_TTL_MS)).toBe(true);
  });

  it("reports remaining time that reaches zero and never goes negative", () => {
    const mintedAt = 500;
    expect(joinCodeRemainingMs(mintedAt, mintedAt, 1_000)).toBe(1_000);
    expect(joinCodeRemainingMs(mintedAt, mintedAt + 400, 1_000)).toBe(600);
    expect(joinCodeRemainingMs(mintedAt, mintedAt + 5_000, 1_000)).toBe(0);
  });
});
