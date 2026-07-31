/**
 * End-to-end verification that equipped skills actually apply in a running
 * game (§38 M3 exit criterion 1, "supported combinations work"). Diagnostic
 * task: 273 unit tests already prove every effect function is individually
 * correct, so this suite exists specifically to catch a wiring defect
 * between the real client (LoadoutScene → PlayScene → real keyboard/mouse
 * input) and simulation-core that no unit test can see. Every assertion
 * reads state through the dev-only debug hook after driving the page with
 * real input — never by calling simulation-core functions directly.
 */
import { basicBow, basicSword } from "@carry-or-fall/game-content";
import { expect, test } from "@playwright/test";

import {
  aimAt,
  attackChaserUntil,
  getWorld,
  gotoGame,
  interactFor,
  meleeAttackFor,
  rangedAttackFor,
  startRunWithLoadout,
  walkToward,
} from "./helpers";

test.describe("each skill applies alone (M3.3, §38 M3 exit criterion 1)", () => {
  test("multishot adds to the fired projectile count", async ({ page }) => {
    await gotoGame(page);
    await startRunWithLoadout(page, ["multishot"]);
    await aimAt(page, 700, 270);
    await rangedAttackFor(page, 80);
    const world = await getWorld(page);
    expect(world.projectiles.length).toBe((basicBow.projectileCount ?? 0) + 2);
  });

  test("ricochet seeds a bounce budget and the post-bounce damage multiplier on the fired projectile", async ({
    page,
  }) => {
    await gotoGame(page);
    await startRunWithLoadout(page, ["ricochet"]);
    await aimAt(page, 700, 270);
    await rangedAttackFor(page, 80);
    const world = await getWorld(page);
    expect(world.projectiles).toHaveLength(1);
    expect(world.projectiles[0]!.bouncesRemaining).toBe(1);
    expect(world.projectiles[0]!.postBounceDamageMultiplier).toBeCloseTo(0.8);
  });

  test("piercing_rounds seeds a pierce budget on the fired projectile", async ({ page }) => {
    await gotoGame(page);
    await startRunWithLoadout(page, ["piercing_rounds"]);
    await aimAt(page, 700, 270);
    await rangedAttackFor(page, 80);
    const world = await getWorld(page);
    expect(world.projectiles).toHaveLength(1);
    expect(world.projectiles[0]!.piercesRemaining).toBe(2);
  });

  test("returning_shot marks the fired projectile as able to return", async ({ page }) => {
    await gotoGame(page);
    await startRunWithLoadout(page, ["returning_shot"]);
    await aimAt(page, 700, 270);
    await rangedAttackFor(page, 80);
    const world = await getWorld(page);
    expect(world.projectiles).toHaveLength(1);
    expect(world.projectiles[0]!.canReturn).toBe(true);
  });

  test("homing_arrows seeds a nonzero homing strength on the fired projectile", async ({
    page,
  }) => {
    await gotoGame(page);
    await startRunWithLoadout(page, ["homing_arrows"]);
    await aimAt(page, 700, 270);
    await rangedAttackFor(page, 80);
    const world = await getWorld(page);
    expect(world.projectiles).toHaveLength(1);
    expect(world.projectiles[0]!.homingStrength).toBeCloseTo(0.35);
  });

  test("extended_reach widens the effective melee weapon's range", async ({ page }) => {
    await gotoGame(page);
    await startRunWithLoadout(page, ["extended_reach"]);
    await aimAt(page, 700, 270);
    await meleeAttackFor(page, 80);
    const world = await getWorld(page);
    expect(world.player.meleeAttack).not.toBeNull();
    expect(world.player.meleeAttack!.weapon.rangePx).toBeCloseTo(basicSword.rangePx! * 1.35);
  });

  test("swift_strikes shortens the effective melee weapon's recovery", async ({ page }) => {
    await gotoGame(page);
    await startRunWithLoadout(page, ["swift_strikes"]);
    await aimAt(page, 700, 270);
    await meleeAttackFor(page, 80);
    const world = await getWorld(page);
    expect(world.player.meleeAttack).not.toBeNull();
    expect(world.player.meleeAttack!.weapon.recoveryMs).toBeCloseTo(basicSword.recoveryMs! * 0.6);
  });

  test("stunning_blows adds to the effective melee weapon's stun chance", async ({ page }) => {
    await gotoGame(page);
    await startRunWithLoadout(page, ["stunning_blows"]);
    await aimAt(page, 700, 270);
    await meleeAttackFor(page, 80);
    const world = await getWorld(page);
    expect(world.player.meleeAttack).not.toBeNull();
    expect(world.player.meleeAttack!.weapon.stunChance).toBeCloseTo(0.35);
  });

  test("wide_arc widens the effective melee weapon's arc", async ({ page }) => {
    await gotoGame(page);
    await startRunWithLoadout(page, ["wide_arc"]);
    await aimAt(page, 700, 270);
    await meleeAttackFor(page, 80);
    const world = await getWorld(page);
    expect(world.player.meleeAttack).not.toBeNull();
    expect(world.player.meleeAttack!.weapon.arcDegrees).toBe(basicSword.arcDegrees! + 45);
  });

  test("bulwark_strike grants shield on a landed melee hit against the real chaser", async ({
    page,
  }) => {
    test.setTimeout(60_000);
    await gotoGame(page);
    await startRunWithLoadout(page, ["bulwark_strike"]);
    let world = await getWorld(page);
    expect(world.player.shieldHp).toBe(0);
    const enemyStart = world.enemies[0]!.position;

    // The chaser always moves toward the player; walk to meet it partway
    // rather than assuming a fixed distance (`docs/M1_EXECUTION_PLAN.md`
    // M1.9's chase behavior applies regardless of which candidate spawn
    // point the seeded RNG picked this run).
    await walkToward(page, enemyStart.x, enemyStart.y, 20_000);

    world = await attackChaserUntil(page, (w) => w.player.shieldHp > 0, 15_000);
    expect(world.player.shieldHp).toBeGreaterThan(0);
  });
});

