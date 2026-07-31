/**
 * Captures WASD movement, the space-bar dash intent, the `E` interact/extract
 * intent (concept §13.1), and the M2 inventory controls. This is the keyboard
 * half of the input-intent path (`docs/M1_EXECUTION_PLAN.md` §2.1): the
 * client decides only what keys are held/were just pressed (technical plan
 * §5.1) and hands that intent to the simulation through the single seam in
 * `PlayScene`; it never decides an outcome itself — whether a discard/secure
 * actually succeeds is `simulation-core`'s call (`docs/M2_ISSUES.md` §1).
 *
 * Digit keys `1`-`6` discard that inventory slot; `Shift`+digit secures it
 * instead — a local-only control scheme (concept §13.1 fixes `E`/`Tab`/`I`
 * but not discard/secure), documented in `docs/M2_ISSUES.md` §1. Both are
 * edge-triggered (`JustDown`) so a held key does not repeat the action every
 * simulation step within the same rendered frame.
 */
import Phaser from "phaser";
import type { InputState } from "@carry-or-fall/simulation-core";

/** The keyboard subset of `InputState`; `PlayScene` merges this with `PointerInput`'s aim/attack fields. */
export type KeyboardInputState = Pick<
  InputState,
  "moveX" | "moveY" | "dashPressed" | "interactPressed" | "discardSlotIndex" | "secureSlotIndex"
>;

export class KeyboardInput {
  private readonly up: Phaser.Input.Keyboard.Key;
  private readonly down: Phaser.Input.Keyboard.Key;
  private readonly left: Phaser.Input.Keyboard.Key;
  private readonly right: Phaser.Input.Keyboard.Key;
  private readonly dash: Phaser.Input.Keyboard.Key;
  private readonly interact: Phaser.Input.Keyboard.Key;
  private readonly shift: Phaser.Input.Keyboard.Key;
  private readonly slotKeys: readonly Phaser.Input.Keyboard.Key[];
  /** Toggles the inventory HUD panel; read by `PlayScene`, not part of `InputState` (client-only UI). */
  readonly inventoryToggle: Phaser.Input.Keyboard.Key;
  /**
   * Acknowledges the run result once the current run has ended, handing off
   * to `LoadoutScene` to pick the next run's skills (concept §8.3). A local
   * scene transition, not a lobby.
   */
  readonly confirmRunResult: Phaser.Input.Keyboard.Key;

  constructor(scene: Phaser.Scene) {
    const keyboard = scene.input.keyboard;
    if (keyboard === null) {
      throw new Error("keyboard input is not available in this environment");
    }

    const Codes = Phaser.Input.Keyboard.KeyCodes;
    this.up = keyboard.addKey(Codes.W);
    this.down = keyboard.addKey(Codes.S);
    this.left = keyboard.addKey(Codes.A);
    this.right = keyboard.addKey(Codes.D);
    this.dash = keyboard.addKey(Codes.SPACE);
    this.interact = keyboard.addKey(Codes.E);
    this.shift = keyboard.addKey(Codes.SHIFT);
    this.slotKeys = [Codes.ONE, Codes.TWO, Codes.THREE, Codes.FOUR, Codes.FIVE, Codes.SIX].map(
      (code) => keyboard.addKey(code),
    );
    this.inventoryToggle = keyboard.addKey(Codes.I);
    this.confirmRunResult = keyboard.addKey(Codes.ENTER);
  }

  /** The current normalized movement + dash/interact intent and any one-shot discard/secure request. */
  getInputState(): KeyboardInputState {
    let discardSlotIndex: number | null = null;
    let secureSlotIndex: number | null = null;
    for (let i = 0; i < this.slotKeys.length; i += 1) {
      if (Phaser.Input.Keyboard.JustDown(this.slotKeys[i]!)) {
        if (this.shift.isDown) {
          secureSlotIndex = i;
        } else {
          discardSlotIndex = i;
        }
      }
    }

    return {
      moveX: axisValue(this.right, this.left),
      moveY: axisValue(this.down, this.up),
      dashPressed: this.dash.isDown,
      interactPressed: this.interact.isDown,
      discardSlotIndex,
      secureSlotIndex,
    };
  }
}

function axisValue(
  positive: Phaser.Input.Keyboard.Key,
  negative: Phaser.Input.Keyboard.Key,
): -1 | 0 | 1 {
  if (positive.isDown === negative.isDown) {
    return 0;
  }
  return positive.isDown ? 1 : -1;
}
