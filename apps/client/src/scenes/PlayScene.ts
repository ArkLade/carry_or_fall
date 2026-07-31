/**
 * The local play scene (M1.1, `docs/M1_EXECUTION_PLAN.md` §2.1, §2.2). It
 * captures input intent, advances the shared simulation on a fixed step, and
 * renders the resulting state — it decides no outcomes itself (technical plan
 * §5.1). M1 shipped aim, the sword/bow attack pipeline, the chaser enemy,
 * player health/death, the HUD, and the dash. M2 (`docs/M2_ISSUES.md`) adds
 * loot pickup, the inventory/secure-slot HUD, rotating extraction, and the
 * local run result — all engine logic lives inside `stepSimulation`; this
 * scene only calls it and renders the result.
 */
import { basicBow, basicSword, chaser } from "@carry-or-fall/game-content";
import Phaser from "phaser";
import {
  createSimulation,
  SIMULATION_DT_MS,
  stepSimulation,
  type Vec2,
  type Wall,
  type World,
} from "@carry-or-fall/simulation-core";

import { CombatHud } from "../hud/combat-hud";
import { InventoryHud } from "../hud/inventory-hud";
import { KeyboardInput } from "../input/keyboard";
import { PointerInput } from "../input/pointer";
import { WorldView } from "../render/world-view";

const MAP_WIDTH = 960;
const MAP_HEIGHT = 540;
const WALL_THICKNESS = 20;

/**
 * A compact test map (M1.5): a bordered room plus one interior wall to
 * approach and slide along. Geometry only, proposed for this milestone — not
 * a `game-content` definition, since map layout is not content in scope here.
 */
const TEST_MAP_WALLS: readonly Wall[] = [
  { x: 0, y: 0, width: MAP_WIDTH, height: WALL_THICKNESS }, // top
  { x: 0, y: MAP_HEIGHT - WALL_THICKNESS, width: MAP_WIDTH, height: WALL_THICKNESS }, // bottom
  { x: 0, y: 0, width: WALL_THICKNESS, height: MAP_HEIGHT }, // left
  { x: MAP_WIDTH - WALL_THICKNESS, y: 0, width: WALL_THICKNESS, height: MAP_HEIGHT }, // right
  { x: MAP_WIDTH / 2 - 10, y: 150, width: 20, height: 240 }, // interior wall
];

const PLAYER_START: Vec2 = { x: 240, y: MAP_HEIGHT / 2 };

/** Candidate chaser spawn points, scattered on the far side of the interior wall from the player. */
const ENEMY_SPAWN_POINTS: readonly Vec2[] = [
  { x: 700, y: 100 },
  { x: 750, y: 450 },
  { x: 850, y: 270 },
];

/**
 * Ground loot scattered at run start (M2.6, `docs/M2_ISSUES.md` §1): since M2
 * owns no new enemy types or respawning, the one chaser's single drop is not
 * enough to exercise the six-slot inventory/secure slot in a short local run,
 * so a handful of loot is also placed directly on the map — geometry-only,
 * exactly like `ENEMY_SPAWN_POINTS` above.
 */
const GROUND_LOOT_SPAWN_POINTS: readonly Vec2[] = [
  { x: 320, y: 120 },
  { x: 320, y: 420 },
  { x: 850, y: 460 },
];

/** Candidate rotating-extraction locations (M2.7); two are active at a time. */
const EXTRACTION_CANDIDATE_POINTS: readonly Vec2[] = [
  { x: 100, y: 100 },
  { x: 100, y: 440 },
  { x: 880, y: 100 },
  { x: 880, y: 440 },
];

function buildSimulationConfig(): Parameters<typeof createSimulation>[0] {
  return {
    walls: TEST_MAP_WALLS,
    playerStart: PLAYER_START,
    meleeWeapon: basicSword,
    rangedWeapon: basicBow,
    enemyDefinition: chaser,
    enemySpawnPoints: ENEMY_SPAWN_POINTS,
    groundLootSpawnPoints: GROUND_LOOT_SPAWN_POINTS,
    extractionCandidatePoints: EXTRACTION_CANDIDATE_POINTS,
    // A fresh random seed per run (technical plan §9.4: "give each match a
    // random seed"); the seeded PRNG itself stays fully deterministic and
    // reproducible given a seed, which is what the simulation-core tests
    // exercise.
    seed: Date.now(),
  };
}

export class PlayScene extends Phaser.Scene {
  private keyboardInput!: KeyboardInput;
  private pointerInput!: PointerInput;
  private worldView!: WorldView;
  private combatHud!: CombatHud;
  private inventoryHud!: InventoryHud;
  private world!: World;
  private accumulatorMs = 0;

  constructor() {
    super("play");
  }

  create(): void {
    this.world = createSimulation(buildSimulationConfig());
    this.keyboardInput = new KeyboardInput(this);
    this.pointerInput = new PointerInput(this);
    this.worldView = new WorldView(this);
    this.combatHud = new CombatHud(this);
    this.inventoryHud = new InventoryHud(this);
    this.worldView.render(this.world);
    this.combatHud.render(this.world);
    this.inventoryHud.render(this.world);
  }

  override update(_time: number, deltaMs: number): void {
    const runOver = !this.world.player.alive || this.world.runResult !== null;
    // Polled every frame regardless of branch so a stray Enter press during
    // active play cannot leave a stale JustDown flag that fires the instant
    // the run later ends.
    const restartJustPressed = Phaser.Input.Keyboard.JustDown(this.keyboardInput.restart);

    if (runOver) {
      // The run has ended (M1.10 death or M2.8 extraction/death); stop
      // advancing the simulation. A playtest convenience — not a lobby
      // system — lets a human start a fresh local run without reloading.
      this.accumulatorMs = 0;
      if (restartJustPressed) {
        this.world = createSimulation(buildSimulationConfig());
      }
    } else {
      const movement = this.keyboardInput.getInputState();
      const input = {
        ...movement,
        aimAngle: this.pointerInput.aimAngleFrom(this.world.player.position),
        attackPressed: this.pointerInput.isAttackPressed(),
        secondaryAttackPressed: this.pointerInput.isSecondaryAttackPressed(),
      };

      this.accumulatorMs += deltaMs;
      // The single client→simulation seam (`docs/M1_EXECUTION_PLAN.md` §2.1):
      // the only call site that advances authoritative state, and only ever
      // by the fixed step — never by `deltaMs` itself (technical plan §9.3).
      // This becomes the authoritative room boundary at M4.
      while (this.accumulatorMs >= SIMULATION_DT_MS) {
        ({ world: this.world } = stepSimulation(this.world, input));
        this.accumulatorMs -= SIMULATION_DT_MS;
      }
    }

    if (Phaser.Input.Keyboard.JustDown(this.keyboardInput.inventoryToggle)) {
      this.inventoryHud.toggle();
    }

    this.worldView.render(this.world);
    this.combatHud.render(this.world);
    this.inventoryHud.render(this.world);
  }
}
