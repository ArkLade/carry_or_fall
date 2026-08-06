/**
 * The play scene. It captures input intent, sends it to the authoritative
 * match room, and renders the authoritative state that comes back — it decides
 * no outcomes itself (technical plan §5.1).
 *
 * **M4 moved the seam.** From M1 to M3 this scene owned a local `World` and
 * called `stepSimulation` once per fixed step; that call site was described from
 * the start as the one place the client entered the simulation, kept there
 * precisely so it could become the room boundary at this milestone. It now is
 * one: the simulation runs on the server, this scene sends `InputMessage`s and
 * renders `MatchView` snapshots, and nothing in `apps/client/src` steps a
 * simulation any more (`apps/client/test/architecture.test.ts` enforces that).
 *
 * Rendering interpolates between the two most recent authoritative snapshots
 * (technical plan §11.1) — including for the local player, because prediction is
 * explicitly deferred until multiplayer is correct (§11.2, `docs/M4_ISSUES.md`
 * §1.2).
 */
import {
  findArena,
  findLoot,
  isBossCore,
  testArena,
  type ArenaDefinition,
} from "@carry-or-fall/game-content";
import type {
  InputMessage,
  MatchView,
  PlayerView,
  SeatReservationPayload,
} from "@carry-or-fall/protocol";
import Phaser from "phaser";

import { UNCONFIGURED_ACCOUNT, type AccountState } from "../account/account";
import { loadClientEnv } from "../config/env";
import type { CameraObservation } from "../debug/debug-hook";
import { CombatHud } from "../hud/combat-hud";
import { InventoryHud } from "../hud/inventory-hud";
import { KeyboardInput } from "../input/keyboard";
import { PointerInput } from "../input/pointer";
import { MatchConnection, type MatchStatus } from "../network/match-connection";
import { interpolateMatchView } from "../render/interpolate";
import { WorldView } from "../render/world-view";
import { DEFAULT_SKILL_LOADOUT_IDS } from "./LoadoutScene";

/** Scene data passed from `LoadoutScene` (`docs/M3_ISSUES.md` M3.8). */
export interface PlaySceneData {
  readonly skillLoadoutIds?: readonly string[];
  /**
   * The account `LoadoutScene` signed in (M5). Only the access token travels to
   * the server; the balances and unlocks here are for display, and the server
   * re-reads its own copy of both.
   */
  readonly account?: AccountState;
  /**
   * The seat the server reserved for this client when their party queued (M6).
   * Present only for a party member; a solo run leaves it undefined and takes
   * the unchanged M4 path.
   */
  readonly seatReservation?: SeatReservationPayload | null;
}

export class PlayScene extends Phaser.Scene {
  private keyboardInput!: KeyboardInput;
  private pointerInput!: PointerInput;
  private worldView!: WorldView;
  private combatHud!: CombatHud;
  private inventoryHud!: InventoryHud;
  private connection: MatchConnection | null = null;
  private status: MatchStatus = "connecting";
  private statusDetail: string | null = null;
  private arena: ArenaDefinition = testArena;
  private account: AccountState = UNCONFIGURED_ACCOUNT;
  private cameraConfigured = false;
  /** This client's own party members in this match, from the private message (M6). */
  private partyMemberIds: readonly string[] = [];

  constructor() {
    super("play");
  }

  /**
   * The latest authoritative snapshot — **not** the interpolated one — or `null`
   * before the first patch arrives. Read-only; exists so `main.ts` can wire it
   * into the dev-only debug hook (`docs/TEST_PLAN.md` §2.3) without the hook
   * reaching into a private field. Tests assert against the authoritative
   * values, so rendering smoothness never changes what a test sees.
   */
  getSnapshot(): MatchView | null {
    return this.connection?.getSnapshot() ?? null;
  }

  getLocalPlayerId(): string | null {
    return this.connection?.getLocalPlayerId() ?? null;
  }

  getPrivateState(): ReturnType<MatchConnection["getPrivateState"]> {
    return this.connection?.getPrivateState() ?? null;
  }

  getConnectionStatus(): MatchStatus {
    return this.status;
  }

  /** Read-only rendering state for the dev-only browser observation hook. */
  getCameraObservation(): CameraObservation | null {
    if (!this.cameraConfigured) {
      return null;
    }
    const camera = this.cameras.main;
    const bounds = camera.getBounds();
    return {
      scrollX: camera.scrollX,
      scrollY: camera.scrollY,
      viewportWidth: camera.width,
      viewportHeight: camera.height,
      arenaBounds: {
        x: bounds.x,
        y: bounds.y,
        width: bounds.width,
        height: bounds.height,
      },
    };
  }

  /**
   * This client's party members in this match, for the dev-only debug hook.
   *
   * Read from the connection rather than from the field the renderer uses: that
   * field is refreshed in `update()`, which runs on an animation frame, and a
   * backgrounded tab's frames are throttled to a handful a second. A test that
   * asked a backgrounded page for its teammates would get the value from before
   * they arrived — a stale answer that looks exactly like a missing feature.
   */
  getPartyMemberIds(): readonly string[] {
    return this.connection?.getPrivateState()?.partyMemberIds ?? [];
  }

