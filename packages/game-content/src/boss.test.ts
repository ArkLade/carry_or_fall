import { describe, expect, it } from "vitest";

import { ALL_BOSSES, findBoss, warden } from "./boss";
import { ALL_BOSS_CORES, ALL_LOOT, findLoot, isBossCore, type LootPoints } from "./loot";
import { ALL_SKILLS } from "./skills";
import { ALL_UNLOCKS, BOSS_CORE_UNLOCKS, unlockForBossCore, unlocksEarnedAt } from "./unlocks";

describe("the boss definition (concept §14.3)", () => {
  it("ships exactly one boss (technical plan §38 M7)", () => {
    expect(ALL_BOSSES).toHaveLength(1);
    expect(findBoss(warden.id)).toBe(warden);
    expect(findBoss("no_such_boss")).toBeNull();
  });

  it("has two normal attacks and one area attack, and no way to add a fourth", () => {
    // Concept §14.3's move budget, read off the data rather than trusted: the
    // type is a fixed triple, so this asserts the *shape* those three take.
    expect(warden.attacks).toHaveLength(3);
    const kinds = warden.attacks.map((attack) => attack.kind);
    expect(kinds.filter((kind) => kind === "arc")).toHaveLength(2);
    expect(kinds.filter((kind) => kind === "area")).toHaveLength(1);
  });

  it("telegraphs every attack, and telegraphs the area attack longest", () => {
    // "Readable" (§14.3) is not a feeling here; it is a wind-up long enough to
    // move out of, and the one worth moving out of gets the longest.
    for (const attack of warden.attacks) {
      expect(attack.telegraphMs).toBeGreaterThan(0);
      expect(attack.telegraphMs).toBeLessThan(attack.intervalMs);
    }
    const area = warden.attacks.find((attack) => attack.kind === "area")!;
    for (const attack of warden.attacks) {
      if (attack !== area) {
        expect(area.telegraphMs).toBeGreaterThan(attack.telegraphMs);
      }
    }
  });

  it("reaches further with its area attack than with either normal attack", () => {
    const area = warden.attacks.find((attack) => attack.kind === "area")!;
    for (const attack of warden.attacks) {
      if (attack !== area) {
        expect(area.rangePx).toBeGreaterThan(attack.rangePx);
      }
    }
  });

  it("can be attracted to but not followed home: the leash bounds the aggro", () => {
    // A leash shorter than the aggro radius would let a player pull the boss and
    // then stand outside its reach forever; a leash far larger would make "come
    // to it" meaningless. The relationship is the rule (`docs/DECISIONS.md` D66).
    expect(warden.leashRadiusPx).toBeGreaterThan(warden.aggroRadiusPx);
    expect(warden.leashRadiusPx).toBeLessThan(warden.aggroRadiusPx * 2);
  });

  it("changes behaviour once, partway through its health (concept §14.3)", () => {
    expect(warden.enrageBelowHealthFraction).toBeGreaterThan(0);
    expect(warden.enrageBelowHealthFraction).toBeLessThan(1);
    // Enrage shortens intervals; a multiplier at or above 1 would be a phase
    // change that changes nothing.
    expect(warden.enrageIntervalMultiplier).toBeGreaterThan(0);
    expect(warden.enrageIntervalMultiplier).toBeLessThan(1);
  });

  it("drops a core that exists", () => {
    const core = findLoot(warden.coreLootId);
    expect(core).not.toBeNull();
    expect(isBossCore(core!)).toBe(true);
  });

  it("is slower than the player, so a ranged fight is a real option", () => {
    // Concept §14.3 wants melee *and* ranged interaction to work. The boss has
    // no projectiles (`docs/DECISIONS.md` D66), so the thing that keeps a bow
    // honest is the area attack's reach, not the boss outrunning anyone.
    expect(warden.moveSpeed).toBeLessThan(220);
  });
});

