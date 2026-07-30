/**
 * The local M1 play scene (M1.1, `docs/M1_EXECUTION_PLAN.md` §2.1, §2.2). It
 * captures input intent, advances the shared simulation on a fixed step, and
 * renders the resulting state — it decides no outcomes itself (technical plan
 * §5.1). This chunk adds aim and the sword/bow attack pipeline; the enemy,
 * health/death, the HUD, and dash are later M1 chunks and are intentionally
 * absent here. There is no enemy to hit yet, so the pipeline is always run
 * with an empty target list — melee/ranged hit resolution is exercised by
 * `packages/simulation-core` unit tests, not by anything in this scene.
 */
import { basicBow, basicSword } from "@carry-or-fall/game-content";
import Phaser from "phaser";
import {
  createSimulation,
  SIMULATION_DT_MS,
  stepSimulation,
  type Vec2,
  type Wall,
  type World,
} from "@carry-or-fall/simulation-core";

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

export class PlayScene extends Phaser.Scene {
  private keyboardInput!: KeyboardInput;
  private pointerInput!: PointerInput;
  private worldView!: WorldView;
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
    });
    this.keyboardInput = new KeyboardInput(this);
    this.pointerInput = new PointerInput(this);
    this.worldView = new WorldView(this);
    this.worldView.render(this.world);
  }

  override update(_time: number, deltaMs: number): void {
    this.accumulatorMs += deltaMs;
    const movement = this.keyboardInput.getInputState();
    const input = {
      ...movement,
      aimAngle: this.pointerInput.aimAngleFrom(this.world.player.position),
      attackPressed: this.pointerInput.isAttackPressed(),
      secondaryAttackPressed: this.pointerInput.isSecondaryAttackPressed(),
    };

    // The single client→simulation seam (`docs/M1_EXECUTION_PLAN.md` §2.1):
    // the only call site that advances authoritative state, and only ever by
    // the fixed step — never by `deltaMs` itself (technical plan §9.3). This
    // becomes the authoritative room boundary at M4. No enemy exists yet, so
    // the target list is always empty.
    while (this.accumulatorMs >= SIMULATION_DT_MS) {
      ({ world: this.world } = stepSimulation(this.world, input));
      this.accumulatorMs -= SIMULATION_DT_MS;
    }

    this.worldView.render(this.world);
  }
}
