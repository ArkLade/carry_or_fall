/**
 * M4 (`docs/M4_ISSUES.md` M4.2): the rules only a world with more than one
 * player can show. `simulation.test.ts` keeps covering the single-player rules
 * M1-M3 established; nothing here re-tests those.
 */
import {
  basicBow,
  basicSword,
  bulwarkStrike,
  chaser,
  multishot,
} from "@carry-or-fall/game-content";
import { describe, expect, it } from "vitest";

import { MAX_ACTIVE_PROJECTILES_PER_PLAYER } from "./combat/caps";
import { nearestLivePlayer } from "./enemy";
import { EXTRACTION_CHANNEL_MS } from "./extraction";
import { PROJECTILE_LIFESPAN_MS, PROJECTILE_RADIUS_PX } from "./combat/ranged";
import {
  addPlayerToWorld,
  createSimulation,
  ENEMY_RADIUS,
  findPlayer,
  PLAYER_MAX_HEALTH,
  PLAYER_RADIUS,
  removePlayerFromWorld,
  SIMULATION_DT_MS,
  stepSimulation,
  type PlayerSpawn,
  type SimulationConfig,
} from "./simulation";
import type { InputState, Player, Projectile, Vec2, World } from "./world";

const NO_INPUT: InputState = {
  moveX: 0,
  moveY: 0,
  aimAngle: 0,
  attackPressed: false,
  secondaryAttackPressed: false,
  dashPressed: false,
  interactPressed: false,
  discardSlotIndex: null,
  secureSlotIndex: null,
};
const MOVE_RIGHT: InputState = { ...NO_INPUT, moveX: 1 };
const MOVE_LEFT: InputState = { ...NO_INPUT, moveX: -1 };
const INTERACT: InputState = { ...NO_INPUT, interactPressed: true };
const FIRE: InputState = { ...NO_INPUT, secondaryAttackPressed: true };

const FAR_AWAY = { x: 100_000, y: 100_000 };
const FAR_AWAY_EXTRACTION = [FAR_AWAY, { x: 200_000, y: 0 }];

function spawn(id: string, position: Vec2): PlayerSpawn {
  return { id, position, meleeWeapon: basicSword, rangedWeapon: basicBow };
}

function newWorld(overrides: Partial<SimulationConfig> = {}): World {
  return createSimulation({
    walls: [],
    players: [spawn("a", { x: 0, y: 0 }), spawn("b", { x: 400, y: 0 })],
    enemyDefinition: chaser,
    enemySpawnPoints: [FAR_AWAY],
    extractionCandidatePoints: FAR_AWAY_EXTRACTION,
    seed: 1,
    ...overrides,
  });
}

function player(world: World, id: string): Player {
  const found = findPlayer(world, id);
  if (found === null) {
    throw new Error(`expected player ${id} to be in the world`);
  }
  return found;
}

function step(world: World, inputs: Record<string, InputState>): World {
  return stepSimulation(world, new Map(Object.entries(inputs))).world;
}

/** A projection that ignores the `Rng` closure, so two separately seeded worlds can be compared. */
function snapshot(world: World): string {
  return JSON.stringify({
    players: world.players,
    enemies: world.enemies,
    projectiles: world.projectiles,
    groundLoot: world.groundLoot,
    skillChips: world.skillChips,
    extractionPoints: world.extractionPoints,
    tick: world.tick,
  });
}

