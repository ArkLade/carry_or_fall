/**
 * Captures aim (M1.4) and attack-trigger intent via the mouse. This is the
 * rest of the client's input-intent path (`docs/M1_EXECUTION_PLAN.md` §2.1):
 * the client only reports where the pointer is and which buttons are held
 * (technical plan §5.1); it never decides a hit or outcome itself.
 *
 * M1 has no weapon-equip/inventory system (that is M2's ground-weapon-swap
 * work), so both M1 weapons are always available at once: the left mouse
 * button triggers the sword (melee), the right mouse button triggers the bow
 * (ranged). This mapping is a local-only, temporary input-scheme choice, not
 * a documented control (concept §13.1 lists a single "left click: basic
 * attack"); it exists only so a human can play-test both weapons in this
 * milestone.
 */
import Phaser from "phaser";

/** The minimal origin shape aim is measured from: the player's last authoritative position. */
interface AimOrigin {
  readonly x: number;
  readonly y: number;
}

export class PointerInput {
  private readonly scene: Phaser.Scene;

  constructor(scene: Phaser.Scene) {
    this.scene = scene;
    // Right-click triggers the bow (see the class doc); without this, the
    // browser's context menu would pop up over the canvas on every shot.
    scene.input.mouse?.disableContextMenu();
  }

  /** The angle (radians) from `origin` to the current pointer position, unnormalized. */
  aimAngleFrom(origin: AimOrigin): number {
    const pointer = this.scene.input.activePointer;
    return Math.atan2(pointer.worldY - origin.y, pointer.worldX - origin.x);
  }

  isAttackPressed(): boolean {
    return this.scene.input.activePointer.leftButtonDown();
  }

  isSecondaryAttackPressed(): boolean {
    return this.scene.input.activePointer.rightButtonDown();
  }
}
