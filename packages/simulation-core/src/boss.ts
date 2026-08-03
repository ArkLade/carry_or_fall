/**
 * The boss (M7.2, `docs/M7_ISSUES.md` §3; concept §14.3). A pure function over
 * the boss, the players, and the wall grid — the same shape every other rule
 * module in this package has, so the multi-player loop can call it without
 * knowing anything about bosses.
 *
 * **This module implements no per-boss behaviour.** Everything specific to
 * `warden` — how hard it hits, how far it reaches, when it enrages, what it
 * drops — is data in `@carry-or-fall/game-content`'s `BossDefinition`. A second
 * boss is a definition plus tests (`docs/DEVELOPMENT_RULES.md`, "content is
 * data-driven").
 *
 * ## The three states, and why there are only three
 *
 * - **dormant** — nobody is inside `aggroRadiusPx` of the lair. The boss sits
 *   still and its attack timers do not run down.
 * - **engaged** — a player is inside the aggro radius and inside the leash. The
 *   boss walks toward the nearest live one and attacks when a timer allows.
 * - **returning** — it has been pulled to its leash limit, or its target left.
 *   It walks home and does not attack.
 *
 * Concept §14.3 asks for a boss that *attracts nearby players*; the leash is
 * what makes that "come to it" rather than "it comes to you"
 * (`docs/DECISIONS.md` D66). It is also why the rest of the map's danger model
 * is unchanged by adding a boss: there is a circle it cannot leave, and
 * everything outside that circle is exactly as dangerous as it was in M6.
 *
 * ## Telegraphs
 *
 * An attack is not instant. When a timer allows one, the boss enters
 * `telegraphMs` of wind-up during which it is committed — it stops moving, and
 * the client draws the shape that is coming — and the damage lands when the
 * wind-up ends. Concept §14.3's "readable" is this: a player who reacts to the
 * wind-up can leave before the hit, and one who does not, cannot.
 */
import type { BossAttack, BossDefinition } from "@carry-or-fall/game-content";

import { resolveAxisMovement, type SpatialGrid } from "./collision";
import { nearestLivePlayer } from "./enemy";
import type { Boss, BossTelegraph, Player, RunResult, Vec2, Wall } from "./world";

/** A live target the boss can damage: the minimum it needs to know about a player. */
export interface BossTarget {
  readonly id: string;
  readonly position: Vec2;
  readonly radius: number;
  readonly alive: boolean;
  readonly runResult: RunResult | null;
}

/** Build a live boss from its definition, asleep in its lair. */
export function spawnBoss(definition: BossDefinition, lair: Vec2): Boss {
  return {
    id: `boss-${definition.id}`,
    definitionId: definition.id,
    position: lair,
    lair,
    radius: definition.radius,
    health: definition.health,
    maxHealth: definition.health,
    enraged: false,
    telegraph: null,
    // Every attack starts ready, so a player who walks straight in is met
    // rather than escorted.
    attackCooldownsMs: definition.attacks.map(() => 0),
    awake: false,
  };
}

/** How far `from` is from `to`. */
function distance(from: Vec2, to: Vec2): number {
  return Math.hypot(to.x - from.x, to.y - from.y);
}

/** What one boss step produced: the boss, and any damage it landed. */
export interface BossStepResult {
  readonly boss: Boss;
  /** Player ids the boss's attack landed on this step, with the damage each took. */
  readonly hits: readonly { readonly playerId: string; readonly damage: number }[];
}

/**
 * Whether `target` is inside `attack`'s shape, measured from the boss.
 *
 * An `"arc"` attack is the same shape the player's own sword uses — a wedge in
 * front of the attacker — and an `"area"` attack ignores facing entirely, which
 * is what makes it the one you have to *move* out of rather than step behind.
 */
export function isWithinBossAttack(
  boss: Boss,
  attack: BossAttack,
  facing: number,
  target: BossTarget,
): boolean {
  const reach = attack.rangePx + target.radius;
  const separation = distance(boss.position, target.position);
  if (separation > reach) {
    return false;
  }
  if (attack.kind === "area") {
    return true;
  }
  const toTarget = Math.atan2(
    target.position.y - boss.position.y,
    target.position.x - boss.position.x,
  );
  let delta = toTarget - facing;
  while (delta > Math.PI) delta -= Math.PI * 2;
  while (delta < -Math.PI) delta += Math.PI * 2;
  return Math.abs(delta) <= (attack.arcDegrees * Math.PI) / 360;
}

/** The interval this attack runs on right now — shortened once the boss has enraged. */
export function effectiveIntervalMs(
  definition: BossDefinition,
  attack: BossAttack,
  enraged: boolean,
): number {
  return enraged ? attack.intervalMs * definition.enrageIntervalMultiplier : attack.intervalMs;
}

/**
 * Advance the boss by one fixed step.
 *
 * Order inside the step, which is a rule rather than an implementation detail
 * because a contested outcome has to resolve identically everywhere:
 *
 * 1. tick cooldowns down;
 * 2. resolve a telegraph that has finished — damage lands *before* movement, so
 *    a player who left during the wind-up is already gone;
 * 3. pick a target and decide dormant / engaged / returning;
 * 4. move, unless committed to a telegraph;
 * 5. start a telegraph if an attack is ready and its shape would land.
 */