describe("two players in one world", () => {
  it("moves each player by their own input, not by each other's", () => {
    const world = newWorld();
    const next = step(world, { a: MOVE_RIGHT, b: MOVE_LEFT });

    expect(player(next, "a").position.x).toBeGreaterThan(player(world, "a").position.x);
    expect(player(next, "b").position.x).toBeLessThan(player(world, "b").position.x);
  });

  it("leaves a player with no input entry stationary — the disconnected case (technical plan §34.1)", () => {
    const world = newWorld();
    const next = step(world, { a: MOVE_RIGHT });

    expect(player(next, "a").position.x).toBeGreaterThan(0);
    expect(player(next, "b").position).toEqual(player(world, "b").position);
  });

  it("keeps a player with no input vulnerable rather than safe (technical plan §34.1)", () => {
    // "Do not make disconnected players invulnerable": sending nothing must not
    // be better than playing.
    const touching = { x: 400 + PLAYER_RADIUS + ENEMY_RADIUS - 1, y: 0 };
    let world = newWorld({ enemySpawnPoints: [touching] });
    world = step(world, { a: NO_INPUT });

    expect(player(world, "b").health).toBe(PLAYER_MAX_HEALTH - chaser.contactDamage);
  });

  it("keeps one player's match running after the other dies", () => {
    const lethal = { ...chaser, contactDamage: PLAYER_MAX_HEALTH };
    const touchingA = { x: PLAYER_RADIUS + ENEMY_RADIUS - 1, y: 0 };
    let world = newWorld({ enemyDefinition: lethal, enemySpawnPoints: [touchingA] });

    world = step(world, { a: NO_INPUT, b: NO_INPUT });
    expect(player(world, "a").alive).toBe(false);
    expect(player(world, "a").runResult?.outcome).toBe("died");

    const beforeX = player(world, "b").position.x;
    world = step(world, { a: MOVE_RIGHT, b: MOVE_RIGHT });
    // The dead player is inert; the survivor keeps playing in the same world.
    expect(player(world, "a").position.x).toBe(0);
    expect(player(world, "b").position.x).toBeGreaterThan(beforeX);
  });
});

describe("shared world entities", () => {
  it("lets a survivor pick up the loot a dead player dropped (concept §15.2)", () => {
    // The enemy starts far away so the pickup lands before anyone is in
    // contact range, then closes and kills A in one hit when it arrives.
    const lethal = { ...chaser, contactDamage: PLAYER_MAX_HEALTH };
    // B stands where A will die, so the drop is immediately reachable.
    let world = createSimulation({
      walls: [],
      players: [spawn("a", { x: 0, y: 0 }), spawn("b", { x: 0, y: 0 })],
      enemyDefinition: lethal,
      enemySpawnPoints: [{ x: 500, y: 0 }],
      groundLootSpawnPoints: [{ x: 0, y: 0 }],
      extractionCandidatePoints: FAR_AWAY_EXTRACTION,
      seed: 1,
    });

    // A takes the scattered item first (players resolve in world order).
    world = step(world, { a: INTERACT, b: INTERACT });
    expect(player(world, "a").inventory.filter((slot) => slot !== null)).toHaveLength(1);
    expect(player(world, "b").inventory.every((slot) => slot === null)).toBe(true);
    expect(world.groundLoot).toHaveLength(0);

    // A dies holding it; the item drops where they stood and B can take it.
    for (let i = 0; i < 300 && player(world, "a").alive; i += 1) {
      world = step(world, { b: NO_INPUT });
    }
    expect(player(world, "a").alive).toBe(false);
    expect(world.groundLoot).toHaveLength(1);

    world = step(world, { b: INTERACT });
    expect(player(world, "b").inventory.filter((slot) => slot !== null)).toHaveLength(1);
    expect(world.groundLoot).toHaveLength(0);
  });

  it("resolves a contested pickup deterministically, giving the item to exactly one player", () => {
    let world = createSimulation({
      walls: [],
      players: [spawn("a", { x: 0, y: 0 }), spawn("b", { x: 0, y: 0 })],
      enemyDefinition: chaser,
      enemySpawnPoints: [FAR_AWAY],
      groundLootSpawnPoints: [{ x: 0, y: 0 }],
      extractionCandidatePoints: FAR_AWAY_EXTRACTION,
      seed: 1,
    });

    world = step(world, { a: INTERACT, b: INTERACT });

    const held =
      player(world, "a").inventory.filter((slot) => slot !== null).length +
      player(world, "b").inventory.filter((slot) => slot !== null).length;
    // Never duplicated, never lost: exactly one copy exists afterwards.
    expect(held).toBe(1);
    expect(world.groundLoot).toHaveLength(0);
  });

  it("removes a skill chip from the world for everyone once one player takes it", () => {
    let world = createSimulation({
      walls: [],
      players: [spawn("a", { x: 0, y: 0 }), spawn("b", { x: 0, y: 0 })],
      enemyDefinition: chaser,
      enemySpawnPoints: [FAR_AWAY],
      skillChipSpawnPoints: [{ x: 0, y: 0 }],
      extractionCandidatePoints: FAR_AWAY_EXTRACTION,
      seed: 1,
    });

    world = step(world, { a: INTERACT, b: INTERACT });
    expect(player(world, "a").wildcardSkill).not.toBeNull();
    expect(player(world, "b").wildcardSkill).toBeNull();
    expect(world.skillChips).toHaveLength(0);
  });

  it("lets two players channel the same extraction point and each extract independently", () => {
    // Concept §15.1 lists contesting extraction points as a thing players do;
    // one player channelling must not block or interrupt another.
    let world = createSimulation({
      walls: [],
      players: [spawn("a", { x: 0, y: 0 }), spawn("b", { x: 20, y: 0 })],
      enemyDefinition: chaser,
      enemySpawnPoints: [FAR_AWAY],
      extractionCandidatePoints: [
        { x: 0, y: 0 },
        { x: 500_000, y: 0 },
      ],
      seed: 1,
    });

    const stepsToChannel = Math.ceil(EXTRACTION_CHANNEL_MS / SIMULATION_DT_MS);
    // A starts channelling one step ahead of B.
    world = step(world, { a: INTERACT, b: NO_INPUT });
    for (let i = 0; i < stepsToChannel - 1; i += 1) {
      world = step(world, { a: INTERACT, b: INTERACT });
    }

    // A began first, so A finishes first — each channel is that player's own
    // progress, not a shared timer, and A extracting does not carry B out.
    expect(player(world, "a").runResult?.outcome).toBe("extracted");
    expect(player(world, "b").runResult).toBeNull();
    expect(player(world, "b").extractionProgressMs).toBe(EXTRACTION_CHANNEL_MS - SIMULATION_DT_MS);

    world = step(world, { a: INTERACT, b: INTERACT });
    expect(player(world, "b").runResult?.outcome).toBe("extracted");
  });
});

