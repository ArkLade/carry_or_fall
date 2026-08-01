/**
 * Publishes the authoritative `World` into the synchronized Colyseus schema
 * (M4.4, `docs/M4_ISSUES.md`).
 *
 * The simulation is immutable — every step returns a fresh world — while
 * Colyseus encodes *mutations*. Rebuilding the collections each tick would
 * therefore send the whole world 20 times a second. So each collection is
 * reconciled by id instead: entities that still exist are updated in place,
 * new ones are added, and vanished ones are deleted, which is exactly the shape
 * Colyseus's delta encoding is built for (technical plan §10.1, "prefer compact
 * messages and avoid sending large JSON objects repeatedly").
 *
 * Only public data is written here. Inventory, secure slot, skill loadout,
 * wildcard skill, and run result have no field in this schema at all; they go
 * to their owner alone (`private-state.ts`, technical plan §10.3).
 */
import { meleePhase, type World } from "@carry-or-fall/simulation-core";
import type { MapSchema } from "@colyseus/schema";

import {
  EnemyState,
  ExtractionPointState,
  GroundLootState,
  type MatchStateType,
  PlayerState,
  ProjectileState,
  SkillChipState,
} from "./MatchState";

/**
 * Reconcile one keyed collection against the live entity list: update, add,
 * delete. `apply` mutates an existing entry; `create` builds a new one.
 */
function reconcile<TSource extends { readonly id: string }, TEntry>(
  target: MapSchema<TEntry>,
  source: readonly TSource[],
  create: (item: TSource) => TEntry,
  apply: (entry: TEntry, item: TSource) => void,
): void {
  const live = new Set<string>();
  for (const item of source) {
    live.add(item.id);
    const existing = target.get(item.id);
    if (existing === undefined) {
      target.set(item.id, create(item));
    } else {
      apply(existing, item);
    }
  }
  const stale: string[] = [];
  target.forEach((_entry, key) => {
    if (!live.has(key)) {
      stale.push(key);
    }
  });
  for (const key of stale) {
    target.delete(key);
  }
}

/**
 * Whether this player's melee swing is in its active (hit-resolving) window
 * right now. A swing outside that window is not drawn, so it is not published:
 * the arc a client renders is exactly the arc the server resolved hits with.
 */
function activeSwing(player: World["players"][number]): {
  readonly active: boolean;
  readonly originX: number;
  readonly originY: number;
  readonly facing: number;
  readonly rangePx: number;
  readonly arcDegrees: number;
} {
  const swing = player.meleeAttack;
  if (swing === null || meleePhase(swing) !== "active") {
    return { active: false, originX: 0, originY: 0, facing: 0, rangePx: 0, arcDegrees: 0 };
  }
  return {
    active: true,
    originX: swing.origin.x,
    originY: swing.origin.y,
    facing: swing.facing,
    rangePx: swing.weapon.rangePx ?? 0,
    arcDegrees: swing.weapon.arcDegrees ?? 0,
  };
}

/** Which players are currently connected; a disconnected one stays in the world (technical plan §34.1). */
export type ConnectedPredicate = (playerId: string) => boolean;

/** Copy the public half of `world` into `state`, mutating in place. */
export function syncMatchState(
  state: MatchStateType,
  world: World,
  isConnected: ConnectedPredicate,
): void {
  state.tick = world.tick;

  reconcile(
    state.players,
    world.players,
    (player) => {
      const swing = activeSwing(player);
      return new PlayerState({
        id: player.id,
        x: player.position.x,
        y: player.position.y,
        radius: player.radius,
        facing: player.facing,
        health: player.health,
        maxHealth: player.maxHealth,
        shieldHp: player.shieldHp,
        alive: player.alive,
        runOver: player.runResult !== null,
        connected: isConnected(player.id),
        extractionProgressMs: player.extractionProgressMs,
        swingActive: swing.active,
        swingOriginX: swing.originX,
        swingOriginY: swing.originY,
        swingFacing: swing.facing,
        swingRangePx: swing.rangePx,
        swingArcDegrees: swing.arcDegrees,
      });
    },
    (entry, player) => {
      const swing = activeSwing(player);
      entry.x = player.position.x;
      entry.y = player.position.y;
      entry.facing = player.facing;
      entry.health = player.health;
      entry.maxHealth = player.maxHealth;
      entry.shieldHp = player.shieldHp;
      entry.alive = player.alive;
      entry.runOver = player.runResult !== null;
      entry.connected = isConnected(player.id);
      entry.extractionProgressMs = player.extractionProgressMs;
      entry.swingActive = swing.active;
      entry.swingOriginX = swing.originX;
      entry.swingOriginY = swing.originY;
      entry.swingFacing = swing.facing;
      entry.swingRangePx = swing.rangePx;
      entry.swingArcDegrees = swing.arcDegrees;
    },
  );

  reconcile(
    state.enemies,
    world.enemies,
    (enemy) =>
      new EnemyState({
        id: enemy.id,
        x: enemy.position.x,
        y: enemy.position.y,
        radius: enemy.radius,
        health: enemy.health,
        maxHealth: enemy.maxHealth,
        stunnedMs: enemy.stunnedMs,
      }),
    (entry, enemy) => {
      entry.x = enemy.position.x;
      entry.y = enemy.position.y;
      entry.health = enemy.health;
      entry.stunnedMs = enemy.stunnedMs;
    },
  );

  reconcile(
    state.projectiles,
    world.projectiles,
    (projectile) =>
      new ProjectileState({
        id: projectile.id,
        ownerId: projectile.ownerId,
        x: projectile.position.x,
        y: projectile.position.y,
        velocityX: projectile.velocity.x,
        velocityY: projectile.velocity.y,
        radius: projectile.radius,
        bouncesRemaining: projectile.bouncesRemaining,
        piercesRemaining: projectile.piercesRemaining,
        canReturn: projectile.canReturn,
        returnsSoFar: projectile.returnsSoFar,
        homingStrength: projectile.homingStrength,
      }),
    (entry, projectile) => {
      entry.x = projectile.position.x;
      entry.y = projectile.position.y;
      entry.velocityX = projectile.velocity.x;
      entry.velocityY = projectile.velocity.y;
      entry.bouncesRemaining = projectile.bouncesRemaining;
      entry.piercesRemaining = projectile.piercesRemaining;
      entry.returnsSoFar = projectile.returnsSoFar;
    },
  );

  reconcile(
    state.groundLoot,
    world.groundLoot,
    (loot) =>
      new GroundLootState({
        id: loot.id,
        x: loot.position.x,
        y: loot.position.y,
        radius: loot.radius,
        lootId: loot.definition.id,
      }),
    // Ground loot never moves or changes once it lands: it is added when it
    // drops and deleted when it is taken, and nothing in between.
    () => {},
  );

  reconcile(
    state.skillChips,
    world.skillChips,
    (chip) =>
      new SkillChipState({
        id: chip.id,
        x: chip.position.x,
        y: chip.position.y,
        radius: chip.radius,
        skillId: chip.definition.id,
      }),
    () => {},
  );

  reconcile(
    state.extractionPoints,
    world.extractionPoints,
    (point) =>
      new ExtractionPointState({
        id: point.id,
        x: point.position.x,
        y: point.position.y,
        radius: point.radius,
        remainingActiveMs: point.remainingActiveMs,
      }),
    (entry, point) => {
      // A rotating point keeps its id and moves (concept §17.1's "reopens
      // elsewhere"), so position is updated, not recreated.
      entry.x = point.position.x;
      entry.y = point.position.y;
      entry.remainingActiveMs = point.remainingActiveMs;
    },
  );
}
