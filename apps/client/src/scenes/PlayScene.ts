/**
 * The local play scene (M1.1, `docs/M1_EXECUTION_PLAN.md` §2.1, §2.2). It
 * captures input intent, advances the shared simulation on a fixed step, and
 * renders the resulting state — it decides no outcomes itself (technical plan
 * §5.1). M1 shipped aim, the sword/bow attack pipeline, the chaser enemy,
 * player health/death, the HUD, and the dash. M2 (`docs/M2_ISSUES.md`) adds
 * loot pickup, the inventory/secure-slot HUD, rotating extraction, and the
 * local run result — all engine logic lives inside `stepSimulation`; this
 * scene only calls it and renders the result.
 *
 * The map constants below are the local test arena's data. M4 prep doubled
 * both dimensions, raised the run to three enemies, and made a finished run
 * hand back to `LoadoutScene` rather than silently restarting with the same
 * skills.
 */
import { basicBow, basicSword, chaser } from "@carry-or-fall/game-content";
import Phaser from "phaser";
import {
  createSimulation,
  createSkillLoadout,
  EMPTY_SKILL_LOADOUT,
  SIMULATION_DT_MS,
  stepSimulation,
  type SkillLoadout,
  type Vec2,
  type Wall,
  type World,
} from "@carry-or-fall/simulation-core";

import { CombatHud } from "../hud/combat-hud";
import { InventoryHud } from "../hud/inventory-hud";
import { KeyboardInput } from "../input/keyboard";
import { PointerInput } from "../input/pointer";
import { WorldView } from "../render/world-view";
import { DEFAULT_SKILL_LOADOUT_IDS } from "./LoadoutScene";

/**
 * Doubled in both dimensions from M1's 960x540 for M4 prep (4x the play
 * area): at the old size three enemies converged on the player almost
 * immediately and there was no room to kite, disengage, or use the bow at
 * range. Geometry only, still proposed and balance-deferred.
 */
const MAP_WIDTH = 1920;
const MAP_HEIGHT = 1080;
const WALL_THICKNESS = 20;

/**
 * The test map (M1.5, doubled for M4 prep): a bordered room plus three
 * interior walls to approach, slide along, break line of sight on, and
 * bounce `ricochet` projectiles off. Geometry only, proposed for this
 * milestone — not a `game-content` definition, since map layout is not
 * content in scope here.
 *
 * The two horizontal walls were added with the size increase: one interior
 * wall in 4x the area left the arena essentially empty, with almost no
 * surface for bounce to use and no cover to break a three-enemy chase.
 *
 * Deliberate constraint — the interior walls all sit inside
 * `y ∈ [300, 780]`, leaving two full-width horizontal lanes clear (above
 * `y = 300` and below `y = 780`). {@link RETURNING_SHOT_LANE_Y} documents why
 * that matters.
 */
const TEST_MAP_WALLS: readonly Wall[] = [
  { x: 0, y: 0, width: MAP_WIDTH, height: WALL_THICKNESS }, // top
  { x: 0, y: MAP_HEIGHT - WALL_THICKNESS, width: MAP_WIDTH, height: WALL_THICKNESS }, // bottom
  { x: 0, y: 0, width: WALL_THICKNESS, height: MAP_HEIGHT }, // left
  { x: MAP_WIDTH - WALL_THICKNESS, y: 0, width: WALL_THICKNESS, height: MAP_HEIGHT }, // right
  { x: MAP_WIDTH / 2 - 10, y: 300, width: 20, height: 480 }, // central divider (the original interior wall, scaled)
  { x: 300, y: 300, width: 300, height: 20 }, // near-side cover
  { x: 1300, y: 700, width: 300, height: 20 }, // far-side cover
];

/**
 * A y coordinate in the lower clear lane, used by the browser suite to fire
 * a shot with no wall in its path. `returning_shot` only returns when a
 * projectile survives to its full lifespan, which needs
 * `PROJECTILE_LIFESPAN_MS * projectileSpeed` = 2000ms * 600px/s = 1200px of
 * unobstructed travel. The old 960x540 map's longest interior run was about
 * 1047px, so a shot always hit a wall first and the skill's defining
 * behavior was unreachable (reported at the end of M3). The doubled map's
 * clear lanes are 1880px, which is what makes it reachable.
 *
 * The lower lane specifically, because it is directly below `PLAYER_START`
 * with no wall in between — the upper lane is behind the near-side cover
 * wall and needs a detour to reach.
 */
export const RETURNING_SHOT_LANE_Y = 900;

/**
 * Candidate chaser spawn points, all on the far side of the central divider
 * from the player. `enemyCount` of them are chosen distinctly per run, so
 * listing more than that gives the seeded RNG something to vary.
 *
 * The nearest is ~820px from `PLAYER_START`, which at the chaser's 90px/s is
 * about 9 seconds of warning before the first one can reach the player —
 * and they have to path around the divider to do it.
 */
const ENEMY_SPAWN_POINTS: readonly Vec2[] = [
  { x: 1250, y: 250 },
  { x: 1400, y: 200 },
  { x: 1350, y: 820 },
  { x: 1500, y: 880 },
  { x: 1650, y: 540 },
];

/** How many enemies a local run spawns (M4 prep: was an implicit 1). */
const ENEMY_COUNT = 3;

const PLAYER_START: Vec2 = { x: 480, y: MAP_HEIGHT / 2 };