describe("enemy targeting with several players", () => {
  it("chases the nearest player rather than a fixed one", () => {
    const world = newWorld({ enemySpawnPoints: [{ x: 380, y: 0 }] });
    const next = step(world, { a: NO_INPUT, b: NO_INPUT });
    // B is at x=400, A at x=0; the enemy at x=380 must close on B.
    expect(next.enemies[0]!.position.x).toBeGreaterThan(380);
  });

  it("retargets when its nearest target dies", () => {
    const lethal = { ...chaser, contactDamage: PLAYER_MAX_HEALTH };
    const touchingA = { x: PLAYER_RADIUS + ENEMY_RADIUS - 1, y: 0 };
    let world = newWorld({ enemyDefinition: lethal, enemySpawnPoints: [touchingA] });

    world = step(world, { a: NO_INPUT, b: NO_INPUT });
    expect(player(world, "a").alive).toBe(false);

    const startX = world.enemies[0]!.position.x;
    for (let i = 0; i < 10; i += 1) {
      world = step(world, { b: NO_INPUT });
    }
    // A is dead at the origin; the enemy must now be heading east toward B.
    expect(world.enemies[0]!.position.x).toBeGreaterThan(startX);
  });

  it("ignores a player who has already extracted", () => {
    const world = newWorld();
    const extracted: Player = {
      ...player(world, "a"),
      runResult: {
        outcome: "extracted",
        pointsGained: {
          force: 0,
          precision: 0,
          motion: 0,
          guard: 0,
          signal: 0,
        },
        itemsConverted: 0,
        itemsLost: 0,
      },
    };

    expect(nearestLivePlayer({ x: 0, y: 0 }, [extracted, player(world, "b")])?.id).toBe("b");
  });

  it("has no one to chase when every player's run is over", () => {
    expect(nearestLivePlayer({ x: 0, y: 0 }, [])).toBeNull();
  });
});

