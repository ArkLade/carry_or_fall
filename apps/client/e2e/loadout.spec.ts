/**
 * The loadout picker → match handoff. From M4 the loadout is not handed to a
 * local world: it becomes the room's **join options**, and the server
 * re-validates it through the same `createSkillLoadout` before admitting the
 * player. So what these tests really check is that the selection a human makes
 * survives the network boundary and is the one the server is playing with —
 * read back from that player's own private state, which only they receive.
 */
import { expect, test } from "@playwright/test";
import { ALL_SKILLS } from "@carry-or-fall/game-content";

import {
  DEFAULT_SKILL_LOADOUT_IDS,
  enterMatch,
  getActiveSceneKey,
  getPrivateState,
  gotoGame,
  startRunWithLoadout,
} from "./helpers";

test.describe("LoadoutScene → match handoff", () => {
  test("boots into LoadoutScene, not straight into a match", async ({ page }) => {
    await gotoGame(page);
    expect(await getActiveSceneKey(page)).toBe("loadout");
  });

  test("Enter with the default loadout joins a match carrying that loadout", async ({ page }) => {
    await gotoGame(page);
    await enterMatch(page);

    expect(await getActiveSceneKey(page)).toBe("play");
    const state = await getPrivateState(page);
    expect([...state.skillIds].sort()).toEqual([...DEFAULT_SKILL_LOADOUT_IDS].sort());
  });

  test("a custom loadout is carried into the match exactly as selected", async ({ page }) => {
    await gotoGame(page);
    await startRunWithLoadout(page, ["multishot", "piercing_rounds", "homing_arrows"]);

    const state = await getPrivateState(page);
    expect([...state.skillIds].sort()).toEqual(
      ["homing_arrows", "multishot", "piercing_rounds"].sort(),
    );
  });

  test("toggling every skill on then off leaves an empty, legal loadout", async ({ page }) => {
    await gotoGame(page);
    await startRunWithLoadout(page, []);
    expect((await getPrivateState(page)).skillIds).toEqual([]);
  });

  test("an over-budget toggle is refused: the 2-slot skill plus two 1-slot skills never all end up selected", async ({
    page,
  }) => {
    await gotoGame(page);
    // returning_shot (2 slots) + ricochet (1) + piercing_rounds (1) = 4, over budget.
    await startRunWithLoadout(page, ["returning_shot", "ricochet", "piercing_rounds"]);
    const state = await getPrivateState(page);

    const totalSlotCost = state.skillIds.reduce((total, id) => {
      const skill = ALL_SKILLS.find((candidate) => candidate.id === id);
      return total + (skill?.slotCost ?? 0);
    }, 0);
    expect(totalSlotCost).toBeLessThanOrEqual(3);
    // Every skill the *server* is playing with must be a real, recognized one.
    for (const id of state.skillIds) {
      expect(ALL_SKILLS.map((candidate) => candidate.id)).toContain(id);
    }
  });
});
