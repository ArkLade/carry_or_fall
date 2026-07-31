import { describe, expect, it } from "vitest";

import { basicBow, basicSword, type WeaponDefinition } from "./weapons";

function expectCommonShape(weapon: WeaponDefinition): void {
  expect(weapon.kind).toBe("weapon");
  expect(weapon.id.length).toBeGreaterThan(0);
  expect(weapon.damage).toBeGreaterThan(0);
  expect(weapon.attackIntervalMs).toBeGreaterThan(0);
  expect(Number.isInteger(weapon.limits.maxProjectilesPerAttack)).toBe(true);
  expect(Number.isInteger(weapon.limits.maxBounces)).toBe(true);
  expect(Number.isInteger(weapon.limits.maxPierces)).toBe(true);
  expect(weapon.limits.maxProjectilesPerAttack).toBeGreaterThanOrEqual(0);
  expect(weapon.limits.maxBounces).toBeGreaterThanOrEqual(0);
  expect(weapon.limits.maxPierces).toBeGreaterThanOrEqual(0);
}

describe("basicSword", () => {
  it("satisfies the shared weapon shape", () => {
    expectCommonShape(basicSword);
  });

  it("is a melee weapon with melee-only fields set and no projectile limits", () => {
    expect(basicSword.category).toBe("melee");
    expect(basicSword.rangePx).toBeGreaterThan(0);
    expect(basicSword.arcDegrees).toBeGreaterThan(0);
    expect(basicSword.windupMs).toBeGreaterThanOrEqual(0);
    expect(basicSword.activeMs).toBeGreaterThan(0);
    expect(basicSword.recoveryMs).toBeGreaterThanOrEqual(0);
    // A melee weapon must never carry projectile limits above zero: it has no
    // ranged behavior, so a later skill/loot bug granting it projectiles must
    // still be capped at zero by its own declared ceiling.
    expect(basicSword.limits.maxProjectilesPerAttack).toBe(0);
  });
});

describe("basicBow", () => {
  it("satisfies the shared weapon shape", () => {
    expectCommonShape(basicBow);
  });

  it("is a ranged weapon with a positive projectile speed and count", () => {
    expect(basicBow.category).toBe("ranged");
    expect(basicBow.projectileSpeed).toBeGreaterThan(0);
    expect(basicBow.projectileCount).toBeGreaterThan(0);
    expect(basicBow.spreadDegrees).toBeGreaterThanOrEqual(0);
  });

  it("declares the projectile/bounce/pierce limits documented in concept §29.1", () => {
    // Concept §29.1 fixes these three numbers for basic_bow specifically (unlike
    // basic_sword's proposed values); a drift here means the definition no
    // longer matches its documented source.
    expect(basicBow.limits.maxProjectilesPerAttack).toBe(8);
    expect(basicBow.limits.maxBounces).toBe(3);
    expect(basicBow.limits.maxPierces).toBe(3);
  });
});