  /**
   * Which inventory slot holds a boss core, or `null` (M7). Read from this
   * client's own private state, which is the only place it appears — a core in
   * someone else's inventory is not in any document this client receives.
   */
  private carriedCoreSlot(): number | null {
    const inventory = this.connection?.getPrivateState()?.inventory ?? [];
    for (let slot = 0; slot < inventory.length; slot += 1) {
      const id = inventory[slot];
      if (id === null || id === undefined) {
        continue;
      }
      const item = findLoot(id);
      if (item !== null && isBossCore(item)) {
        return slot;
      }
    }
    return null;
  }

  create(data: PlaySceneData = {}): void {
    this.keyboardInput = new KeyboardInput(this);
    this.pointerInput = new PointerInput(this);
    this.worldView = new WorldView(this);
    this.combatHud = new CombatHud(this);
    this.inventoryHud = new InventoryHud(this);
    this.connection = null;
    this.status = "connecting";
    this.statusDetail = null;
    this.cameraConfigured = false;
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.cameraConfigured = false;
    });
    this.arena = testArena;
    this.configureCamera(this.arena);

    this.account = data.account ?? UNCONFIGURED_ACCOUNT;
    this.partyMemberIds = [];
    void this.connect(data.skillLoadoutIds ?? DEFAULT_SKILL_LOADOUT_IDS, data.seatReservation);
  }

  private async connect(
    skillLoadoutIds: readonly string[],
    seatReservation?: SeatReservationPayload | null,
  ): Promise<void> {
    try {
      // Inside the `try` deliberately. `loadClientEnv` throws on missing or
      // malformed configuration — which is correct, that is a real
      // misconfiguration — but this method is invoked as `void this.connect(…)`,
      // so a throw from outside the `try` became an unhandled rejection: the
      // scene sat on an empty screen with no connection and no message, and
      // anything waiting for authoritative state waited forever. Failing loudly
      // is right; failing silently is not.
      const env = loadClientEnv();
      this.connection = await MatchConnection.join(
        {
          ...env,
          skillLoadoutIds,
          accessToken: this.account.accessToken,
          seatReservation: seatReservation ?? null,
        },
        {
          onStatusChange: (status, detail) => {
            this.status = status;
            this.statusDetail = detail ?? null;
          },
        },
      );
    } catch (error) {
      // The refusal message the server sent (an out-of-date client, an illegal
      // loadout) is already in `statusDetail` via onStatusChange.
      this.status = "failed";
      this.statusDetail = error instanceof Error ? error.message : String(error);
    }
  }

  override update(): void {
    // Polled every frame regardless of branch so a stray Enter press during
    // active play cannot leave a stale JustDown flag that fires the instant the
    // run later ends.
    const confirmJustPressed = Phaser.Input.Keyboard.JustDown(this.keyboardInput.confirmRunResult);
    if (Phaser.Input.Keyboard.JustDown(this.keyboardInput.inventoryToggle)) {
      this.inventoryHud.toggle();
    }

    const connection = this.connection;
    if (connection === null || this.status === "failed") {
      // The join was refused (an out-of-date client, an illegal loadout) or the
      // connection dropped for good. Enter goes back to the loadout screen
      // rather than leaving the player on a dead screen with nothing to press.
      if (confirmJustPressed && this.status === "failed") {
        void this.returnToLoadout();
        return;
      }
      this.renderConnecting();
      return;
    }

    const snapshot = connection.getSnapshot();
    if (snapshot === null) {
      this.renderConnecting();
      return;
    }

    const localPlayerId = connection.getLocalPlayerId();
    const localPlayer = findLocalPlayer(snapshot, localPlayerId);
    const privateState = connection.getPrivateState();
    // Rendering only: the marker list changes no rule and grants no authority
    // (`docs/DECISIONS.md` D58).
    this.partyMemberIds = privateState?.partyMemberIds ?? [];
    const runOver = localPlayer !== null && localPlayer.runOver;

    const alpha = connection.getInterpolationAlpha(performance.now());
    const view = interpolateMatchView(connection.getPreviousSnapshot(), snapshot, alpha);
    const arena = this.arenaFor(snapshot);
    const renderedLocalPlayer = findLocalPlayer(view, localPlayerId);
    if (renderedLocalPlayer === null) {
      this.centerCameraSafely(arena);
    } else {
      this.cameras.main.centerOn(renderedLocalPlayer.x, renderedLocalPlayer.y);
    }
    // PointerInput reads worldX/worldY outside an input event. Phaser requires
    // refreshing those values after camera movement so a stationary pointer
    // keeps aiming at the world position currently under it.
    this.input.activePointer.updateWorldPoint(this.cameras.main);

    if (runOver || snapshot.phase === "ending") {
      // This player's run has ended. The result stays on screen (rendered by
      // `CombatHud` from the private state) until they acknowledge it with
      // Enter, which leaves the room and hands off to `LoadoutScene` so the
      // next run can be built from a different loadout — concept §8.3 has
      // skills chosen before entering a match, so the loop is
      // choose -> match -> result -> choose again.
      if (confirmJustPressed) {
        void this.returnToLoadout();
        return;
      }
    } else {
      this.sendInput(snapshot, localPlayer);
    }

    this.worldView.render(view, arena, localPlayerId, this.partyMemberIds);
    this.combatHud.render(
      snapshot,
      localPlayer,
      privateState,
      this.status,
      connection.getSettlement(),
    );
    this.inventoryHud.render(privateState, localPlayer);
  }

  /**
   * Capture this frame's intent and hand it to the connection, which caps the
   * send rate at 20 per second (technical plan §9.1). Inventory commands are
   * one-shot messages rather than input fields, matching §14.2's shape.
   */
  private sendInput(snapshot: MatchView, localPlayer: PlayerView | null): void {
    const connection = this.connection;
    if (connection === null) {
      return;
    }
    const keyboard = this.keyboardInput.getInputState();

    if (keyboard.secureSlotIndex !== null) {
      connection.sendSecureItem(keyboard.secureSlotIndex);
    }
    if (keyboard.discardSlotIndex !== null) {
      connection.sendDiscardItem(keyboard.discardSlotIndex);
    }
    if (keyboard.activateCorePressed) {
      // `C` means "activate the core I am carrying", and the client resolves
      // *which slot* that is from its own private state purely so the player
      // does not have to remember. It is a convenience, not an assertion: the
      // server re-reads the slot and refuses if it does not hold a core (M7,
      // concept §11 option 1). Nothing happens when no core is carried.
      const coreSlot = this.carriedCoreSlot();
      if (coreSlot !== null) {
        connection.sendActivateCore(coreSlot);
      }
    }

    // Aim is measured from the player's last authoritative position; the client
    // reports the angle it wants, and the server decides what that angle means.
    const origin =
      localPlayer === null
        ? { x: snapshot.players[0]?.x ?? 0, y: snapshot.players[0]?.y ?? 0 }
        : { x: localPlayer.x, y: localPlayer.y };

    const input: Omit<InputMessage, "sequence"> = {
      moveX: keyboard.moveX,
      moveY: keyboard.moveY,
      aimAngle: this.pointerInput.aimAngleFrom(origin),
      attackPressed: this.pointerInput.isAttackPressed(),
      secondaryAttackPressed: this.pointerInput.isSecondaryAttackPressed(),
      dashPressed: keyboard.dashPressed,
      interactPressed: keyboard.interactPressed,
    };
    connection.sendInput(input, performance.now());
  }

  /** The arena the server says this match is on, falling back to the one this build ships. */
  private arenaFor(snapshot: MatchView): ArenaDefinition {
    const arena = findArena(snapshot.arenaId);
    if (arena !== undefined && arena !== this.arena) {
      this.arena = arena;
      this.configureCamera(arena);
    }
    return this.arena;
  }

  /** Configure the existing main camera directly from authoritative arena content. */
  private configureCamera(arena: ArenaDefinition): void {
    this.cameras.main.setBounds(0, 0, arena.width, arena.height);
    this.cameraConfigured = true;
    this.centerCameraSafely(arena);
  }

  /** Deterministic in-bounds view used until an authoritative local player exists. */
  private centerCameraSafely(arena: ArenaDefinition): void {
    this.cameras.main.centerOn(arena.width / 2, arena.height / 2);
  }

  private renderConnecting(): void {
    // Nothing authoritative has arrived yet, so there is nothing to draw but the
    // status. Deliberately not a fabricated world: the client owns no state to
    // show before the server sends some.
    this.centerCameraSafely(this.arena);
    this.worldView.render(EMPTY_VIEW, this.arena, null, []);
    this.combatHud.render(EMPTY_VIEW, null, null, this.status);
    this.inventoryHud.render(null, null);
  }

  private async returnToLoadout(): Promise<void> {
    const connection = this.connection;
    const settlement = connection?.getSettlement() ?? null;
    this.connection = null;
    await connection?.leave();
    // Hand the settled balances forward so the loadout screen shows the account
    // as it now stands without a second round trip — and so the §17.3 warning,
    // once triggered, follows the player out of the match (`docs/DATA_MODEL.md`
    // §7).
    this.scene.start("loadout", { settlement });
  }

  /** The failure detail the server reported, if any — surfaced for diagnostics and tests. */
  getStatusDetail(): string | null {
    return this.statusDetail;
  }
}

function findLocalPlayer(view: MatchView, localPlayerId: string | null): PlayerView | null {
  if (localPlayerId === null) {
    return null;
  }
  return view.players.find((player) => player.id === localPlayerId) ?? null;
}

/** A placeholder snapshot used only before the first authoritative patch arrives. */
const EMPTY_VIEW: MatchView = {
  phase: "waiting",
  arenaId: testArena.id,
  serverBuildVersion: "",
  seed: 0,
  tick: 0,
  countdownRemainingMs: 0,
  matchRemainingMs: 0,
  players: [],
  enemies: [],
  projectiles: [],
  groundLoot: [],
  skillChips: [],
  extractionPoints: [],
  boss: null,
};
