/**
 * End-to-end verification that equipped skills actually apply in a running
 * game (§38 M3 exit criterion 1, "supported combinations work"). 300+ unit
 * tests already prove every effect function is individually correct, so this
 * suite exists specifically to catch a wiring defect no unit test can see —
 * now across the network boundary as well: real keyboard/mouse input into the
 * canvas, through the loadout picker, into the room's join options, through the
 * server's simulation, and back out as authoritative state.
 *
 * Two M3-era assertions moved or went away when the simulation moved server-side
 * (M4.4). The effective weapon's `recoveryMs` and `stunChance`, and a
 * projectile's `postBounceDamageMultiplier`, are no longer sent to clients:
 * technical plan §10.3 publishes what a client needs to render, and those three
 * have no rendering purpose. `swift_strikes`'s recovery reduction is covered by
 * `packages/simulation-core`'s unit and caps-under-load tests; `stunning_blows`
 * is covered better here than before, by asserting the enemy actually ends up
 * stunned rather than that a probability was written into a weapon copy.
 */
import { basicBow, basicSword } from "@carry-or-fall/game-content";
import { expect, test } from "@playwright/test";

import {
  aimAt,
  attackChaserUntil,
  dieToChasers,
  getLocalPlayer,
  getPrivateState,
  getSnapshot,
  gotoGame,
  nearestEnemy,
  pickUpAt,
  fireAndObserve,
  startRunWithLoadout,
  waitForSnapshot,
  walkToArenaPoint,
} from "./helpers";

/** Fire once and wait for the server to publish the resulting projectiles. */
async function fireAndWait(page: import("@playwright/test").Page) {
  await aimAt(page, 700, 270);
  return fireAndObserve(page);
}

/**
 * Swing and catch the swing while it is in its active window. The window is
 * 120 ms wide, so the button is held (which restarts a swing every cooldown)
 * and the snapshot polled quickly until one is published, rather than swinging
 * once and hoping the sample lands inside it.
 */
async function swingAndWait(page: import("@playwright/test").Page) {
  await aimAt(page, 700, 270);
  await page.mouse.down({ button: "left" });
  try {
    return await waitForSnapshot(
      page,
      (view) => view.players.some((player) => player.swingActive),
      10_000,
      25,
    );
  } finally {
    await page.mouse.up({ button: "left" });
  }
}

test.describe("each skill applies alone (M3.3, §38 M3 exit criterion 1)", () => {
  test("multishot adds to the fired projectile count", async ({ page }) => {
    await gotoGame(page);
    await startRunWithLoadout(page, ["multishot"]);
    const snapshot = await fireAndWait(page);
    expect(snapshot.projectiles.length).toBe((basicBow.projectileCount ?? 0) + 2);
  });

  test("ricochet seeds a bounce budget on the fired projectile", async ({ page }) => {
    await gotoGame(page);
    await startRunWithLoadout(page, ["ricochet"]);
    const snapshot = await fireAndWait(page);
    expect(snapshot.projectiles).toHaveLength(1);
    expect(snapshot.projectiles[0]!.bouncesRemaining).toBe(1);
  });

  test("piercing_rounds seeds a pierce budget on the fired projectile", async ({ page }) => {
    await gotoGame(page);
    await startRunWithLoadout(page, ["piercing_rounds"]);
    const snapshot = await fireAndWait(page);
    expect(snapshot.projectiles).toHaveLength(1);
    expect(snapshot.projectiles[0]!.piercesRemaining).toBe(2);
  });

  test("returning_shot marks the fired projectile as able to return", async ({ page }) => {
    await gotoGame(page);
    await startRunWithLoadout(page, ["returning_shot"]);
    const snapshot = await fireAndWait(page);
    expect(snapshot.projectiles).toHaveLength(1);
    expect(snapshot.projectiles[0]!.canReturn).toBe(true);
  });

  test("homing_arrows seeds a nonzero homing strength on the fired projectile", async ({
    page,
  }) => {
    await gotoGame(page);
    await startRunWithLoadout(page, ["homing_arrows"]);
    const snapshot = await fireAndWait(page);
    expect(snapshot.projectiles).toHaveLength(1);
    expect(snapshot.projectiles[0]!.homingStrength).toBeCloseTo(0.35);
  });

  test("every fired projectile is attributed to the player who fired it", async ({ page }) => {
    await gotoGame(page);
    await startRunWithLoadout(page, ["multishot"]);
    const snapshot = await fireAndWait(page);
    const localPlayer = await getLocalPlayer(page);
    for (const projectile of snapshot.projectiles) {
      expect(projectile.ownerId).toBe(localPlayer.id);
    }
  });

  test("extended_reach widens the swing the server actually resolves hits with", async ({
    page,
  }) => {
    await gotoGame(page);
    await startRunWithLoadout(page, ["extended_reach"]);
    const snapshot = await swingAndWait(page);
    const swinging = snapshot.players.find((player) => player.swingActive)!;
    expect(swinging.swingRangePx).toBeCloseTo(basicSword.rangePx! * 1.35);
  });

  test("wide_arc widens the swing the server actually resolves hits with", async ({ page }) => {
    await gotoGame(page);
    await startRunWithLoadout(page, ["wide_arc"]);
    const snapshot = await swingAndWait(page);
    const swinging = snapshot.players.find((player) => player.swingActive)!;
    expect(swinging.swingArcDegrees).toBe(basicSword.arcDegrees! + 45);
  });

  test("stunning_blows actually stuns a chaser it lands on", async ({ page }) => {
    test.setTimeout(120_000);
    await gotoGame(page);
    await startRunWithLoadout(page, ["stunning_blows"]);
    const snapshot = await getSnapshot(page);
    const player = await getLocalPlayer(page);
    const enemyStart = nearestEnemy(snapshot, player)!;

    await walkToArenaPoint(page, enemyStart.x, enemyStart.y, 25_000);
    const stunned = await attackChaserUntil(
      page,
      (view) => view.enemies.some((enemy) => enemy.stunnedMs > 0),
      45_000,
    );
    expect(stunned.enemies.some((enemy) => enemy.stunnedMs > 0)).toBe(true);
  });

  test("bulwark_strike grants shield on a landed melee hit against the real chaser", async ({
    page,
  }) => {
    test.setTimeout(120_000);
    await gotoGame(page);
    await startRunWithLoadout(page, ["bulwark_strike"]);
    const player = await getLocalPlayer(page);
    expect(player.shieldHp).toBe(0);
    const playerId = player.id;
    const snapshot = await getSnapshot(page);
    const enemyStart = nearestEnemy(snapshot, player)!;

    // The chasers always move toward the nearest player; walk to meet the
    // closest one partway rather than assuming a fixed distance.
    await walkToArenaPoint(page, enemyStart.x, enemyStart.y, 25_000);

    const shieldedView = await attackChaserUntil(
      page,
      (view) => view.players.some((entry) => entry.id === playerId && entry.shieldHp > 0),
      45_000,
    );
    const shieldedPlayer = shieldedView.players.find((entry) => entry.id === playerId);
    expect(shieldedPlayer).toBeDefined();
    expect(shieldedPlayer!.shieldHp).toBeGreaterThan(0);
  });
});