/**
 * Ground loot scattered at run start (M2.6, `docs/M2_ISSUES.md` §1): since M2
 * owns no new enemy types or respawning, kill drops alone are not enough to
 * exercise the six-slot inventory/secure slot in a short local run, so a
 * handful of loot is also placed directly on the map — geometry-only,
 * exactly like `ENEMY_SPAWN_POINTS` above.
 *
 * Kept at three even though the run now has three enemies: three scattered
 * plus three kill drops is exactly six items, which is exactly the inventory
 * size, so a player who collects everything has to start discarding or
 * securing to take the last one. That is the pressure the six-slot limit
 * exists to create.
 */
const GROUND_LOOT_SPAWN_POINTS: readonly Vec2[] = [
  { x: 700, y: 250 },
  { x: 700, y: 850 },
  { x: 1700, y: 950 },
];

/** Candidate rotating-extraction locations (M2.7); two are active at a time. */
const EXTRACTION_CANDIDATE_POINTS: readonly Vec2[] = [
  { x: 200, y: 200 },
  { x: 200, y: 880 },
  { x: 1720, y: 200 },
  { x: 1720, y: 880 },
];

/**
 * Wildcard skill chips scattered at run start (M3.7, `docs/M3_ISSUES.md`
 * §1): M3 owns no boss content (M7) and no new enemy type, so — exactly like
 * M2.6's ground loot — a handful of chips are placed directly on the map,
 * geometry-only, like `ENEMY_SPAWN_POINTS`/`GROUND_LOOT_SPAWN_POINTS` above.
 */
const SKILL_CHIP_SPAWN_POINTS: readonly Vec2[] = [
  { x: 760, y: 540 }, // player's side of the divider: straight-line reachable from PLAYER_START
  { x: 1740, y: 620 }, // far side: reachable only by routing around the divider
];

/**
 * A fresh browser session with no incoming `LoadoutScene` data (e.g. a
 * future direct-launch path) falls back to the same documented default
 * loadout the loadout screen pre-selects, resolved once via the same
 * validated `createSkillLoadout` boundary every other loadout goes through.
 */
function resolveDefaultLoadout(): SkillLoadout {
  const result = createSkillLoadout(DEFAULT_SKILL_LOADOUT_IDS);
  return result.ok ? result.loadout : EMPTY_SKILL_LOADOUT;
}

/** Scene data passed from `LoadoutScene` (`docs/M3_ISSUES.md` M3.8). */
export interface PlaySceneData {
  readonly skillLoadout?: SkillLoadout;
}

export class PlayScene extends Phaser.Scene {
  private keyboardInput!: KeyboardInput;
  private pointerInput!: PointerInput;
  private worldView!: WorldView;
  private combatHud!: CombatHud;
  private inventoryHud!: InventoryHud;
  private world!: World;
  private accumulatorMs = 0;
  /**
   * The current run's permanent skill loadout (M3.2), received from
   * `LoadoutScene` as scene data. Held only for the lifetime of this run —
   * once the run ends the player goes back to `LoadoutScene` and picks
   * again, so nothing here outlives a page reload (`docs/DECISIONS.md` D27,
   * D31).
   */
  private skillLoadout: SkillLoadout = EMPTY_SKILL_LOADOUT;

  constructor() {
    super("play");
  }

  /**
   * The current world, or `null` before `create()` has run. Read-only;
   * exists so `main.ts` can wire it into the dev-only debug hook
   * (`docs/TEST_PLAN.md` §2.3) without the hook reaching into a private
   * field.
   */
  getWorld(): World | null {
    return this.world ?? null;
  }

  private buildSimulationConfig(): Parameters<typeof createSimulation>[0] {
    return {
      walls: TEST_MAP_WALLS,
      playerStart: PLAYER_START,
      meleeWeapon: basicSword,
      rangedWeapon: basicBow,
      enemyDefinition: chaser,
      enemySpawnPoints: ENEMY_SPAWN_POINTS,
      enemyCount: ENEMY_COUNT,
      groundLootSpawnPoints: GROUND_LOOT_SPAWN_POINTS,
      skillChipSpawnPoints: SKILL_CHIP_SPAWN_POINTS,
      extractionCandidatePoints: EXTRACTION_CANDIDATE_POINTS,
      skillLoadout: this.skillLoadout,
      // A fresh random seed per run (technical plan §9.4: "give each match a
      // random seed"); the seeded PRNG itself stays fully deterministic and
      // reproducible given a seed, which is what the simulation-core tests
      // exercise.
      seed: Date.now(),
    };
  }

  create(data: PlaySceneData = {}): void {
    this.skillLoadout = data.skillLoadout ?? resolveDefaultLoadout();
    this.world = createSimulation(this.buildSimulationConfig());
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
    const confirmJustPressed = Phaser.Input.Keyboard.JustDown(this.keyboardInput.confirmRunResult);

    if (runOver) {
      // The run has ended (M1.10 death or M2.8 extraction/death); stop
      // advancing the simulation. The result stays on screen (rendered by
      // `CombatHud` from `world.runResult`) until the player acknowledges it
      // with Enter, which hands off to `LoadoutScene` so the next run can be
      // built from a different loadout — concept §8.3 has skills chosen
      // before entering a match, so the loop is
      // choose -> run -> result -> choose again.
      //
      // Still local and non-persistent (`docs/DECISIONS.md` D27, D31): this
      // is a scene transition within one page session, storing nothing.
      this.accumulatorMs = 0;
      if (confirmJustPressed) {
        this.scene.start("loadout");
        return;
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
