import { describe, expect, it } from "vitest";
import { ALL_SKILLS } from "@carry-or-fall/game-content";

import { chooseSkillChipDrop, isNearSkillChip, spawnSkillChip } from "./skill-chip";
import { createRng } from "./prng";

describe("chooseSkillChipDrop", () => {
  it("chooses a skill from ALL_SKILLS", () => {
    const skill = chooseSkillChipDrop(createRng(1));
    expect(ALL_SKILLS).toContain(skill);
  });

  it("is deterministic: the same seed chooses the same skill", () => {
    const a = chooseSkillChipDrop(createRng(42));
    const b = chooseSkillChipDrop(createRng(42));
    expect(a).toBe(b);
  });
});

describe("spawnSkillChip / isNearSkillChip", () => {
  it("places a chip at the given position under the given id", () => {
    const skill = ALL_SKILLS[0]!;
    const chip = spawnSkillChip(skill, { x: 10, y: 20 }, "chip-0");
    expect(chip).toEqual({
      id: "chip-0",
      definition: skill,
      position: { x: 10, y: 20 },
      radius: 20,
    });
  });

  it("detects overlap when the actor is close enough", () => {
    const chip = spawnSkillChip(ALL_SKILLS[0]!, { x: 0, y: 0 }, "chip-0");
    expect(isNearSkillChip({ position: { x: 5, y: 0 }, radius: 16 }, chip)).toBe(true);
  });

  it("detects no overlap when the actor is far away", () => {
    const chip = spawnSkillChip(ALL_SKILLS[0]!, { x: 0, y: 0 }, "chip-0");
    expect(isNearSkillChip({ position: { x: 5000, y: 0 }, radius: 16 }, chip)).toBe(false);
  });
});
