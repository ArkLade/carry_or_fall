/**
 * The headless, fixed-step local simulation (M1.1, `docs/M1_EXECUTION_PLAN.md`
 * §2.1, §2.2). This module — via `createSimulation`/`stepSimulation` — is the
 * single seam the client calls into; no game rule runs in Phaser scene code
 * (technical plan §5.1, §9.3). The simulation only ever advances by the fixed
 * `SIMULATION_DT_MS` step, never by an arbitrary render-frame delta.
 */
import { buildWallGrid, resolveAxisMovement } from "./collision";
import { computeMovementDelta } from "./movement";
import type { InputState, Vec2, Wall, World } from "./world";

/** The fixed simulation step, in milliseconds (technical plan §9.3). */
export const SIMULATION_DT_MS = 50;

const SIMULATION_DT_SECONDS = SIMULATION_DT_MS / 1000;

/**
 * Player collision radius, in pixels. Proposed for M1 (not specified
 * numerically in the authoritative documents); balance-deferred like
 * `movement.ts`'s `PLAYER_SPEED`.
 */
export const PLAYER_RADIUS = 16;

/** Initial conditions for a fresh local simulation world. */
export interface SimulationConfig {
  readonly walls: readonly Wall[];
  readonly playerStart: Vec2;
}

/** Build the initial `World` for a local run: the player at `playerStart`, plus the static map walls. */
export function createSimulation(config: SimulationConfig): World {
  return {
    player: { position: config.playerStart, radius: PLAYER_RADIUS },
    walls: config.walls,
  };
}

/**
 * Advance the world by exactly one fixed step, applying movement and
 * resolving collision against the map walls. The two movement axes are
 * resolved independently (`resolveAxisMovement`) so the player slides along a
 * wall instead of stopping dead when approaching it diagonally.
 */
export function stepSimulation(world: World, input: InputState): World {
  const { player } = world;
  const delta = computeMovementDelta(input, SIMULATION_DT_SECONDS);
  const grid = buildWallGrid(world.walls);

  const x = resolveAxisMovement(player.position, "x", delta.x, player.radius, grid);
  const afterX: Vec2 = { x, y: player.position.y };
  const y = resolveAxisMovement(afterX, "y", delta.y, player.radius, grid);

  return {
    ...world,
    player: { ...player, position: { x, y } },
  };
}