describe("the per-player active-projectile cap (§13.4 cap 7) counts per owner", () => {
  function fabricatedProjectile(ownerId: string, index: number): Projectile {
    return {
      id: `existing-${ownerId}-${String(index)}`,
      ownerId,
      position: { x: 0, y: 5_000 },
      velocity: { x: 0, y: 0 },
      radius: PROJECTILE_RADIUS_PX,
      damage: 1,
      remainingLifespanMs: PROJECTILE_LIFESPAN_MS,
      bouncesRemaining: 0,
      piercesRemaining: 0,
      canReturn: false,
      returnsSoFar: 0,
      homingStrength: 0,
      postBounceDamageMultiplier: 1,
      hitTargetIds: [],
    };
  }

  it("refuses a player already at the cap while another player can still fire", () => {
    // Player A starts with a full budget of live projectiles; B has none. If
    // the cap were counted per world instead of per owner, B would be refused
    // too — and if it were ignored, A would exceed it.
    const atCap = Array.from({ length: MAX_ACTIVE_PROJECTILES_PER_PLAYER }, (_unused, index) =>
      fabricatedProjectile("a", index),
    );
    let world = newWorld();
    world = { ...world, projectiles: atCap };

    world = step(world, { a: FIRE, b: FIRE });

    const ownedByA = world.projectiles.filter((projectile) => projectile.ownerId === "a");
    const ownedByB = world.projectiles.filter((projectile) => projectile.ownerId === "b");
    expect(ownedByA).toHaveLength(MAX_ACTIVE_PROJECTILES_PER_PLAYER);
    expect(ownedByB.length).toBeGreaterThan(0);
  });

  it("tags every spawned projectile with the player who fired it", () => {
    let world = newWorld({ players: [spawn("a", { x: 0, y: 0 }), spawn("b", { x: 400, y: 0 })] });
    world = step(world, { a: FIRE, b: FIRE });

    expect(world.projectiles.length).toBeGreaterThan(1);
    expect(new Set(world.projectiles.map((projectile) => projectile.ownerId))).toEqual(
      new Set(["a", "b"]),
    );
    // Ids stay unique across owners firing on the same tick.
    expect(new Set(world.projectiles.map((projectile) => projectile.id)).size).toBe(
      world.projectiles.length,
    );
  });

  it("credits a landed projectile hit's shield-on-hit to the shooter, not to a bystander", () => {
    // Both players fire at their own tanky, stationary enemy from the same
    // range, but only A carries the shield skill. If the shield were credited
    // by anything other than the projectile's owner, B would gain it too — or
    // A would gain nothing.
    const dummy = { ...chaser, moveSpeed: 0, health: 100_000, contactDamage: 0 };
    let world = createSimulation({
      walls: [],
      players: [
        { ...spawn("a", { x: 0, y: 0 }), skillLoadout: [bulwarkStrike] },
        spawn("b", { x: 0, y: 400 }),
      ],
      enemyDefinition: dummy,
      enemySpawnPoints: [
        { x: 60, y: 0 },
        { x: 60, y: 400 },
      ],
      enemyCount: 2,
      extractionCandidatePoints: FAR_AWAY_EXTRACTION,
      seed: 1,
    });

    for (let i = 0; i < 6 && player(world, "a").shieldHp === 0; i += 1) {
      world = step(world, { a: FIRE, b: FIRE });
    }

    expect(player(world, "a").shieldHp).toBe(bulwarkStrike.effects.shieldOnHitAdd);
    expect(player(world, "b").shieldHp).toBe(0);
    // Both shots really did land, so B's zero is about ownership, not a miss.
    expect(world.enemies.every((enemy) => enemy.health < dummy.health)).toBe(true);
  });

  it("applies a skill to only its owner's attacks", () => {
    let world = createSimulation({
      walls: [],
      players: [
        { ...spawn("a", { x: 0, y: 0 }), skillLoadout: [multishot] },
        spawn("b", { x: 0, y: 400 }),
      ],
      enemyDefinition: chaser,
      enemySpawnPoints: [FAR_AWAY],
      extractionCandidatePoints: FAR_AWAY_EXTRACTION,
      seed: 1,
    });

    world = step(world, { a: FIRE, b: FIRE });
    expect(world.projectiles.filter((projectile) => projectile.ownerId === "a")).toHaveLength(
      (basicBow.projectileCount ?? 0) + 2,
    );
    expect(world.projectiles.filter((projectile) => projectile.ownerId === "b")).toHaveLength(
      basicBow.projectileCount ?? 0,
    );
  });
});

