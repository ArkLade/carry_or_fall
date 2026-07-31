/**
 * Enemy content definitions (`docs/CONTENT_AUTHORING.md` §6). Pure data — this
 * chunk adds the Chaser's stats only; its chasing behavior, health/death
 * transitions, and contact-damage application are engine logic for a later
 * chunk (M1.9/M1.10) and are not implemented here.
 *
 * Provenance (`docs/M1_EXECUTION_PLAN.md` §4): the Chaser is described only
 * qualitatively in concept §14.2 ("moves directly toward the nearest player;
 * basic contact or melee damage; low complexity"); these numbers are proposed
 * and balance-deferred.
 */
import type { ContentDefinition } from "./index";

export interface EnemyDefinition extends ContentDefinition {
  readonly kind: "enemy";
  readonly behavior: "chaser" | "ranged" | "heavy";
  readonly health: number;
  readonly moveSpeed: number;
  readonly contactDamage: number;
  /** How often a touching enemy re-applies `contactDamage`, in milliseconds. */
  readonly contactDamageIntervalMs: number;
}

export const chaser: EnemyDefinition = {
  id: "chaser",
  kind: "enemy",
  behavior: "chaser",
  // Raised 20 -> 100 for M4 prep: at 20 health a chaser died to a single
  // basic_sword swing (12 damage) plus a stray hit, so no fight lasted long
  // enough for skill effects, stun, or shield to matter in a playtest. At 100
  // a sword kill takes 9 landed swings, which is what makes those systems
  // observable. Still proposed and balance-deferred, like every other number
  // in this file.
  health: 100,
  moveSpeed: 90,
  contactDamage: 5,
  contactDamageIntervalMs: 500,
} as const;
