/**
 * Basic dash (M1.S1, concept §8.4 "every player begins with a basic dash",
 * §13.1 binds it to `space`). Promoted into M1 scope per this task's explicit
 * instruction (`docs/M1_EXECUTION_PLAN.md` §12 allows promoting M1.S1 into
 * M1). A cooldown-gated instant displacement, resolved through the same
 * wall-aware movement as ordinary movement (`resolveAxisMovement`) so a dash
 * is blocked/slides exactly like a normal move, just further.
 */
import type { InputState, Vec2 } from "./world";

/**
 * Dash distance, in pixels. Proposed and balance-deferred: neither
 * authoritative document gives a numeric value for the dash (concept §8.4
 * only requires that one exists).
 */
export const DASH_DISTANCE_PX = 140;

/** Dash cooldown, in milliseconds. Proposed and balance-deferred, same as {@link DASH_DISTANCE_PX}. */
export const DASH_COOLDOWN_MS = 2000;

/**
 * The dash displacement for one dash: in the current movement-input
 * direction if any is held, otherwise in the direction the player is facing
 * (aiming). Purely deterministic arithmetic — no randomness is involved.
 */
export function computeDashDelta(input: Pick<InputState, "moveX" | "moveY">, facing: number): Vec2 {
  const { moveX, moveY } = input;
  if (moveX !== 0 || moveY !== 0) {
    const length = Math.hypot(moveX, moveY);
    return { x: (moveX / length) * DASH_DISTANCE_PX, y: (moveY / length) * DASH_DISTANCE_PX };
  }
  return { x: Math.cos(facing) * DASH_DISTANCE_PX, y: Math.sin(facing) * DASH_DISTANCE_PX };
}
