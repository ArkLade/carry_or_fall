/**
 * Concept §11's three-way decision, as pure rules (M7.3,
 * `docs/M7_ISSUES.md` §11.1–§11.4).
 *
 * These are the simulation-level half of §38 M7's first exit criterion: what
 * each branch *does*, driven through `stepSimulation` where the branch involves
 * a step, and through `inventory.ts`/`run-result.ts` where it does not. The
 * network-level half — a client trying to defeat the rules with messages, in
 * orders it should not be able to exploit — is
 * `apps/server/test/boss-core-decision.test.ts`.
 */
import {
  basicBow,
  basicSword,
  chaser,
  honingStone,
  splitReturnCore,
  warden,
} from "@carry-or-fall/game-content";
import { describe, expect, it } from "vitest";

import { activateBossCore, bossCoresIn, createEmptyInventory, secureItem } from "./inventory";
import { buildDeathResult, buildExtractionResult } from "./run-result";
import { createSimulation, NEUTRAL_INPUT, SIMULATION_DT_MS, stepSimulation } from "./simulation";
import type { InputState, Player, World } from "./world";

const ARENA = {
  walls: [],
  enemyDefinition: chaser,
  enemySpawnPoints: [{ x: 5_000, y: 5_000 }],
  enemyCount: 0,
  extractionCandidatePoints: [
    { x: 100, y: 100 },
    { x: 200, y: 100 },
  ],
  seed: 7,
};

/** A one-player world with `core` already in inventory slot 0. */
function worldWithCore(): World {
  const world = createSimulation({
    ...ARENA,
    players: [
      {
        id: "p1",
        position: { x: 400, y: 400 },
        meleeWeapon: basicSword,
        rangedWeapon: basicBow,
      },
    ],
  });
  const inventory = createEmptyInventory().slice();
  inventory[0] = splitReturnCore;
  inventory[1] = honingStone;
  return {
    ...world,
    players: world.players.map((player) => ({ ...player, inventory })),
  };
}

function input(overrides: Partial<InputState> = {}): InputState {
  return { ...NEUTRAL_INPUT, ...overrides };
}

function step(world: World, overrides: Partial<InputState> = {}): World {
  return stepSimulation(world, new Map([["p1", input(overrides)]])).world;
}

function only(world: World): Player {
  return world.players[0]!;
}

describe("option 1 — activate now (concept §11)", () => {
  it("grants the boss skill as the wildcard and takes the core out of the inventory", () => {
    const after = only(step(worldWithCore(), { activateCoreSlotIndex: 0 }));

    expect(after.wildcardSkill?.id).toBe(splitReturnCore.bossCore!.temporarySkillId);
    expect(after.inventory[0]).toBeNull();
    expect(bossCoresIn(after.inventory)).toEqual([]);
  });

  it("cannot then be secured, because there is nothing in the slot to secure", () => {
    // Concept §11's "cannot be secured after activation", implemented as an
    // absence rather than a check (`docs/M7_ISSUES.md` §1.3).
    let world = step(worldWithCore(), { activateCoreSlotIndex: 0 });
    world = step(world, { secureSlotIndex: 0 });

    expect(only(world).secureSlot).toBeNull();
    expect(only(world).wildcardSkill?.id).toBe("split_return");
  });

  it("cannot be secured from any other slot either", () => {
    let world = step(worldWithCore(), { activateCoreSlotIndex: 0 });
    for (let slot = 0; slot < 6; slot += 1) {
      world = step(world, { secureSlotIndex: slot });
    }
    // Slot 1 held ordinary loot, so *that* secures — which is the control: the
    // secure path still works, it just has no core to find.
    expect(only(world).secureSlot?.id).toBe(honingStone.id);
    expect(only(world).secureSlot?.bossCore).toBeUndefined();
  });

  it("resolves activate before secure when both arrive in the same tick", () => {
    const after = only(step(worldWithCore(), { activateCoreSlotIndex: 0, secureSlotIndex: 0 }));

    expect(after.wildcardSkill?.id).toBe("split_return");
    expect(after.secureSlot).toBeNull();
  });

  it("is lost on death, converting nothing", () => {
    let world = step(worldWithCore(), { activateCoreSlotIndex: 0 });
    const dead = buildDeathResult(only(world).inventory, only(world).secureSlot);

    expect(dead.bossCoreIds).toEqual([]);

    // And nothing of it survives on the player either.
    world = {
      ...world,
      players: world.players.map((player) => ({ ...player, health: 0, alive: false })),
    };
    world = step(world);
    expect(only(world).wildcardSkill).toBeNull();
    expect(only(world).runResult?.bossCoreIds).toEqual([]);
  });

  it("does nothing when the slot holds ordinary loot", () => {
    const result = activateBossCore(worldWithCore().players[0]!.inventory, 1);

    expect(result.activated).toBe(false);
    expect(result.skill).toBeNull();
    expect(result.inventory[1]).toBe(honingStone);
  });

  it("does nothing when the slot is empty, and never throws", () => {
    const empty = createEmptyInventory();
    for (const slot of [0, 5, -1, 99, 1.5]) {
      const result = activateBossCore(empty, slot);
      expect(result.activated).toBe(false);
      expect(result.inventory).toBe(empty);
    }
  });

  it("activates once: a second request finds nothing", () => {
    let world = step(worldWithCore(), { activateCoreSlotIndex: 0 });
    const first = only(world).wildcardSkill;
    world = step(world, { activateCoreSlotIndex: 0 });

    expect(only(world).wildcardSkill).toBe(first);
    expect(bossCoresIn(only(world).inventory)).toEqual([]);
  });
});

