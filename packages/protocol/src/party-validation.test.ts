/**
 * The M6 network-boundary validators (`docs/M6_ISSUES.md` §2, §11).
 *
 * Kept in their own file rather than appended to `validation.test.ts` because
 * they are about a different boundary: three of the four run on the **client**,
 * on payloads the server sent, and the reason they exist is that the client
 * acts on them (it opens a socket to a room id it was handed, and renders an
 * error message verbatim).
 */
import { describe, expect, it } from "vitest";

import { PARTY_CODE_ALPHABET, PARTY_CODE_LENGTH } from "./party-code";
import {
  validatePartyCommandMessage,
  validatePartyErrorMessage,
  validatePartyJoinOptions,
  validateSeatReservationMessage,
} from "./validation";
import { PROTOCOL_VERSION } from "./version";

const CONTENT_VERSION = 1;
const MAX_SKILL_SLOTS = 3;

const handshake = {
  protocolVersion: PROTOCOL_VERSION,
  contentVersion: CONTENT_VERSION,
  buildVersion: "0.0.0-m6",
};

/** Letters, not digits, so the lowercase case below actually differs from it. */
const CODE = PARTY_CODE_ALPHABET.slice(-PARTY_CODE_LENGTH);

/** Legal party join options, spread into cases that vary exactly one field. */
const partyOptions = {
  ...handshake,
  joinCode: null,
  skillLoadoutIds: ["ricochet"],
  accessToken: null,
};

describe("validatePartyJoinOptions", () => {
  it("accepts a create request (no code) and a join request (a well-formed code)", () => {
    const created = validatePartyJoinOptions(partyOptions, MAX_SKILL_SLOTS);
    expect(created.ok && created.value.joinCode).toBeNull();

    const joined = validatePartyJoinOptions({ ...partyOptions, joinCode: CODE }, MAX_SKILL_SLOTS);
    expect(joined.ok && joined.value.joinCode).toBe(CODE);
  });

  it("refuses an omitted joinCode, which would otherwise match any party", () => {
    // Not pedantry: Colyseus builds its matchmaking filter from the properties
    // a client actually sent, so an absent `joinCode` is an empty filter — and
    // an empty filter matches a stranger's party room. Requiring the key means
    // the request is refused before matchmaking ever runs.
    const { joinCode: _omitted, ...withoutCode } = partyOptions;
    expect(validatePartyJoinOptions(withoutCode, MAX_SKILL_SLOTS).ok).toBe(false);
    expect(
      validatePartyJoinOptions({ ...withoutCode, joinCode: undefined }, MAX_SKILL_SLOTS).ok,
    ).toBe(false);
  });

  it("refuses a malformed code before it can become a matchmaking filter value", () => {
    for (const bad of ["", "abc", CODE.toLowerCase(), `${CODE}A`, "IIIIIIII", 12_345_678, ["A"]]) {
      expect(validatePartyJoinOptions({ ...partyOptions, joinCode: bad }, MAX_SKILL_SLOTS).ok).toBe(
        false,
      );
    }
  });

  it("refuses an incompatible or malformed handshake, exactly as the match room does", () => {
    expect(
      validatePartyJoinOptions({ ...partyOptions, buildVersion: "not-a-version" }, MAX_SKILL_SLOTS)
        .ok,
    ).toBe(false);
    const { contentVersion: _dropped, ...noContent } = partyOptions;
    expect(validatePartyJoinOptions(noContent, MAX_SKILL_SLOTS).ok).toBe(false);
  });

  it("bounds the skill loadout by the caller's slot budget", () => {
    expect(
      validatePartyJoinOptions(
        { ...partyOptions, skillLoadoutIds: ["a", "b", "c", "d"] },
        MAX_SKILL_SLOTS,
      ).ok,
    ).toBe(false);
    expect(
      validatePartyJoinOptions({ ...partyOptions, skillLoadoutIds: [""] }, MAX_SKILL_SLOTS).ok,
    ).toBe(false);
    expect(
      validatePartyJoinOptions({ ...partyOptions, skillLoadoutIds: "ricochet" }, MAX_SKILL_SLOTS)
        .ok,
    ).toBe(false);
  });

  it("bounds the access token, and accepts its absence as 'no session'", () => {
    expect(
      validatePartyJoinOptions({ ...partyOptions, accessToken: "x".repeat(4097) }, MAX_SKILL_SLOTS)
        .ok,
    ).toBe(false);
    expect(validatePartyJoinOptions({ ...partyOptions, accessToken: 42 }, MAX_SKILL_SLOTS).ok).toBe(
      false,
    );
    const absent = validatePartyJoinOptions(
      { ...partyOptions, accessToken: undefined },
      MAX_SKILL_SLOTS,
    );
    expect(absent.ok && absent.value.accessToken).toBeNull();
  });

  it("has no field capable of naming another player or asserting membership", () => {
    // Technical plan §5.1: party membership authorization is not the client's.
    // An attacker bolting these on gets them dropped, not honored.
    const result = validatePartyJoinOptions(
      { ...partyOptions, partyId: "someone-elses", leader: true, members: ["victim"] },
      MAX_SKILL_SLOTS,
    );
    expect(result.ok).toBe(true);
    expect(result.ok && Object.keys(result.value).sort()).toEqual([
      "accessToken",
      "buildVersion",
      "contentVersion",
      "joinCode",
      "protocolVersion",
      "skillLoadoutIds",
    ]);
  });
});

