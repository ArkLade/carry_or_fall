/**
 * One-shot combat event data (technical plan §10.4, §13.1's final pipeline
 * stage "emit visual event"). Plain data, not networked, and never stored as
 * persistent world state (`docs/PROTOCOL.md` §8) — a caller (a test, or the
 * client renderer) reacts to a `HitEvent` for one frame and then discards it.
 *
 * Only "hit" exists this chunk; "death" is added when M1.10 lands.
 */
import type { Vec2 } from "../vec2";

export interface HitEvent {
  /**
   * The player whose attack landed this hit (M4). With two to eight players
   * attacking the same enemies in one world, "who hit it" is no longer implied
   * by there being only one candidate — and shield-on-hit (M3.5) has to reward
   * the player who actually landed the hit.
   */
  readonly ownerId: string;
  readonly targetId: string;
  readonly damage: number;
  readonly position: Vec2;
}