describe("option 2 — carry normally (concept §11)", () => {
  it("provides no build effect while carried", () => {
    // The core declares no `buildEffects` (`docs/DECISIONS.md` D65), so a
    // carried core must not change the player's derived build at all.
    const withCore = only(step(worldWithCore()));
    const withoutCore = only(
      step({
        ...worldWithCore(),
        players: worldWithCore().players.map((player) => ({
          ...player,
          inventory: createEmptyInventory(),
        })),
      }),
    );

    expect(withCore.maxHealth).toBe(withoutCore.maxHealth);
    expect(withCore.wildcardSkill).toBeNull();
  });

  it("drops on death like ordinary loot, so somebody else can take it", () => {
    // Concept §15.2. The death path already drops the inventory; a core is loot,
    // so this needed no new code — which is the point of D65's shape.
    let world = worldWithCore();
    world = {
      ...world,
      players: world.players.map((player) => ({ ...player, health: 0, alive: false })),
    };
    world = step(world);

    const dropped = world.groundLoot.filter((loot) => loot.definition.id === splitReturnCore.id);
    expect(dropped).toHaveLength(1);
    expect(only(world).runResult?.bossCoreIds).toEqual([]);
  });

  it("converts on extraction, which is how the unlock is earned by carrying", () => {
    const inventory = worldWithCore().players[0]!.inventory;
    const extracted = buildExtractionResult(inventory, null);

    expect(extracted.bossCoreIds).toEqual([splitReturnCore.id]);
  });
});

