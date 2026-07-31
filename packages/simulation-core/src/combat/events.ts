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
  readonly targetId: string;
  readonly damage: number;
  readonly position: Vec2;
}
