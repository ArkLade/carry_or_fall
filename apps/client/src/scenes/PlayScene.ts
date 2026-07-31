/**
 * The local M1 play scene (M1.1, `docs/M1_EXECUTION_PLAN.md` §2.1, §2.2). It
 * captures input intent, advances the shared simulation on a fixed step, and
 * renders the resulting state — it decides no outcomes itself (technical plan
 * §5.1). M1 is now complete: aim, the sword/bow attack pipeline, the chaser
 * enemy, player health/death, the HUD, and the dash. No enemy logic runs
 * here — chasing, contact damage, and hit resolution all happen inside
 * `stepSimulation`; this scene only calls it and renders the result.
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

export class PlayScene extends Phaser.Scene {
  private keyboardInput!: KeyboardInput;
  private pointerInput!: PointerInput;
  private worldView!: WorldView;
  private combatHud!: CombatHud;
  private world!: World;
  private accumulatorMs = 0;

  constructor() {
    super("play");
  }

  create(): void {
    this.world = createSimulation({
      walls: TEST_MAP_WALLS,
      playerStart: PLAYER_START,
      meleeWeapon: basicSword,
      rangedWeapon: basicBow,
      enemyDefinition: chaser,
      enemySpawnPoints: ENEMY_SPAWN_POINTS,
      // A fresh random seed per run (technical plan §9.4: "give each match a
      // random seed"); the seeded PRNG itself stays fully deterministic and
      // reproducible given a seed, which is what the simulation-core tests
      // exercise.
      seed: Date.now(),
    });
    this.keyboardInput = new KeyboardInput(this);
    this.pointerInput = new PointerInput(this);
    this.worldView = new WorldView(this);
    this.combatHud = new CombatHud(this);
    this.worldView.render(this.world);
    this.combatHud.render(this.world);
  }

  override update(_time: number, deltaMs: number): void {
    const movement = this.keyboardInput.getInputState();
    const input = {
      ...movement,
      aimAngle: this.pointerInput.aimAngleFrom(this.world.player.position),
      attackPressed: this.pointerInput.isAttackPressed(),
      secondaryAttackPressed: this.pointerInput.isSecondaryAttackPressed(),
    };

    if (this.world.player.alive) {
      this.accumulatorMs += deltaMs;
      // The single client→simulation seam (`docs/M1_EXECUTION_PLAN.md` §2.1):
      // the only call site that advances authoritative state, and only ever
      // by the fixed step — never by `deltaMs` itself (technical plan §9.3).
      // This becomes the authoritative room boundary at M4.
      while (this.accumulatorMs >= SIMULATION_DT_MS) {
        ({ world: this.world } = stepSimulation(this.world, input));
        this.accumulatorMs -= SIMULATION_DT_MS;
      }
    } else {
      // M1.10: the run has ended; stop advancing the simulation entirely.
      this.accumulatorMs = 0;
    }

    this.worldView.render(this.world);
    this.combatHud.render(this.world);
  }
}
