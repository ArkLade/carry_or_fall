import { expect, test } from "@playwright/test";
import { ALL_SKILLS } from "@carry-or-fall/game-content";

import { getActiveSceneKey, getWorld, gotoGame, pressKey, startRunWithLoadout } from "./helpers";

test.describe("LoadoutScene → PlayScene handoff (M3.8, docs/M3_ISSUES.md M3.8)", () => {
  test("boots into LoadoutScene, not PlayScene", async ({ page }) => {
    await gotoGame(page);
    expect(await getActiveSceneKey(page)).toBe("loadout");
  });

  test("Enter with the default loadout starts a run carrying that loadout", async ({ page }) => {
    await gotoGame(page);
    await pressKey(page, "Enter");
    await page.waitForFunction(
      () => window.__CARRY_OR_FALL_DEBUG__?.getActiveSceneKey() === "play",
    );

    expect(await getActiveSceneKey(page)).toBe("play");
    const world = await getWorld(page);
    const loadoutIds = world.player.skillLoadout.map((skill) => skill.id).sort();
    expect(loadoutIds).toEqual(["bulwark_strike", "extended_reach", "ricochet"].sort());
  });

  test("a custom loadout is carried into the run exactly as selected", async ({ page }) => {
    await gotoGame(page);
    await startRunWithLoadout(page, ["multishot", "piercing_rounds", "homing_arrows"]);

    const world = await getWorld(page);
    const loadoutIds = world.player.skillLoadout.map((skill) => skill.id).sort();
    expect(loadoutIds).toEqual(["homing_arrows", "multishot", "piercing_rounds"].sort());
  });

  test("toggling every skill on then off leaves an empty, legal loadout", async ({ page }) => {
    await gotoGame(page);
    await startRunWithLoadout(page, []);
    const world = await getWorld(page);
    expect(world.player.skillLoadout).toEqual([]);
  });

  test("an over-budget toggle is refused: the 2-slot skill plus two 1-slot skills never all end up selected", async ({
    page,
  }) => {
    await gotoGame(page);
    // returning_shot (2 slots) + ricochet (1) + piercing_rounds (1) = 4, over budget.
    await startRunWithLoadout(page, ["returning_shot", "ricochet", "piercing_rounds"]);
    const world = await getWorld(page);
    const totalSlotCost = world.player.skillLoadout.reduce(
      (total, skill) => total + skill.slotCost,
      0,
    );
    expect(totalSlotCost).toBeLessThanOrEqual(3);
    // Every skill that DID make it in must be a real, recognized skill.
    for (const skill of world.player.skillLoadout) {
      expect(ALL_SKILLS.map((candidate) => candidate.id)).toContain(skill.id);
    }
  });
});