export function stepBoss(
  boss: Boss,
  definition: BossDefinition,
  targets: readonly BossTarget[],
  dtMs: number,
  dtSeconds: number,
  wallGrid: SpatialGrid<Wall>,
): BossStepResult {
  if (boss.health <= 0) {
    // A dead boss does nothing at all — no lingering telegraph resolves, which
    // is what keeps "I killed it during the wind-up" from still hurting.
    return { boss: { ...boss, telegraph: null }, hits: [] };
  }

  const attackCooldownsMs = boss.attackCooldownsMs.map((cooldown) => Math.max(0, cooldown - dtMs));
  const enraged =
    boss.enraged || boss.health <= boss.maxHealth * definition.enrageBelowHealthFraction;

  let working: Boss = { ...boss, attackCooldownsMs, enraged };
  const hits: { playerId: string; damage: number }[] = [];

  // ---- Resolve a finished telegraph. ---------------------------------------
  if (working.telegraph !== null) {
    const remainingMs = working.telegraph.remainingMs - dtMs;
    if (remainingMs > 0) {
      working = { ...working, telegraph: { ...working.telegraph, remainingMs } };
    } else {
      const attack = definition.attacks[working.telegraph.attackIndex];
      const facing = working.telegraph.facing;
      if (attack !== undefined) {
        for (const target of targets) {
          if (!target.alive || target.runResult !== null) {
            continue;
          }
          if (isWithinBossAttack(working, attack, facing, target)) {
            hits.push({ playerId: target.id, damage: attack.damage });
          }
        }
      }
      working = { ...working, telegraph: null };
    }
  }

  // ---- Choose a target, and decide what state we are in. --------------------
  const live = targets.filter((target) => target.alive && target.runResult === null);
  const nearest = nearestLivePlayer(working.position, live);
  const distanceFromLair = distance(working.lair, working.position);
  const targetInAggro =
    nearest !== null && distance(working.lair, nearest.position) <= definition.aggroRadiusPx;
  const awake = targetInAggro;

  // ---- Move, unless committed to a wind-up. --------------------------------
  if (working.telegraph === null) {
    const destination = awake && nearest !== null ? nearest.position : working.lair;
    const beyondLeash = distanceFromLair >= definition.leashRadiusPx;
    // Beyond the leash the boss only ever walks home, whatever is nearby. That
    // is the whole guarantee: there is a circle it cannot leave.
    const goal = beyondLeash ? working.lair : destination;
    working = { ...working, position: moveToward(working, goal, definition, dtSeconds, wallGrid) };
  }

  // ---- Start an attack, if one is ready and would land. ---------------------
  if (working.telegraph === null && awake && nearest !== null) {
    const facing = Math.atan2(
      nearest.position.y - working.position.y,
      nearest.position.x - working.position.x,
    );
    const started = chooseAttack(working, definition, facing, nearest);
    if (started !== null) {
      const cooldowns = working.attackCooldownsMs.slice();
      const attack = definition.attacks[started]!;
      cooldowns[started] = effectiveIntervalMs(definition, attack, working.enraged);
      const telegraph: BossTelegraph = {
        attackIndex: started,
        facing,
        remainingMs: attack.telegraphMs,
      };
      working = { ...working, attackCooldownsMs: cooldowns, telegraph };
    }
  }

  return { boss: { ...working, awake }, hits };
}

/**
 * Which attack to start, or `null` for none.
 *
 * Scanned in definition order and the first ready one that would land wins, so
 * "two normal attacks, one area attack" (concept §14.3) means the area attack —
 * listed last, and on the longest interval — is the exception rather than the
 * habit. Deterministic, because the alternative is a random choice and a random
 * choice would make a replay diverge.
 */
function chooseAttack(
  boss: Boss,
  definition: BossDefinition,
  facing: number,
  target: BossTarget,
): number | null {
  for (let index = 0; index < definition.attacks.length; index += 1) {
    const attack = definition.attacks[index]!;
    if ((boss.attackCooldownsMs[index] ?? 0) > 0) {
      continue;
    }
    if (isWithinBossAttack(boss, attack, facing, target)) {
      return index;
    }
  }
  return null;
}

/** One step of walking toward `goal`, wall-aware, exactly like every other actor. */
function moveToward(
  boss: Boss,
  goal: Vec2,
  definition: BossDefinition,
  dtSeconds: number,
  wallGrid: SpatialGrid<Wall>,
): Vec2 {
  const dx = goal.x - boss.position.x;
  const dy = goal.y - boss.position.y;
  const separation = Math.hypot(dx, dy);
  if (separation < 1) {
    return boss.position;
  }
  const step = Math.min(definition.moveSpeed * dtSeconds, separation);
  const deltaX = (dx / separation) * step;
  const deltaY = (dy / separation) * step;

  const x = resolveAxisMovement(boss.position, "x", deltaX, boss.radius, wallGrid);
  const afterX: Vec2 = { x, y: boss.position.y };
  const y = resolveAxisMovement(afterX, "y", deltaY, boss.radius, wallGrid);
  return { x, y };
}

/** Whether `player` is a live target for the boss — the same rule enemies use. */
export function isBossTarget(player: Player): boolean {
  return player.alive && player.runResult === null;
}
