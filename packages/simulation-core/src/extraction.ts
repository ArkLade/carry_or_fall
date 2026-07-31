/**
 * Rotating extraction (M2.7, concept §17, `docs/M2_ISSUES.md` M2.7). Two
 * active extraction points at a time; each stays active for a bounded
 * duration, then relocates ("rotates") to a new candidate location. A player
 * channels extraction by holding interact while standing in one's radius;
 * taking damage or leaving the radius interrupts the channel (handled by the
 * caller, `simulation.ts`, which already computes contact damage).
 *
 * Values are proposed and balance-deferred, within concept §17.1's suggested
 * ranges (two points; 45-90s active; 4-6s channel).
 */
import { circleIntersectsCircle } from "./collision";
import { pickDistinct, type Rng } from "./prng";
import type { ExtractionPoint, Vec2 } from "./world";

/** Concept §17.1: "two active extraction points". */
export const ACTIVE_EXTRACTION_POINT_COUNT = 2;
/** Proposed pickup/channel radius, in pixels. */
export const EXTRACTION_POINT_RADIUS_PX = 40;
/**
 * Within concept §17.1's suggested 45-90s active duration. Raised 60s -> 75s
 * for M4 prep, when the local map doubled in both dimensions (4x area) and
 * enemy health went up 5x: a point now has to stay open long enough to still
 * be reachable after a real fight, since worst-case corner-to-corner
 * traversal grew from roughly 5s to roughly 15s and a three-enemy fight can
 * run 25-40s. Still balance-deferred, and still inside the concept's band.
 */
export const EXTRACTION_POINT_ACTIVE_MS = 75_000;
/** Within concept §17.1's suggested 4-6s channel. */
export const EXTRACTION_CHANNEL_MS = 5_000;

/**
 * Choose the initial set of active extraction points from `candidates`, via
 * the seeded RNG (technical plan §9.4), matching M1.9's enemy spawn-point
 * pattern. Throws if there are fewer candidates than points to place — a
 * caller/content error, not a runtime condition.
 */
export function spawnExtractionPoints(
  candidates: readonly Vec2[],
  rng: Rng,
  count: number = ACTIVE_EXTRACTION_POINT_COUNT,
): ExtractionPoint[] {
  if (candidates.length < count) {
    throw new RangeError("spawnExtractionPoints requires at least `count` candidate points");
  }
  return pickDistinct(candidates, count, rng).map((position, index) => ({
    id: `extraction-${String(index)}`,
    position,
    radius: EXTRACTION_POINT_RADIUS_PX,
    remainingActiveMs: EXTRACTION_POINT_ACTIVE_MS,
  }));
}

/**
 * Advance every extraction point by one fixed step: count down
 * `remainingActiveMs`; a point that reaches zero relocates to a new candidate
 * position (preferring one other than its own current position, so it
 * visibly "reopens elsewhere") and its timer resets. A point mid-channel that
 * relocates is not special-cased here: the player is no longer within the
 * new position's radius next step, which the ordinary proximity check in
 * `simulation.ts` already resets on its own.
 */
export function stepExtractionPoints(
  points: readonly ExtractionPoint[],
  dtMs: number,
  candidates: readonly Vec2[],
  rng: Rng,
): ExtractionPoint[] {
  return points.map((point) => {
    const remainingActiveMs = point.remainingActiveMs - dtMs;
    if (remainingActiveMs > 0) {
      return { ...point, remainingActiveMs };
    }
    const elsewhere = candidates.filter(
      (candidate) => candidate.x !== point.position.x || candidate.y !== point.position.y,
    );
    const pool = elsewhere.length > 0 ? elsewhere : candidates;
    const position = pool[rng.nextInt(pool.length)]!;
    return { ...point, position, remainingActiveMs: EXTRACTION_POINT_ACTIVE_MS };
  });
}

/** Whether `actor` (the player) currently overlaps `point`'s radius. */
export function isWithinExtractionPoint(
  actor: { readonly position: Vec2; readonly radius: number },
  point: ExtractionPoint,
): boolean {
  return circleIntersectsCircle(
    { position: actor.position, radius: actor.radius },
    { position: point.position, radius: point.radius },
  );
}

/** The first active extraction point `actor` currently overlaps, or `null` if none. */
export function findActiveExtractionPoint(
  actor: { readonly position: Vec2; readonly radius: number },
  points: readonly ExtractionPoint[],
): ExtractionPoint | null {
  return points.find((point) => isWithinExtractionPoint(actor, point)) ?? null;
}
