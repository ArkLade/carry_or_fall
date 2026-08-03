/**
 * The match queue (M6.4, `docs/M6_ISSUES.md` §5).
 *
 * This is technical plan §8.3's "short queue": a party asks for seats, the
 * server finds a room that can hold all of them or makes one, and the party is
 * handed its seats. It resolves immediately, because rooms are created on
 * demand — there is no population to wait for, and a queue that made a party of
 * three wait for a fourth stranger would be inventing a matchmaking policy
 * neither authoritative document describes.
 *
 * ## Why this is a queue at all
 *
 * Because concurrency is the whole problem. Two parties queueing at the same
 * instant must not both be told "the room with five free seats is yours". Every
 * request therefore runs through one promise chain, one at a time, in arrival
 * order. That is a real FIFO queue with a real job, not a name given to a
 * function call.
 *
 * ## Why this module is the one D8 pins
 *
 * `MatchRoom#reserveGroupSeats` is atomic because the capacity check and the
 * seat write happen in one synchronous run, in one process
 * (`docs/DECISIONS.md` D8, D55). This module is the caller that depends on that
 * — `matchMaker.getLocalRoomById` returns a room instance only when the room
 * lives in *this* process, and every room does, by D8.
 *
 * **A second server process would break this module and only this module.** The
 * rewrite is known: seat allocation would have to move behind Colyseus presence
 * so the check-and-write is atomic across processes, which is the coordination
 * D8 defers. Nothing else in the party subsystem would change. That is the cost
 * of the design, stated where whoever lifts D8 will find it.
 */
import { MATCH_ROOM, type MatchJoinOptions } from "@carry-or-fall/protocol";
import { generateId, type IRoomCache, matchMaker, Room } from "@colyseus/core";

import type { Logger } from "../logger";
import { asGroupSeatHost, type GroupSeatMember } from "../rooms/MatchRoom";

/** One party member's ticket into the allocation: their own, already-validated join options. */
export interface QueueMember {
  readonly options: MatchJoinOptions;
}

export interface GroupQueueRequest {
  /** Opaque, server-generated, and meaningful only inside the match room. */
  readonly partyId: string;
  readonly members: readonly QueueMember[];
}

export type GroupQueueResult =
  | {
      readonly ok: true;
      readonly roomId: string;
      /** One reservation per requested member, in the order they were requested. */
      readonly reservations: readonly matchMaker.ISeatReservation[];
    }
  | { readonly ok: false; readonly reason: "no_room_available" };

export interface MatchQueueDeps {
  readonly logger: Logger;
}

export class MatchQueue {
  /**
   * The chain every allocation is appended to. Requests therefore never
   * interleave, which is what makes "two parties queue at once" a deterministic
   * outcome rather than a coin toss.
   */
  private tail: Promise<unknown> = Promise.resolve();

  constructor(private readonly deps: MatchQueueDeps) {}

  enqueue(request: GroupQueueRequest): Promise<GroupQueueResult> {
    const next = this.tail.then(
      () => this.allocate(request),
      () => this.allocate(request),
    );
    // The chain must survive a rejected allocation, or one failure would poison
    // every party that queues afterwards.
    this.tail = next.catch(() => undefined);
    return next;
  }

  private async allocate(request: GroupQueueRequest): Promise<GroupQueueResult> {
    const members: GroupSeatMember[] = request.members.map((member) => ({
      // Server-generated: this is the id the member will hold in the match, and
      // an id a client could choose is an id it could choose to be somebody
      // else's (technical plan §33).
      sessionId: generateId(),
      options: member.options,
    }));

    const candidates = await matchMaker.query<Room>({ name: MATCH_ROOM, locked: false });
    // Fullest first, so parties fill existing lobbies rather than scattering
    // one-party rooms across the process. A room that cannot hold the whole
    // party is skipped by `reserveGroupSeats`, never partially filled.
    candidates.sort((left, right) => right.clients - left.clients);

    for (const candidate of candidates) {
      const outcome = await this.tryRoom(candidate, request.partyId, members);
      if (outcome !== null) {
        return outcome;
      }
    }

    // Nothing fit. Making a room is the normal case for the first party of a
    // session, not a fallback.
    const created = await matchMaker.createRoom(MATCH_ROOM, {});
    const outcome = await this.tryRoom(created, request.partyId, members);
    if (outcome !== null) {
      return outcome;
    }

    this.deps.logger.error("could not seat a party in any room, including a fresh one", {
      partyId: request.partyId,
      members: members.length,
      candidates: candidates.length,
    });
    return { ok: false, reason: "no_room_available" };
  }

  /** Try one room. `null` means "not this one" — the caller moves on. */
  private async tryRoom(
    cache: IRoomCache,
    partyId: string,
    members: readonly GroupSeatMember[],
  ): Promise<GroupQueueResult | null> {
    const host = asGroupSeatHost(matchMaker.getLocalRoomById(cache.roomId));
    if (host === null) {
      // Not in this process, or not a match room. Under D8 the first cannot
      // happen; if it ever does, skipping is the safe reading.
      return null;
    }

    const outcome = await host.reserveGroupSeats(partyId, members, cache);
    if (!outcome.ok) {
      return null;
    }

    return {
      ok: true,
      roomId: cache.roomId,
      reservations: members.map((member) =>
        matchMaker.buildSeatReservation(cache, member.sessionId),
      ),
    };
  }
}
