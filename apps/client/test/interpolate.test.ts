/**
 * Interpolation is the client's whole answer to the gap between input and
 * authoritative state (technical plan §11.1, `docs/M4_ISSUES.md` §1.2), so what
 * it must never do is as important as what it does: it must not invent a
 * position past the last one the server sent.
 */
import { describe, expect, it } from "vitest";
import type { MatchView, PlayerView } from "@carry-or-fall/protocol";

import { interpolateMatchView } from "../src/render/interpolate";

function player(id: string, x: number, y: number): PlayerView {
  return {
    id,
    x,
    y,
    radius: 16,
    facing: 0,
    health: 100,
    maxHealth: 100,
    shieldHp: 0,
    alive: true,
    runOver: false,
    connected: true,
    extractionProgressMs: 0,
    swingActive: false,
    swingOriginX: 0,
    swingOriginY: 0,
    swingFacing: 0,
    swingRangePx: 0,
    swingArcDegrees: 0,
  };
}

function view(overrides: Partial<MatchView> = {}): MatchView {
  return {
    phase: "running",
    arenaId: "test_arena",
    serverBuildVersion: "0.0.0-test",
    seed: 1,
    tick: 0,
    countdownRemainingMs: 0,
    matchRemainingMs: 1000,
    players: [],
    enemies: [],
    projectiles: [],
    groundLoot: [],
    skillChips: [],
    extractionPoints: [],
    boss: null,
    ...overrides,
  };
}

describe("interpolateMatchView", () => {
  it("blends a player halfway between the two authoritative positions", () => {
    const previous = view({ players: [player("a", 0, 0)] });
    const latest = view({ players: [player("a", 100, 50)] });

    const blended = interpolateMatchView(previous, latest, 0.5);
    expect(blended.players[0]!.x).toBeCloseTo(50);
    expect(blended.players[0]!.y).toBeCloseTo(25);
  });

  it("never moves past the latest authoritative position", () => {
    // The client renders what the server sent, at most. Overshooting would be
    // extrapolation — a position no one decided (technical plan §11.1).
    const previous = view({ players: [player("a", 0, 0)] });
    const latest = view({ players: [player("a", 100, 0)] });

    for (const alpha of [1, 1.5, 10]) {
      const blended = interpolateMatchView(previous, latest, alpha);
      expect(blended.players[0]!.x).toBe(100);
    }
  });

  it("returns the latest snapshot unchanged when there is nothing to blend from", () => {
    const latest = view({ players: [player("a", 100, 0)] });
    expect(interpolateMatchView(null, latest, 0.5)).toBe(latest);
  });

  it("draws a newly spawned entity at its first authoritative position", () => {
    const previous = view({ players: [player("a", 0, 0)] });
    const latest = view({ players: [player("a", 10, 0), player("b", 500, 500)] });

    const blended = interpolateMatchView(previous, latest, 0.5);
    const spawned = blended.players.find((entry) => entry.id === "b")!;
    expect(spawned.x).toBe(500);
    expect(spawned.y).toBe(500);
  });

  it("does not interpolate authoritative facts, only motion", () => {
    // A half-interpolated health bar would show a number no one ever decided.
    const previous = view({ players: [{ ...player("a", 0, 0), health: 100, shieldHp: 8 }] });
    const latest = view({ players: [{ ...player("a", 100, 0), health: 40, shieldHp: 0 }] });

    const blended = interpolateMatchView(previous, latest, 0.5);
    expect(blended.players[0]!.health).toBe(40);
    expect(blended.players[0]!.shieldHp).toBe(0);
  });

  it("leaves ground loot, chips, and extraction points where the server put them", () => {
    // A rotating extraction point is *supposed* to jump when it reopens
    // elsewhere (concept §17.1); smoothing it would invent a journey.
    const point = { id: "extraction-0", x: 0, y: 0, radius: 40, remainingActiveMs: 1000 };
    const previous = view({ extractionPoints: [point] });
    const latest = view({ extractionPoints: [{ ...point, x: 1000, y: 800 }] });

    const blended = interpolateMatchView(previous, latest, 0.5);
    expect(blended.extractionPoints[0]!.x).toBe(1000);
    expect(blended.extractionPoints[0]!.y).toBe(800);
  });
});