test.describe("three-skill combinations apply together (M3.3)", () => {
  test("ricochet + piercing_rounds + homing_arrows all apply to the same fired projectile", async ({
    page,
  }) => {
    await gotoGame(page);
    await startRunWithLoadout(page, ["ricochet", "piercing_rounds", "homing_arrows"]);
    const snapshot = await fireAndWait(page);
    expect(snapshot.projectiles).toHaveLength(1);
    const projectile = snapshot.projectiles[0]!;
    expect(projectile.bouncesRemaining).toBe(1);
    expect(projectile.piercesRemaining).toBe(2);
    expect(projectile.homingStrength).toBeCloseTo(0.35);
  });
});

test.describe("wildcard skill chip (M3.7)", () => {
  test("picking up a chip sets the wildcard slot", async ({ page }) => {
    test.setTimeout(90_000);
    await gotoGame(page);
    await startRunWithLoadout(page, []); // empty permanent loadout isolates the wildcard
    let privateState = await getPrivateState(page);
    expect(privateState.wildcardSkillId).toBeNull();

    const snapshot = await getSnapshot(page);
    expect(snapshot.skillChips.length).toBeGreaterThan(0);
    const chip = snapshot.skillChips[0]!;

    await walkToArenaPoint(page, chip.x, chip.y, 25_000);
    await pickUpAt(page, chip.x, chip.y, { kind: "skill_chip", id: chip.id });
    privateState = await getPrivateState(page);
    expect(privateState.wildcardSkillId).toBe(chip.skillId);
  });

  test("picking up a second chip replaces the wildcard, with no refusal", async ({ page }) => {
    test.setTimeout(120_000);
    await gotoGame(page);
    await startRunWithLoadout(page, []);
    const snapshot = await getSnapshot(page);
    expect(snapshot.skillChips).toHaveLength(2);

    const [firstChip, secondChip] = snapshot.skillChips;
    await walkToArenaPoint(page, firstChip!.x, firstChip!.y, 25_000);
    await pickUpAt(page, firstChip!.x, firstChip!.y, {
      kind: "skill_chip",
      id: firstChip!.id,
    });
    expect((await getPrivateState(page)).wildcardSkillId).toBe(firstChip!.skillId);

    await walkToArenaPoint(page, secondChip!.x, secondChip!.y, 30_000);
    await pickUpAt(page, secondChip!.x, secondChip!.y, {
      kind: "skill_chip",
      id: secondChip!.id,
    });

    // Never refused, per concept §10: a new chip always replaces the old one.
    expect((await getPrivateState(page)).wildcardSkillId).toBe(secondChip!.skillId);
  });

  test("the wildcard is lost on death while the three permanent skills survive", async ({
    page,
  }) => {
    test.setTimeout(150_000);
    await gotoGame(page);
    await startRunWithLoadout(page, ["ricochet", "extended_reach", "bulwark_strike"]);
    const permanentIds = [...(await getPrivateState(page)).skillIds].sort();
    expect(permanentIds).toHaveLength(3);

    const snapshot = await getSnapshot(page);
    const chip = snapshot.skillChips[0]!;
    await walkToArenaPoint(page, chip.x, chip.y, 25_000);
    await pickUpAt(page, chip.x, chip.y, { kind: "skill_chip", id: chip.id });
    expect((await getPrivateState(page)).wildcardSkillId).not.toBeNull();

    // Let the chasers close in and kill the player through repeated contact
    // damage — the real death path, not a fabricated one.
    const dead = await dieToChasers(page);
    expect(dead.alive).toBe(false);

    const afterDeath = await getPrivateState(page);
    expect(afterDeath.wildcardSkillId).toBeNull();
    expect([...afterDeath.skillIds].sort()).toEqual(permanentIds);
  });
});
