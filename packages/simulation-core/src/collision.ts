/**
 * Collision geometry and broad-phase for M1.5 (`docs/M1_EXECUTION_PLAN.md` §2.3,
 * §6.9). Actors are circles, walls are axis-aligned bounding boxes, and no
 * pixel-perfect collision is used (technical plan §12.1). Broad-phase uses a
 * simple uniform spatial grid so movement resolution does not compare the
 * player against every wall on the map (technical plan §12.3); a more complex
 * structure is added only with benchmarking, and none is needed for M1's small
 * test map.
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
 * Resolve movement along one axis against the walls in `grid`: if moving by
 * `delta` on `axis` would overlap any candidate wall, the axis stays at its
 * current value (blocked); otherwise the moved value is returned. Resolving
 * the two axes independently (see `simulation.ts`) is what lets the player
 * slide along a wall instead of stopping dead on a diagonal approach.
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
  const candidateCircle: Circle = { position: candidatePosition, radius };
  const candidates = grid.query(circleBounds(candidateCircle));

  for (const wall of candidates) {
    if (circleIntersectsWall(candidateCircle, wall)) {
      return current;
    }
  }

  return axis === "x" ? candidatePosition.x : candidatePosition.y;
}
