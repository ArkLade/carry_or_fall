/**
 * Collision geometry and broad-phase for M1.5 (`docs/M1_EXECUTION_PLAN.md` §2.3,
 * §6.9). Actors are circles, walls are axis-aligned bounding boxes, and no
 * pixel-perfect collision is used (technical plan §12.1). Broad-phase uses a
 * simple uniform spatial grid so movement resolution does not compare the
 * player against every wall on the map (technical plan §12.3); a more complex
 * structure is added only with benchmarking, and none is needed for M1's small
 * test map.
 *
 * Movement resolution is **swept**, not discrete: `resolveAxisMovement` (and
 * `combat/ranged.ts`'s projectile stepping) checks the whole path a circle
 * travels this step, not just its landing position. This fixes
 * `docs/M1_ISSUES.md` D-1 (projectiles passing through walls) and D-2 (a
 * large dash tunneling through a thin wall) from one shared root cause and
 * one shared fix — see {@link sweptCircleIntersectsWall}.
 */
import type { Vec2, Wall } from "./world";

/** A circular collision body: a position (center) and a radius. */
export interface Circle {
  readonly position: Vec2;
  readonly radius: number;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/** The closest point on `wall`'s boundary (or interior) to `point`. */
export function closestPointOnWall(wall: Wall, point: Vec2): Vec2 {
  return {
    x: clamp(point.x, wall.x, wall.x + wall.width),
    y: clamp(point.y, wall.y, wall.y + wall.height),
  };
}

/** Whether `circle` overlaps `wall` (circle vs. axis-aligned rectangle). */
export function circleIntersectsWall(circle: Circle, wall: Wall): boolean {
  const closest = closestPointOnWall(wall, circle.position);
  const dx = circle.position.x - closest.x;
  const dy = circle.position.y - closest.y;
  return dx * dx + dy * dy < circle.radius * circle.radius;
}

/** Whether two circles overlap. Used for projectile-vs-target hit detection (M1.8). */
export function circleIntersectsCircle(a: Circle, b: Circle): boolean {
  const dx = a.position.x - b.position.x;
  const dy = a.position.y - b.position.y;
  const radiusSum = a.radius + b.radius;
  return dx * dx + dy * dy < radiusSum * radiusSum;
}

/**
 * Whether the line segment from `start` to `end` intersects axis-aligned box
 * `box`. Standard slab (Liang-Barsky) clipping: the segment is parameterized
 * as `start + t * (end - start)` for `t` in `[0, 1]`, clipped against each
 * axis's slab. A zero-length segment (`start === end`) correctly degrades to
 * a point-in-box test.
 */
function segmentIntersectsAabb(start: Vec2, end: Vec2, box: Wall): boolean {
  let tMin = 0;
  let tMax = 1;
  const dx = end.x - start.x;
  const dy = end.y - start.y;

  if (dx === 0) {
    if (start.x < box.x || start.x > box.x + box.width) {
      return false;
    }
  } else {
    const tx1 = (box.x - start.x) / dx;
    const tx2 = (box.x + box.width - start.x) / dx;
    tMin = Math.max(tMin, Math.min(tx1, tx2));
    tMax = Math.min(tMax, Math.max(tx1, tx2));
    if (tMin > tMax) {
      return false;
    }
  }

  if (dy === 0) {
    if (start.y < box.y || start.y > box.y + box.height) {
      return false;
    }
  } else {
    const ty1 = (box.y - start.y) / dy;
    const ty2 = (box.y + box.height - start.y) / dy;
    tMin = Math.max(tMin, Math.min(ty1, ty2));
    tMax = Math.min(tMax, Math.max(ty1, ty2));
    if (tMin > tMax) {
      return false;
    }
  }

  return true;
}

/**
 * The squared distance from `point` to the closest point on segment
 * `start`-`end`. A zero-length segment correctly degrades to point-to-point
 * squared distance. Squared (not rooted) since every caller only compares it
 * against a squared radius.
 */
function squaredDistanceToSegment(start: Vec2, end: Vec2, point: Vec2): number {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const lengthSquared = dx * dx + dy * dy;

  let t = 0;
  if (lengthSquared > 0) {
    t = ((point.x - start.x) * dx + (point.y - start.y) * dy) / lengthSquared;
    t = Math.min(1, Math.max(0, t));
  }

  const closestX = start.x + t * dx;
  const closestY = start.y + t * dy;
  const offsetX = point.x - closestX;
  const offsetY = point.y - closestY;
  return offsetX * offsetX + offsetY * offsetY;
}

/**
 * Whether a circle of `radius` sweeping from `start` to `end` ever overlaps
 * `wall`, at any point along that path — not just at `end` (the previous,
 * discrete-only check). This is the exact Minkowski-sum decomposition of "a
 * circle vs. a rectangle" into three swept sub-shapes, which together cover
 * the wall's rounded-rectangle "expansion" by `radius` with no gaps and no
 * over-coverage:
 *
 * 1. The wall expanded by `radius` on the left/right (catches the segment
 *    crossing the wall's vertical sides).
 * 2. The wall expanded by `radius` on the top/bottom (catches the segment
 *    crossing the horizontal sides).
 * 3. A `radius`-distance check against each of the wall's four corners
 *    (catches the segment passing near a corner, where the closest point on
 *    the wall is that corner rather than an edge).
 *
 * When `start === end`, this reduces exactly to the discrete
 * {@link circleIntersectsWall} test.
 */
export function sweptCircleIntersectsWall(
  start: Vec2,
  end: Vec2,
  radius: number,
  wall: Wall,
): boolean {
  const expandedHorizontally: Wall = {
    x: wall.x - radius,
    y: wall.y,
    width: wall.width + radius * 2,
    height: wall.height,
  };
  if (segmentIntersectsAabb(start, end, expandedHorizontally)) {
    return true;
  }

  const expandedVertically: Wall = {
    x: wall.x,
    y: wall.y - radius,
    width: wall.width,
    height: wall.height + radius * 2,
  };
  if (segmentIntersectsAabb(start, end, expandedVertically)) {
    return true;
  }

  const radiusSquared = radius * radius;
  const corners: readonly Vec2[] = [
    { x: wall.x, y: wall.y },
    { x: wall.x + wall.width, y: wall.y },
    { x: wall.x, y: wall.y + wall.height },
    { x: wall.x + wall.width, y: wall.y + wall.height },
  ];
  return corners.some((corner) => squaredDistanceToSegment(start, end, corner) < radiusSquared);
}

/** The axis-aligned bounding box of a circle, for spatial-grid queries. */
export function circleBounds(circle: Circle): Wall {
  return {
    x: circle.position.x - circle.radius,
    y: circle.position.y - circle.radius,
    width: circle.radius * 2,
    height: circle.radius * 2,
  };
}

/**
 * The axis-aligned bounding box of a circle of `radius` sweeping from
 * `start` to `end` — the union of both endpoints' circle bounds. Used to
 * query the spatial grid for a swept check so a wall the segment merely
 * passes through (not just one under the landing position) is still found.
 */
export function sweptCircleBounds(start: Vec2, end: Vec2, radius: number): Wall {
  const minX = Math.min(start.x, end.x) - radius;
  const minY = Math.min(start.y, end.y) - radius;
  const maxX = Math.max(start.x, end.x) + radius;
  const maxY = Math.max(start.y, end.y) + radius;
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

/**
 * Uniform-grid broad-phase index. Items are inserted once under every cell
 * their bounds overlap; a query returns the deduplicated candidates in the
 * cells overlapping the query bounds — a broad phase only, so callers must
 * still run a narrow-phase test (e.g. {@link circleIntersectsWall}) on the
 * results (technical plan §12.3).
 */
export class SpatialGrid<T> {
  private readonly cellSize: number;
  private readonly cells = new Map<string, T[]>();

  constructor(cellSize: number) {
    if (!Number.isFinite(cellSize) || cellSize <= 0) {
      throw new RangeError("cellSize must be a positive finite number");
    }
    this.cellSize = cellSize;
  }

  insert(item: T, bounds: Wall): void {
    for (const key of this.cellKeysForBounds(bounds)) {
      const existing = this.cells.get(key);
      if (existing === undefined) {
        this.cells.set(key, [item]);
      } else {
        existing.push(item);
      }
    }
  }

  query(bounds: Wall): T[] {
    const seen = new Set<T>();
    for (const key of this.cellKeysForBounds(bounds)) {
      const items = this.cells.get(key);
      if (items === undefined) {
        continue;
      }
      for (const item of items) {
        seen.add(item);
      }
    }
    return [...seen];
  }

  private cellKeysForBounds(bounds: Wall): string[] {
    const minCellX = Math.floor(bounds.x / this.cellSize);
    const minCellY = Math.floor(bounds.y / this.cellSize);
    const maxCellX = Math.floor((bounds.x + bounds.width) / this.cellSize);
    const maxCellY = Math.floor((bounds.y + bounds.height) / this.cellSize);

    const keys: string[] = [];
    for (let cellX = minCellX; cellX <= maxCellX; cellX += 1) {
      for (let cellY = minCellY; cellY <= maxCellY; cellY += 1) {
        keys.push(`${String(cellX)},${String(cellY)}`);
      }
    }
    return keys;
  }
}

/** Default grid cell size (pixels): a few player diameters, tuned for M1's small test map. */
export const WALL_GRID_CELL_SIZE = 128;

/** Build a spatial grid over `walls`, ready for collision queries. */
export function buildWallGrid(
  walls: readonly Wall[],
  cellSize: number = WALL_GRID_CELL_SIZE,
): SpatialGrid<Wall> {
  const grid = new SpatialGrid<Wall>(cellSize);
  for (const wall of walls) {
    grid.insert(wall, wall);
  }
  return grid;
}

/**
 * Resolve movement along one axis against the walls in `grid`: if the swept
 * path from the current position to `delta` away on `axis` overlaps any
 * candidate wall **at any point along it** (not just at the landing
 * position — `docs/M1_ISSUES.md` D-2), the axis stays at its current value
 * (blocked); otherwise the moved value is returned. Resolving the two axes
 * independently (see `simulation.ts`) is what lets the player slide along a
 * wall instead of stopping dead on a diagonal approach.
 */
export function resolveAxisMovement(
  position: Vec2,
  axis: "x" | "y",
  delta: number,
  radius: number,
  grid: SpatialGrid<Wall>,
): number {
  const current = axis === "x" ? position.x : position.y;
  if (delta === 0) {
    return current;
  }

  const candidatePosition: Vec2 =
    axis === "x"
      ? { x: position.x + delta, y: position.y }
      : { x: position.x, y: position.y + delta };
  const candidates = grid.query(sweptCircleBounds(position, candidatePosition, radius));

  for (const wall of candidates) {
    if (sweptCircleIntersectsWall(position, candidatePosition, radius, wall)) {
      return current;
    }
  }

  return axis === "x" ? candidatePosition.x : candidatePosition.y;
}