describe("the boss core (concept §11, §29.4)", () => {
  it("cannot be drawn from the ordinary loot table", () => {
    // A core comes from a boss or from nowhere. `chooseLootDrop` picks from
    // ALL_LOOT, so the two lists must not intersect — otherwise a chaser could
    // drop one and the whole risk decision would be free.
    const ordinaryIds = new Set(ALL_LOOT.map((item) => item.id));
    for (const core of ALL_BOSS_CORES) {
      expect(ordinaryIds.has(core.id)).toBe(false);
    }
    expect(ALL_LOOT.filter((item) => item.rarity === "boss")).toEqual([]);
  });

  it("is still resolvable by id, because crash recovery has only the id", () => {
    // `secure_reservations` stores the item id and nothing else
    // (`docs/DATA_MODEL.md` §3.3), so a secured core recovered after a crash has
    // to be findable the same way ordinary loot is.
    for (const core of ALL_BOSS_CORES) {
      expect(findLoot(core.id)).toBe(core);
    }
  });

  it("carries no points of its own, so a first core awards an unlock and nothing else", () => {
    for (const core of ALL_BOSS_CORES) {
      expect(core.points).toEqual({ force: 0, precision: 0, motion: 0, guard: 0, signal: 0 });
      expect(core.buildEffects).toBeUndefined();
    }
  });

  it("converts to something worth more than an ordinary item when duplicated", () => {
    const totalPoints = (points: LootPoints): number =>
      points.force + points.precision + points.motion + points.guard + points.signal;
    const ordinaryBest = Math.max(...ALL_LOOT.map((item) => totalPoints(item.points)));

    for (const core of ALL_BOSS_CORES) {
      expect(totalPoints(core.bossCore!.duplicateConversion)).toBeGreaterThan(ordinaryBest);
    }
  });

  it("names a real skill to grant temporarily and a real unlock to grant permanently", () => {
    const skillIds = new Set(ALL_SKILLS.map((skill) => skill.id));
    const unlockIds = new Set(ALL_UNLOCKS.map((unlock) => unlock.id));
    for (const core of ALL_BOSS_CORES) {
      expect(skillIds.has(core.bossCore!.temporarySkillId)).toBe(true);
      expect(unlockIds.has(core.bossCore!.permanentUnlockId)).toBe(true);
    }
  });

  it("allows the secure slot, or concept §11's third option would not exist", () => {
    for (const core of ALL_BOSS_CORES) {
      expect(core.bossCore!.secureSlotAllowed).toBe(true);
    }
  });
});

describe("boss-core unlocks are a third source (docs/DECISIONS.md D67)", () => {
  it("cannot be earned by any point balance, however large", () => {
    // The load-bearing property of a boss unlock: patience must not substitute
    // for the risk decision. An absurd balance earns every threshold and still
    // earns no boss skill.
    const enormous = { force: 1e9, precision: 1e9, motion: 1e9, guard: 1e9, signal: 1e9 };
    const earned = unlocksEarnedAt(enormous).map((unlock) => unlock.id);
    for (const unlock of BOSS_CORE_UNLOCKS) {
      expect(earned).not.toContain(unlock.id);
    }
    expect(earned.length).toBeGreaterThan(0);
  });

  it("is not in the default set either", () => {
    const defaults = ALL_UNLOCKS.filter((unlock) => unlock.source === "default").map((u) => u.id);
    for (const unlock of BOSS_CORE_UNLOCKS) {
      expect(defaults).not.toContain(unlock.id);
    }
  });

  it("resolves from the core that grants it, and only from that", () => {
    for (const core of ALL_BOSS_CORES) {
      expect(unlockForBossCore(core.bossCore!.permanentUnlockId)?.id).toBe(
        core.bossCore!.permanentUnlockId,
      );
    }
    expect(unlockForBossCore("stunning_blows")).toBeNull();
    expect(unlockForBossCore("basic_sword")).toBeNull();
  });

  it("gives every unlock exactly one source", () => {
    for (const unlock of ALL_UNLOCKS) {
      expect(["default", "threshold", "boss_core"]).toContain(unlock.source);
      expect(unlock.requires === null).toBe(unlock.source !== "threshold");
    }
  });
});