test.describe("three-skill combinations apply together (M3.3)", () => {
  test("ricochet + piercing_rounds + homing_arrows all apply to the same fired projectile", async ({
    page,
  }) => {
    await gotoGame(page);
    await startRunWithLoadout(page, ["ricochet", "piercing_rounds", "homing_arrows"]);
    await aimAt(page, 700, 270);
    await rangedAttackFor(page, 80);
    const world = await getWorld(page);
    expect(world.projectiles).toHaveLength(1);
    const projectile = world.projectiles[0]!;
    expect(projectile.bouncesRemaining).toBe(1);
    expect(projectile.piercesRemaining).toBe(2);
    expect(projectile.homingStrength).toBeCloseTo(0.35);
  });

  test("extended_reach + swift_strikes + stunning_blows all apply to the same swing", async ({
    page,
  }) => {
    await gotoGame(page);
    await startRunWithLoadout(page, ["extended_reach", "swift_strikes", "stunning_blows"]);
    await aimAt(page, 700, 270);
    await meleeAttackFor(page, 80);
    const world = await getWorld(page);
    expect(world.player.meleeAttack).not.toBeNull();
    const weapon = world.player.meleeAttack!.weapon;
    expect(weapon.rangePx).toBeCloseTo(basicSword.rangePx! * 1.35);
    expect(weapon.recoveryMs).toBeCloseTo(basicSword.recoveryMs! * 0.6);
    expect(weapon.stunChance).toBeCloseTo(0.35);
  });
});

