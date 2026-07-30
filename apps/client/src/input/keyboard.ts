/**
 * Captures WASD movement intent. This is the client half of the input-intent
 * path (`docs/M1_EXECUTION_PLAN.md` §2.1): the client decides only what keys
 * are held (technical plan §5.1) and hands that intent to the simulation
 * through the single seam in `PlayScene`; it never decides an outcome itself.
 */
import Phaser from "phaser";
import type { InputState } from "@carry-or-fall/simulation-core";

/** The movement subset of `InputState`; `PlayScene` merges this with `PointerInput`'s aim/attack fields. */
export type MovementInput = Pick<InputState, "moveX" | "moveY">;

export class KeyboardInput {
  private readonly up: Phaser.Input.Keyboard.Key;
  private readonly down: Phaser.Input.Keyboard.Key;
  private readonly left: Phaser.Input.Keyboard.Key;
  private readonly right: Phaser.Input.Keyboard.Key;

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
  }

  /** The current normalized movement intent, read fresh each call. */
  getInputState(): MovementInput {
    return {
      moveX: axisValue(this.right, this.left),
      moveY: axisValue(this.down, this.up),
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
