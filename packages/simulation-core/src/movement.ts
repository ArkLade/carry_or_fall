/**
 * Deterministic top-down movement (M1.3, `docs/M1_EXECUTION_PLAN.md` §2.2, §6.1).
 * Movement is computed here, in shared simulation code, from normalized input —
 * never in the renderer (technical plan §5.1) — and only ever advances by the
 * fixed simulation step, never a render-frame delta (technical plan §9.3).
 */
import type { InputState, Vec2 } from "./world";

/**
 * Player movement speed cap, in pixels per simulated second. Proposed for M1
 * (not specified numerically in the concept or technical plan); exact feel is
 * balance-deferred to playtesting, matching how weapon numbers are treated
 * (`docs/M1_EXECUTION_PLAN.md` §4).
 */
export const PLAYER_SPEED = 220;

/**
 * The displacement a player travels in `dtSeconds` given the current movement
 * intent, capped at {@link PLAYER_SPEED}. Diagonal input is normalized so moving
 * on both axes at once never exceeds the same cap as a single-axis move
 * (`docs/M1_EXECUTION_PLAN.md` §6.1, §8).
 */
export function computeMovementDelta(input: InputState, dtSeconds: number): Vec2 {
  const { moveX, moveY } = input;

  if (moveX === 0 && moveY === 0) {
    return { x: 0, y: 0 };
  }

  const length = Math.hypot(moveX, moveY);
  const speed = PLAYER_SPEED * dtSeconds;

  return {
    x: (moveX / length) * speed,
    y: (moveY / length) * speed,
  };
}