describe("validatePartyCommandMessage", () => {
  it("accepts an empty object and yields nothing a handler could read", () => {
    const result = validatePartyCommandMessage({});
    expect(result.ok && Object.keys(result.value)).toEqual([]);
  });

  it("drops any field a client attaches, so a command can never name a subject", () => {
    const result = validatePartyCommandMessage({ targetSessionId: "victim", kick: true });
    expect(result.ok && Object.keys(result.value)).toEqual([]);
  });

  it("refuses a body that is not an object", () => {
    for (const bad of [null, undefined, 1, "queue", [], true]) {
      expect(validatePartyCommandMessage(bad).ok).toBe(false);
    }
  });
});

describe("validateSeatReservationMessage", () => {
  const reservation = {
    name: "match_room",
    sessionId: "abcdefghi",
    roomId: "ROOMID123",
    processId: "p-1",
  };

  it("accepts a complete reservation, with and without a public address", () => {
    expect(validateSeatReservationMessage({ seatReservation: reservation }).ok).toBe(true);
    const withAddress = validateSeatReservationMessage({
      seatReservation: { ...reservation, publicAddress: "game.example.com:2567" },
    });
    expect(withAddress.ok && withAddress.value.publicAddress).toBe("game.example.com:2567");
  });

  it("refuses a reservation missing any field the client would then use", () => {
    for (const field of ["name", "sessionId", "roomId", "processId"] as const) {
      const { [field]: _dropped, ...incomplete } = reservation;
      expect(validateSeatReservationMessage({ seatReservation: incomplete }).ok).toBe(false);
    }
  });

  it("refuses an empty or absurdly long identifier", () => {
    // `roomId` becomes part of the URL the client opens a socket to.
    expect(
      validateSeatReservationMessage({ seatReservation: { ...reservation, roomId: "" } }).ok,
    ).toBe(false);
    expect(
      validateSeatReservationMessage({
        seatReservation: { ...reservation, roomId: "r".repeat(129) },
      }).ok,
    ).toBe(false);
  });

  it("refuses a non-string identifier rather than coercing it", () => {
    for (const bad of [42, null, ["ROOMID123"], { toString: "ROOMID123" }]) {
      expect(
        validateSeatReservationMessage({ seatReservation: { ...reservation, roomId: bad } }).ok,
      ).toBe(false);
    }
  });

  it("refuses a missing or non-object envelope", () => {
    for (const bad of [null, undefined, {}, { seatReservation: "match_room" }, []]) {
      expect(validateSeatReservationMessage(bad).ok).toBe(false);
    }
  });
});

describe("validatePartyErrorMessage", () => {
  it("accepts a known code with a short message", () => {
    const result = validatePartyErrorMessage({ code: "not_leader", message: "Only the leader." });
    expect(result.ok && result.value.code).toBe("not_leader");
  });

  it("refuses a code this build does not know, rather than rendering a blank panel", () => {
    expect(validatePartyErrorMessage({ code: "banned", message: "no" }).ok).toBe(false);
  });

  it("refuses an empty or over-long message, which is rendered verbatim", () => {
    expect(validatePartyErrorMessage({ code: "not_leader", message: "" }).ok).toBe(false);
    expect(validatePartyErrorMessage({ code: "not_leader", message: "x".repeat(201) }).ok).toBe(
      false,
    );
  });
});
