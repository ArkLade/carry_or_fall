/**
 * Core world/entity types for the M1 slice of the simulation: movement and map
 * collision only. There is no combat, enemy, health, or death state yet — those
 * fields are added to `Player`/`World` by the milestone that implements each
 * system (`docs/M1_EXECUTION_PLAN.md` §3), not speculatively reserved here.
 *
 * M1 is local and single-player (no network, no other players), so `World`
 * holds exactly one `player`, not a collection.
 */

/** A 2D point or vector in world space (pixels). */
export interface Vec2 {
  readonly x: number;
  readonly y: number;
}

/**
 * The player's simulated body: a circle, per the collision strategy (technical
 * plan §12.1). Position is the circle's center.
 */
export interface Player {
  readonly position: Vec2;
  readonly radius: number;
}

/**
 * A static wall: an axis-aligned bounding box, per the collision strategy
 * (technical plan §12.1). `x`/`y` is the top-left corner.
 */
export interface Wall {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/**
 * Normalized movement intent consumed by the simulation this milestone. This is
 * intentionally a subset of `@carry-or-fall/protocol`'s `InputMessage` — only
 * the fields movement (M1.3) reads. `aimAngle`/`attackPressed`/`dashPressed`/
 * `interactPressed` are added here when the milestone that consumes them lands
 * (aim M1.4, attacks M1.6–M1.8, dash M1.S1), so no dead field is carried before
 * it has a reader.
 */
export interface InputState {
  readonly moveX: -1 | 0 | 1;
  readonly moveY: -1 | 0 | 1;
}

/**
 * The full simulation world for this milestone: the single local player and
 * the static map geometry. The renderer reads this; it never mutates it or
 * derives outcomes from it (technical plan §5.1).
 */
export interface World {
  readonly player: Player;
  readonly walls: readonly Wall[];
}