describe("option 3 — place in the secure slot (concept §11)", () => {
  it("secures like any item, and then provides no combat power", () => {
    const world = step(worldWithCore(), { secureSlotIndex: 0 });
    const after = only(world);

    expect(after.secureSlot?.id).toBe(splitReturnCore.id);
    expect(after.inventory[0]).toBeNull();
    // Securing never grants the skill: concept §11 option 3's "stops providing
    // combat power" is trivially true for a core that never provided any, and
    // the assertion that matters is that securing is not a back door to the
    // wildcard.
    expect(after.wildcardSkill).toBeNull();
  });

  it("survives death and reaches settlement", () => {
    let world = step(worldWithCore(), { secureSlotIndex: 0 });
    world = {
      ...world,
      players: world.players.map((player) => ({ ...player, health: 0, alive: false })),
    };
    world = step(world);

    expect(only(world).runResult?.outcome).toBe("died");
    expect(only(world).runResult?.bossCoreIds).toEqual([splitReturnCore.id]);
  });

  it("cannot then be activated, because the secure slot is not the inventory", () => {
    let world = step(worldWithCore(), { secureSlotIndex: 0 });
    world = step(world, { activateCoreSlotIndex: 0 });

    expect(only(world).wildcardSkill).toBeNull();
    expect(only(world).secureSlot?.id).toBe(splitReturnCore.id);
  });

  it("refuses a second secure, so a core cannot displace one already there", () => {
    let world = step(worldWithCore(), { secureSlotIndex: 1 }); // ordinary loot first
    world = step(world, { secureSlotIndex: 0 }); // then the core

    expect(only(world).secureSlot?.id).toBe(honingStone.id);
    expect(only(world).inventory[0]?.id).toBe(splitReturnCore.id);
  });

  it("reports one core on death and both paths on extraction", () => {
    const inventory = createEmptyInventory().slice();
    inventory[0] = splitReturnCore;

    expect(buildDeathResult(inventory, splitReturnCore).bossCoreIds).toEqual([splitReturnCore.id]);
    expect(buildExtractionResult(inventory, splitReturnCore).bossCoreIds).toEqual([
      splitReturnCore.id,
      splitReturnCore.id,
    ]);
  });

  it("secures nothing when the slot holds ordinary loot and the core is elsewhere", () => {
    const inventory = worldWithCore().players[0]!.inventory;
    const result = secureItem(inventory, 1, null);

    expect(result.secured).toBe(true);
    expect(result.secureSlot?.id).toBe(honingStone.id);
    expect(result.inventory[0]?.id).toBe(splitReturnCore.id);
  });
});

describe("the boss drops its core into the world", () => {
  it("puts exactly one core on the ground where it died, and removes the boss", () => {
    let world = createSimulation({
      ...ARENA,
      players: [
        {
          id: "p1",
          position: { x: 400, y: 400 },
          meleeWeapon: basicSword,
          rangedWeapon: basicBow,
        },
      ],
      bossDefinition: warden,
      bossSpawnPoint: { x: 1_500, y: 1_500 },
    });
    expect(world.boss).not.toBeNull();

    world = { ...world, boss: { ...world.boss!, health: 0 } };
    world = step(world);

    expect(world.boss).toBeNull();
    const cores = world.groundLoot.filter((loot) => loot.definition.id === splitReturnCore.id);
    expect(cores).toHaveLength(1);
    expect(cores[0]!.position).toEqual({ x: 1_500, y: 1_500 });
  });

  it("drops it once, not once per step", () => {
    let world = createSimulation({
      ...ARENA,
      players: [
        { id: "p1", position: { x: 400, y: 400 }, meleeWeapon: basicSword, rangedWeapon: basicBow },
      ],
      bossDefinition: warden,
      bossSpawnPoint: { x: 1_500, y: 1_500 },
    });
    world = { ...world, boss: { ...world.boss!, health: 0 } };

    for (let index = 0; index < 20; index += 1) {
      world = step(world);
    }

    expect(
      world.groundLoot.filter((loot) => loot.definition.id === splitReturnCore.id),
    ).toHaveLength(1);
  });

  it("is a world without a boss when the arena declares no lair", () => {
    const world = createSimulation({
      ...ARENA,
      players: [
        { id: "p1", position: { x: 400, y: 400 }, meleeWeapon: basicSword, rangedWeapon: basicBow },
      ],
    });
    expect(world.boss).toBeNull();
    expect(step(world).boss).toBeNull();
  });

  it("takes damage from an ordinary attack, because it is an ordinary target", () => {
    let world = createSimulation({
      ...ARENA,
      players: [
        { id: "p1", position: { x: 400, y: 400 }, meleeWeapon: basicSword, rangedWeapon: basicBow },
      ],
      bossDefinition: warden,
      bossSpawnPoint: { x: 440, y: 400 },
    });
    const before = world.boss!.health;

    for (let index = 0; index < 20; index += 1) {
      world = step(world, { attackPressed: true, aimAngle: 0 });
    }

    expect(world.boss!.health).toBeLessThan(before);
    expect(SIMULATION_DT_MS).toBe(50);
  });
});