test.describe("wildcard skill chip (M3.7)", () => {
  test("picking up a chip sets the wildcard slot, and it applies alongside an empty permanent loadout", async ({
    page,
  }) => {
    await gotoGame(page);
    await startRunWithLoadout(page, []); // empty permanent loadout isolates the wildcard's own effect
    let world = await getWorld(page);
    expect(world.player.wildcardSkill).toBeNull();
    expect(world.skillChips.length).toBeGreaterThan(0);

    const chip = world.skillChips[0]!;
    await walkToward(page, chip.position.x, chip.position.y);
    await interactFor(page, 200);

    world = await getWorld(page);
    expect(world.player.wildcardSkill).not.toBeNull();
    const wildcard = world.player.wildcardSkill!;

    // Whatever skill the seeded chip happened to grant, exercise the
    // matching weapon category and confirm the wildcard's own declared
    // effects are the ones observed (the permanent loadout is empty, so
    // nothing else could produce them).
    if (wildcard.requiresTags.includes("projectile")) {
      await aimAt(page, 700, 270);
      await rangedAttackFor(page, 80);
      const afterFire = await getWorld(page);
      expect(afterFire.projectiles.length).toBeGreaterThan(0);
      const projectile = afterFire.projectiles[0]!;
      if (wildcard.effects.bounceCountAdd !== undefined) {
        expect(projectile.bouncesRemaining).toBeGreaterThan(0);
      }
      if (wildcard.effects.pierceCountAdd !== undefined) {
        expect(projectile.piercesRemaining).toBeGreaterThan(0);
      }
      if (wildcard.effects.returnEnabled === true) {
        expect(projectile.canReturn).toBe(true);
      }
      if (wildcard.effects.homingStrengthAdd !== undefined) {
        expect(projectile.homingStrength).toBeGreaterThan(0);
      }
      if (wildcard.effects.projectileCountAdd !== undefined) {
        expect(afterFire.projectiles.length).toBeGreaterThan(basicBow.projectileCount ?? 0);
      }
    } else {
      await aimAt(page, 700, 270);
      await meleeAttackFor(page, 80);
      const afterSwing = await getWorld(page);
      expect(afterSwing.player.meleeAttack).not.toBeNull();
      const weapon = afterSwing.player.meleeAttack!.weapon;
      if (wildcard.effects.rangeMultiplierAdd !== undefined) {
        expect(weapon.rangePx!).toBeGreaterThan(basicSword.rangePx!);
      }
      if (wildcard.effects.arcDegreesAdd !== undefined) {
        expect(weapon.arcDegrees!).toBeGreaterThan(basicSword.arcDegrees!);
      }
      if (wildcard.effects.recoveryReductionAdd !== undefined) {
        expect(weapon.recoveryMs!).toBeLessThan(basicSword.recoveryMs!);
      }
      if (wildcard.effects.stunChanceAdd !== undefined) {
        expect(weapon.stunChance!).toBeGreaterThan(0);
      }
    }
  });

  test("picking up a second chip replaces the wildcard, with no refusal", async ({ page }) => {
    test.setTimeout(45_000);
    await gotoGame(page);
    await startRunWithLoadout(page, []);
    let world = await getWorld(page);
    expect(world.skillChips).toHaveLength(2);

    const firstChip = world.skillChips[0]!;
    await walkToward(page, firstChip.position.x, firstChip.position.y);
    await interactFor(page, 200);
    world = await getWorld(page);
    const firstWildcardId = world.player.wildcardSkill?.id;
    expect(firstWildcardId).toBeDefined();
    expect(world.skillChips).toHaveLength(1);

    const secondChip = world.skillChips[0]!;
    await walkToward(page, secondChip.position.x, secondChip.position.y, 20_000);
    await interactFor(page, 200);
    world = await getWorld(page);

    expect(world.skillChips).toHaveLength(0);
    expect(world.player.wildcardSkill).not.toBeNull(); // never refused, per concept §10
    expect(world.player.wildcardSkill!.id).toBe(secondChip.definition.id);
  });

  test("the wildcard applies as a fourth effect alongside a full three-skill permanent loadout", async ({
    page,
  }) => {
    test.setTimeout(45_000);
    await gotoGame(page);
    await startRunWithLoadout(page, ["ricochet", "piercing_rounds", "homing_arrows"]);
    let world = await getWorld(page);
    expect(world.player.skillLoadout).toHaveLength(3);

    const chip = world.skillChips[0]!;
    await walkToward(page, chip.position.x, chip.position.y);
    await interactFor(page, 200);
    world = await getWorld(page);
    expect(world.player.wildcardSkill).not.toBeNull();

    await aimAt(page, 700, 270);
    await rangedAttackFor(page, 80);
    world = await getWorld(page);
    expect(world.projectiles).toHaveLength(1);
    const projectile = world.projectiles[0]!;
    // The three permanent effects must still be present with a wildcard
    // also equipped — the fourth effect layers on, it does not replace them.
    // Lower bounds only (not exact equality): the randomly-chosen wildcard
    // could legally duplicate a permanent skill's effect, which stacks
    // (capped by the shared caps) rather than staying at the solo value.
    expect(projectile.bouncesRemaining).toBeGreaterThanOrEqual(1);
    expect(projectile.piercesRemaining).toBeGreaterThanOrEqual(2);
    expect(projectile.homingStrength).toBeGreaterThanOrEqual(0.35);
  });

  test("the wildcard is lost on death while the three permanent skills survive", async ({
    page,
  }) => {
    test.setTimeout(60_000);
    await gotoGame(page);
    await startRunWithLoadout(page, ["ricochet", "extended_reach", "bulwark_strike"]);
    let world = await getWorld(page);
    const permanentIds = world.player.skillLoadout.map((skill) => skill.id).sort();

    const chip = world.skillChips[0]!;
    await walkToward(page, chip.position.x, chip.position.y);
    await interactFor(page, 200);
    world = await getWorld(page);
    expect(world.player.wildcardSkill).not.toBeNull();

    // Walk into the chaser and stay put, letting repeated contact damage
    // kill the player — the real death path, not a fabricated one.
    const enemyStart = world.enemies[0]!.position;
    await walkToward(page, enemyStart.x, enemyStart.y, 20_000);
    world = await getWorld(page);
    let guard = 0;
    while (world.player.alive && guard < 200) {
      await page.waitForTimeout(200);
      world = await getWorld(page);
      guard += 1;
    }

    expect(world.player.alive).toBe(false);
    expect(world.player.wildcardSkill).toBeNull();
    expect(world.player.skillLoadout.map((skill) => skill.id).sort()).toEqual(permanentIds);
  });
});
