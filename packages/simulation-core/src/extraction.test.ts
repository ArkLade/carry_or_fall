import { describe, expect, it } from "vitest";

import {
  EXTRACTION_POINT_ACTIVE_MS,
  EXTRACTION_POINT_RADIUS_PX,
  findActiveExtractionPoint,
  isWithinExtractionPoint,
  spawnExtractionPoints,
  stepExtractionPoints,
} from "./extraction";
import { createRng } from "./prng";
import type { ExtractionPoint, Vec2 } from "./world";

const CANDIDATES: readonly Vec2[] = [
  { x: 0, y: 0 },
  { x: 100, y: 0 },
  { x: 200, y: 0 },
  { x: 300, y: 0 },
];

describe("spawnExtractionPoints", () => {
  it("chooses distinct positions deterministically from the seed", () => {
    const a = spawnExtractionPoints(CANDIDATES, createRng(42));
    const b = spawnExtractionPoints(CANDIDATES, createRng(42));
    expect(a).toEqual(b);
    expect(a).toHaveLength(2);
    expect(a[0]!.position).not.toEqual(a[1]!.position);
  });

  it("gives every point a full active duration and a stable, distinct id", () => {
    const points = spawnExtractionPoints(CANDIDATES, createRng(1));
    for (const point of points) {
      expect(point.remainingActiveMs).toBe(EXTRACTION_POINT_ACTIVE_MS);
      expect(point.radius).toBe(EXTRACTION_POINT_RADIUS_PX);
    }
    expect(new Set(points.map((p) => p.id)).size).toBe(points.length);
  });

  it("throws when there are fewer candidates than points to place", () => {
    expect(() => spawnExtractionPoints([{ x: 0, y: 0 }], createRng(1), 2)).toThrow(RangeError);
  });
});

describe("stepExtractionPoints", () => {
  function makePoint(overrides: Partial<ExtractionPoint> = {}): ExtractionPoint {
    return {
      id: "extraction-0",
      position: { x: 0, y: 0 },
      radius: EXTRACTION_POINT_RADIUS_PX,
      remainingActiveMs: EXTRACTION_POINT_ACTIVE_MS,
      ...overrides,
    };
  }

  it("does not relocate before its active duration elapses", () => {
    const point = makePoint({ remainingActiveMs: 5000 });
    const [next] = stepExtractionPoints([point], 1000, CANDIDATES, createRng(1));
    expect(next!.position).toEqual(point.position);
    expect(next!.remainingActiveMs).toBe(4000);
  });

  it("relocates to a different position and resets the timer once the duration elapses", () => {
    const point = makePoint({ remainingActiveMs: 500 });
    const [next] = stepExtractionPoints([point], 1000, CANDIDATES, createRng(7));
    expect(next!.position).not.toEqual(point.position);
    expect(next!.remainingActiveMs).toBe(EXTRACTION_POINT_ACTIVE_MS);
    expect(next!.id).toBe(point.id); // stable id across the rotation
  });

  it("never relocates before the exact expiry step (boundary)", () => {
    const point = makePoint({ remainingActiveMs: 1000 });
    const [next] = stepExtractionPoints([point], 1000, CANDIDATES, createRng(1));
    // remainingActiveMs hits exactly 0 this step, which is <= 0, so it should relocate.
    expect(next!.remainingActiveMs).toBe(EXTRACTION_POINT_ACTIVE_MS);
  });
});

describe("isWithinExtractionPoint / findActiveExtractionPoint", () => {
  const point: ExtractionPoint = {
    id: "extraction-0",
    position: { x: 100, y: 100 },
    radius: 40,
    remainingActiveMs: EXTRACTION_POINT_ACTIVE_MS,
  };

  it("detects overlap when the actor is within the radius", () => {
    expect(isWithinExtractionPoint({ position: { x: 110, y: 100 }, radius: 16 }, point)).toBe(true);
  });

  it("detects no overlap when the actor is far away", () => {
    expect(isWithinExtractionPoint({ position: { x: 10_000, y: 0 }, radius: 16 }, point)).toBe(
      false,
    );
  });

  it("finds the point the actor overlaps among several, or null if none", () => {
    const far: ExtractionPoint = { ...point, id: "extraction-1", position: { x: 10_000, y: 0 } };
    const actor = { position: { x: 100, y: 100 }, radius: 16 };
    expect(findActiveExtractionPoint(actor, [far, point])?.id).toBe("extraction-0");
    expect(
      findActiveExtractionPoint({ position: { x: -10_000, y: 0 }, radius: 16 }, [far, point]),
    ).toBeNull();
  });
});
