/**
 * Shared harness for the M6 party suites (`docs/M6_ISSUES.md` §11).
 *
 * Every helper here drives a **real** server over a **real** socket with the
 * real `@colyseus/sdk`, because the properties under test — a party landing in
 * one room, a seat nobody else can take, an inventory another account cannot
 * reach — are properties of the wire, not of a function.
 */
import { CONTENT_VERSION } from "@carry-or-fall/game-content";
import {
  MATCH_ROOM,
  type MatchRoomState,
  PARTY_ROOM,
  type PartyRoomState,
  PROTOCOL_VERSION,
  type SeatReservationPayload,
} from "@carry-or-fall/protocol";
import { Client, type Room } from "@colyseus/sdk";

import type { Logger } from "../src/logger";

export const BUILD_VERSION = "0.0.0-test";

export const silentLogger: Logger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
};

/** Join options every test starts from; individual cases vary one field. */
export function matchJoinOptions(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    protocolVersion: PROTOCOL_VERSION,
    contentVersion: CONTENT_VERSION,
    buildVersion: BUILD_VERSION,
    skillLoadoutIds: [],
    accessToken: null,
    ...overrides,
  };
}

/** Party join options. `joinCode: null` creates; a code joins. */
export function partyJoinOptions(
  joinCode: string | null,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return matchJoinOptions({ joinCode, ...overrides });
}

/**
 * Turn off the SDK's automatic reconnection for one room
 * (`docs/DECISIONS.md` D54, D64).
 *
 * The SDK re-enables reconnection on its own timers once a room has been up for
 * five seconds, with fifteen retries and exponential back-off. D54 recorded that
 * our tests escaped it only because rooms were short-lived — party rooms are
 * not, so a test that drops a client and then asserts it stayed dropped would
 * otherwise be racing a reconnect it never asked for.
 *
 * Called by every helper below rather than left to each test to remember, which
 * is the difference between a policy and a convention.
 */
export function withoutAutoReconnect<T extends { reconnection: { enabled: boolean } }>(room: T): T {
  room.reconnection.enabled = false;
  return room;
}

export async function waitFor(
  predicate: () => boolean | Promise<boolean>,
  timeoutMs = 20_000,
  what = "condition",
): Promise<void> {
  const start = Date.now();
  for (;;) {
    if (await predicate()) {
      return;
    }
    if (Date.now() - start > timeoutMs) {
      throw new Error(`waitFor: ${what} not satisfied within ${String(timeoutMs)}ms`);
    }
    await new Promise<void>((resolve) => setTimeout(resolve, 20));
  }
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** One connected party member: their party room, and the client that owns it. */
export interface PartyClient {
  readonly client: Client;
  readonly room: Room<unknown, PartyRoomState>;
  /** Seat reservations this member has been handed, newest last. */
  readonly seats: SeatReservationPayload[];
  /** Party errors this member has been sent, newest last. */
  readonly errors: { code: string; message: string }[];
}

/** Create a party, returning the leader's connection once its state has arrived. */
export async function createParty(
  wsBaseUrl: string,
  overrides: Record<string, unknown> = {},
): Promise<PartyClient> {
  const client = new Client(wsBaseUrl);
  const room = withoutAutoReconnect(
    await client.create<PartyRoomState>(PARTY_ROOM, partyJoinOptions(null, overrides)),
  );
  const party = attach(client, room);
  await waitFor(() => room.state.joinCode !== undefined && room.state.joinCode.length > 0);
  return party;
}

/** Join an existing party by code. */
export async function joinParty(
  wsBaseUrl: string,
  joinCode: string,
  overrides: Record<string, unknown> = {},
): Promise<PartyClient> {
  const client = new Client(wsBaseUrl);
  const room = withoutAutoReconnect(
    await client.join<PartyRoomState>(PARTY_ROOM, partyJoinOptions(joinCode, overrides)),
  );
  const party = attach(client, room);
  await waitFor(() => room.state.members !== undefined);
  return party;
}

function attach(client: Client, room: Room<unknown, PartyRoomState>): PartyClient {
  const seats: SeatReservationPayload[] = [];
  const errors: { code: string; message: string }[] = [];
  room.onMessage("match_ready", (message: { seatReservation: SeatReservationPayload }) => {
    seats.push(message.seatReservation);
  });
  room.onMessage("party_error", (message: { code: string; message: string }) => {
    errors.push(message);
  });
  return { client, room, seats, errors };
}

/** Consume a seat reservation into a live match room, as the browser client does. */
export async function consumeSeat(
  party: PartyClient,
  seat: SeatReservationPayload,
): Promise<Room<unknown, MatchRoomState>> {
  const room = await party.client.consumeSeatReservation<MatchRoomState>(seat);
  return withoutAutoReconnect(room as Room<unknown, MatchRoomState>);
}

/**
 * Leave a room without letting cleanup hang the suite.
 *
 * `Room#leave` resolves when the socket closes, and a room a test already left
 * (or that the server disposed) never closes again — so a tidy-up loop that
 * awaits it bare turns "the test passed" into "the hook timed out after sixty
 * seconds", which is exactly what happened while writing these.
 */
export async function leaveQuietly(room: { leave: (consented?: boolean) => Promise<number> }) {
  await Promise.race([
    room.leave(true).catch(() => undefined),
    new Promise<void>((resolve) => setTimeout(resolve, 500)),
  ]);
}

/** A solo player joining a match the ordinary way, for filling rooms in tests. */
export async function joinMatchSolo(
  wsBaseUrl: string,
  overrides: Record<string, unknown> = {},
): Promise<Room<unknown, MatchRoomState>> {
  const client = new Client(wsBaseUrl);
  const room = await client.joinOrCreate<MatchRoomState>(MATCH_ROOM, matchJoinOptions(overrides));
  await waitFor(() => (room.state as Partial<MatchRoomState>).players !== undefined);
  return withoutAutoReconnect(room as Room<unknown, MatchRoomState>);
}