describe("players joining and leaving an existing world", () => {
  it("appends a joining player without disturbing the existing ones", () => {
    const world = newWorld();
    const joined = addPlayerToWorld(world, spawn("c", { x: 900, y: 0 }));

    expect(joined.players.map((entry) => entry.id)).toEqual(["a", "b", "c"]);
    expect(player(joined, "a")).toEqual(player(world, "a"));
  });

  it("refuses a duplicate id rather than giving one player two bodies", () => {
    const world = newWorld();
    const joined = addPlayerToWorld(world, spawn("a", { x: 900, y: 0 }));

    expect(joined).toBe(world);
  });

  it("drops a leaving player's carried loot where they stood", () => {
    let world = createSimulation({
      walls: [],
      players: [spawn("a", { x: 0, y: 0 }), spawn("b", { x: 400, y: 0 })],
      enemyDefinition: chaser,
      enemySpawnPoints: [FAR_AWAY],
      groundLootSpawnPoints: [{ x: 0, y: 0 }],
      extractionCandidatePoints: FAR_AWAY_EXTRACTION,
      seed: 1,
    });
    world = step(world, { a: INTERACT });
    expect(world.groundLoot).toHaveLength(0);

    const afterLeave = removePlayerFromWorld(world, "a");
    expect(findPlayer(afterLeave, "a")).toBeNull();
    expect(afterLeave.groundLoot).toHaveLength(1);
    expect(afterLeave.groundLoot[0]!.position).toEqual(player(world, "a").position);
    // Leaving must not be a way to remove contested loot from the match.
    expect(player(afterLeave, "b")).toEqual(player(world, "b"));
  });

  it("does not drop a secure-slot item, which is not lootable by anyone (concept §7.2)", () => {
    let world = createSimulation({
      walls: [],
      players: [spawn("a", { x: 0, y: 0 })],
      enemyDefinition: chaser,
      enemySpawnPoints: [FAR_AWAY],
      groundLootSpawnPoints: [{ x: 0, y: 0 }],
      extractionCandidatePoints: FAR_AWAY_EXTRACTION,
      seed: 1,
    });
    world = step(world, { a: INTERACT });
    world = step(world, { a: { ...NO_INPUT, secureSlotIndex: 0 } });
    expect(player(world, "a").secureSlot).not.toBeNull();

    const afterLeave = removePlayerFromWorld(world, "a");
    expect(afterLeave.groundLoot).toHaveLength(0);
  });

  it("ignores a request to remove someone who is not in the world", () => {
    const world = newWorld();
    expect(removePlayerFromWorld(world, "nobody")).toBe(world);
  });
});

describe("determinism with several players", () => {
  it("produces an identical world from the same seed and the same per-tick inputs", () => {
    const config: SimulationConfig = {
      walls: [{ x: 200, y: -200, width: 20, height: 400 }],
      players: [spawn("a", { x: 0, y: 0 }), spawn("b", { x: 100, y: 40 })],
      enemyDefinition: chaser,
      enemySpawnPoints: [
        { x: 300, y: 0 },
        { x: 350, y: 90 },
        { x: 400, y: -90 },
      ],
      enemyCount: 2,
      groundLootSpawnPoints: [{ x: 30, y: 0 }],
      skillChipSpawnPoints: [{ x: 60, y: 0 }],
      extractionCandidatePoints: FAR_AWAY_EXTRACTION,
      seed: 4242,
    };
    const script: Record<string, InputState>[] = [
      { a: MOVE_RIGHT, b: MOVE_LEFT },
      { a: FIRE, b: INTERACT },
      { a: INTERACT, b: FIRE },
      { a: MOVE_RIGHT, b: MOVE_RIGHT },
      { a: NO_INPUT, b: FIRE },
    ];

    let first = createSimulation(config);
    let second = createSimulation(config);
    for (let round = 0; round < 12; round += 1) {
      for (const inputs of script) {
        first = step(first, inputs);
        second = step(second, inputs);
      }
    }

    expect(snapshot(first)).toEqual(snapshot(second));
    // A world that never advanced would compare equal trivially.
    expect(first.tick).toBe(script.length * 12);
  });
});
