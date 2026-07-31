/**
 * The wildcard skill chip: choosing what a scattered pickup grants, placing
 * it in the world, and picking it up (M3.7, `docs/M3_ISSUES.md` M3.7). The
 * skill counterpart of `loot-drop.ts`. Scattered on the local test map at run
 * start, drawn from the same `ALL_SKILLS` pool the permanent loadout uses
 * (`docs/M3_ISSUES.md` §1: boss cores, not this pool, are the boss-exclusive
 * source, M7).
 */
import { ALL_SKILLS, type SkillDefinition } from "@carry-or-fall/game-content";

import { circleIntersectsCircle } from "./collision";
import type { Rng } from "./prng";
import type { SkillChip, Vec2 } from "./world";

/** Proposed pickup radius for a skill-chip entity, in pixels — matches `loot-drop.ts`'s `GROUND_LOOT_RADIUS_PX`. */
export const SKILL_CHIP_RADIUS_PX = 20;

/** Choose one skill from `table` via the seeded RNG (no `Math.random`). */
export function chooseSkillChipDrop(
  rng: Rng,
  table: readonly SkillDefinition[] = ALL_SKILLS,
): SkillDefinition {
  return table[rng.nextInt(table.length)]!;
}

/**
 * Place `definition` on the ground at `position` under the caller-supplied
 * `id`, mirroring `loot-drop.ts`'s `spawnGroundLoot` id-ownership pattern (no
 * hidden module-level counter).
 */
export function spawnSkillChip(
  definition: SkillDefinition,
  position: Vec2,
  id: string,
  radius: number = SKILL_CHIP_RADIUS_PX,
): SkillChip {
  return { id, definition, position, radius };
}

/** Whether `actor` (the player) currently overlaps `chip`'s pickup radius. */
export function isNearSkillChip(
  actor: { readonly position: Vec2; readonly radius: number },
  chip: SkillChip,
): boolean {
  return circleIntersectsCircle(
    { position: actor.position, radius: actor.radius },
    { position: chip.position, radius: chip.radius },
  );
}
