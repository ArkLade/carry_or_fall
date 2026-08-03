/**
 * Synchronized state for the party room (M6.3, `docs/M6_ISSUES.md` §4).
 *
 * **Look at what is not here.** A member is a session id, a display name, a
 * leader flag, and a connection light. There is no access token, no account id,
 * no point balance, no unlock list, no loadout, and no inventory — because
 * being in someone's party is not a licence to read their account
 * (`docs/M6_ISSUES.md` §1.6), and the way this codebase enforces that is by
 * never putting the data in the document the party receives. There is no
 * filtering rule here to misconfigure, exactly as in `MatchState.ts`.
 *
 * `joinCode` *is* here, and only party members ever see this state, which is
 * the point: it is their code. It is deliberately absent from every log line
 * and every error message (`docs/DECISIONS.md` D56).
 *
 * Uses the decorator-free `schema()` form from `@colyseus/schema` v4, matching
 * `MatchState` and `FoundationState`.
 */
import { schema, type SchemaType } from "@colyseus/schema";

export const PartyMemberState = schema({
  /** This member's party-room session id — not their account id, and not their match session id. */
  sessionId: "string",
  /** Server-generated from the verified identity (technical plan §17.1). */
  displayName: "string",
  isLeader: "boolean",
  /** False while the member is disconnected but still inside their reconnect window. */
  connected: "boolean",
});
export type PartyMemberStateType = SchemaType<typeof PartyMemberState>;

export const PartyState = schema({
  joinCode: "string",
  leaderSessionId: "string",
  /** One of `PartyStatus`: "forming", "queued", "in_match". */
  status: "string",
  /** Milliseconds until the current code stops admitting members; 0 once expired. */
  joinCodeExpiresInMs: "number",
  members: { map: PartyMemberState },
});
export type PartyStateType = SchemaType<typeof PartyState>;
