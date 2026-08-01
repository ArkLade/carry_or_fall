/**
 * Per-connection abuse guard for inbound messages (M4.5, technical plan §33).
 *
 * The protocol validators (`@carry-or-fall/protocol`) decide whether a payload
 * is *well-formed*. This decides whether a well-formed payload is *acceptable
 * right now*, which needs per-connection history the validators deliberately do
 * not have: how many messages this client has sent in the last second, whether
 * this input's sequence is newer than the last one it sent, and how much invalid
 * traffic it has produced.
 *
 * Nothing here can be bypassed by sending faster, because the outcome of hitting
 * a limit is always "drop the message" and never "apply part of it".
 */

/**
 * Technical plan §9.1 caps client input at 20 messages per second. The limit
 * enforced here is deliberately above that: a client that legitimately sends 20
 * per second will, with any jitter at all, occasionally land 21 or 22 inside a
 * one-second window, and disconnecting an honest player for scheduler noise
 * would be a worse bug than tolerating a little slack. What this stops is the
 * flood — hundreds per second, the shape an attacker uses to try to buy extra
 * simulation steps or extra attacks.
 */
export const MAX_MESSAGES_PER_SECOND = 40;

const RATE_WINDOW_MS = 1000;

/**
 * How many invalid messages a client may accumulate before the room closes its
 * connection (§33: "temporary disconnect after repeated invalid behavior"). Set
 * well above zero so a single malformed message from a buggy build is not a
 * disconnect, and low enough that sustained probing ends quickly.
 */
export const MAX_INVALID_MESSAGES = 20;

export type GuardDecision =
  { readonly accepted: true } | { readonly accepted: false; readonly reason: GuardRejectionReason };

export type GuardRejectionReason =
  "invalid_payload" | "rate_limited" | "stale_sequence" | "not_accepting_input";

/**
 * Tracks one connection's message history. One instance per client; discarded
 * when that client leaves, so nothing accumulates across sessions.
 */
export class InputGuard {
  private windowStartedAt = 0;
  private messagesInWindow = 0;
  private lastSequence = -1;
  private invalidCount = 0;

  /**
   * Count one message against the rate limit. `now` is injected rather than read
   * from the clock so tests drive time explicitly instead of sleeping.
   */
  private withinRateLimit(now: number): boolean {
    if (now - this.windowStartedAt >= RATE_WINDOW_MS) {
      this.windowStartedAt = now;
      this.messagesInWindow = 0;
    }
    this.messagesInWindow += 1;
    return this.messagesInWindow <= MAX_MESSAGES_PER_SECOND;
  }

  /** Record an invalid message and report whether this client has now earned a disconnect. */
  recordInvalid(): boolean {
    this.invalidCount += 1;
    return this.invalidCount >= MAX_INVALID_MESSAGES;
  }

  /** How many invalid messages this connection has sent. */
  get invalidMessages(): number {
    return this.invalidCount;
  }

  /**
   * Decide whether a validated input message may be applied.
   *
   * `acceptingInput` is the room's own answer to "is this player allowed to act
   * at all right now" — the match is running, and this player is alive and has
   * not extracted. A message that arrives outside that window is dropped rather
   * than queued, because an input from a dead player is not a delayed
   * instruction, it is a stale one.
   *
   * A sequence that does not strictly increase is dropped, which makes a
   * replayed or reordered packet inert (technical plan §10.2).
   */
  acceptInput(sequence: number, acceptingInput: boolean, now: number): GuardDecision {
    if (!this.withinRateLimit(now)) {
      return { accepted: false, reason: "rate_limited" };
    }
    if (!acceptingInput) {
      return { accepted: false, reason: "not_accepting_input" };
    }
    if (sequence <= this.lastSequence) {
      return { accepted: false, reason: "stale_sequence" };
    }
    this.lastSequence = sequence;
    return { accepted: true };
  }

  /**
   * Decide whether a one-shot command (secure/discard) may be applied. Same rate
   * limit and same state gate as input; no sequence, because these are edge
   * triggered rather than a continuous stream.
   */
  acceptCommand(acceptingInput: boolean, now: number): GuardDecision {
    if (!this.withinRateLimit(now)) {
      return { accepted: false, reason: "rate_limited" };
    }
    if (!acceptingInput) {
      return { accepted: false, reason: "not_accepting_input" };
    }
    return { accepted: true };
  }
}
