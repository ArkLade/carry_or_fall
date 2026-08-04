/**
 * Remote-entity interpolation (M4.7, technical plan §11.1: "server-authoritative
 * movement, client interpolation, optional immediate local animation response,
 * **no sophisticated client prediction**"; §11.2: "do not implement prediction
 * before basic multiplayer correctness").
 *
 * The server sends an authoritative position every 50 ms; the browser draws at
 * 60 fps. Without interpolation every entity — including the local player —
 * would visibly step 50 ms at a time. This module blends between the two most
 * recent authoritative snapshots so motion is smooth.
 *
 * What it deliberately does **not** do: predict, extrapolate, rewind, or
 * reconcile. `alpha` is clamped to 1 by the caller, so a late patch holds the
 * last position the server actually sent rather than inventing one past it. The
 * cost is honest and stated in `docs/M4_ISSUES.md` §1.2: the local player's
 * movement lags input by up to one server tick plus latency. Whether that is
 * acceptable is a measurement §11.2 defers until multiplayer is correct.
 */
import type {
  BossView,
  EnemyView,
  MatchView,
  PlayerView,
  ProjectileView,
} from "@carry-or-fall/protocol";

function lerp(from: number, to: number, alpha: number): number {
  return from + (to - from) * alpha;
}

/** Index a collection by id so the previous snapshot's matching entity is a lookup, not a scan. */
function byId<T extends { readonly id: string }>(items: readonly T[]): Map<string, T> {
  return new Map(items.map((item) => [item.id, item]));
}

function blendPlayer(
  latest: PlayerView,
  previous: PlayerView | undefined,
  alpha: number,
): PlayerView {
  if (previous === undefined) {
    return latest;
  }
  return {
    ...latest,
    x: lerp(previous.x, latest.x, alpha),
    y: lerp(previous.y, latest.y, alpha),
  };
}

function blendEnemy(latest: EnemyView, previous: EnemyView | undefined, alpha: number): EnemyView {
  if (previous === undefined) {
    return latest;
  }
  return {
    ...latest,
    x: lerp(previous.x, latest.x, alpha),
    y: lerp(previous.y, latest.y, alpha),
  };
}

function blendProjectile(
  latest: ProjectileView,
  previous: ProjectileView | undefined,
  alpha: number,
): ProjectileView {
  if (previous === undefined) {
    return latest;
  }
  return {
    ...latest,
    x: lerp(previous.x, latest.x, alpha),
    y: lerp(previous.y, latest.y, alpha),
  };
}

/**
 * The boss moves continuously like any other body, so its position blends the
 * same way (M7). Its telegraph does **not**: `telegraphRemainingMs` counts down
 * toward a moment the server decides, and a blended countdown would drift away
 * from the wind-up actually being resolved — the one number in this view a
 * player is meant to react to.
 */
function blendBoss(latest: BossView, previous: BossView | null, alpha: number): BossView {
  if (previous === null || previous.id !== latest.id) {
    return latest;
  }
  return {
    ...latest,
    x: lerp(previous.x, latest.x, alpha),
    y: lerp(previous.y, latest.y, alpha),
  };
}

/**
 * Blend the moving entities of `latest` toward their positions in `previous`.
 *
 * Only positions are interpolated. Health, shields, stun, extraction progress,
 * and the melee swing are authoritative facts rather than continuous motion, so
 * they are shown exactly as the server last sent them — a half-interpolated
 * health bar would be a number no one ever decided. Ground loot, skill chips,
 * and extraction points do not move continuously either: a rotating extraction
 * point (concept §17.1) is *supposed* to jump when it reopens elsewhere.
 *
 * An entity absent from `previous` (it just spawned) is drawn at its latest
 * position; there is nothing to blend from.
 */
export function interpolateMatchView(
  previous: MatchView | null,
  latest: MatchView,
  alpha: number,
): MatchView {
  if (previous === null || alpha >= 1) {
    return latest;
  }

  const previousPlayers = byId(previous.players);
  const previousEnemies = byId(previous.enemies);
  const previousProjectiles = byId(previous.projectiles);

  return {
    ...latest,
    players: latest.players.map((player) =>
      blendPlayer(player, previousPlayers.get(player.id), alpha),
    ),
    enemies: latest.enemies.map((enemy) => blendEnemy(enemy, previousEnemies.get(enemy.id), alpha)),
    projectiles: latest.projectiles.map((projectile) =>
      blendProjectile(projectile, previousProjectiles.get(projectile.id), alpha),
    ),
    boss: latest.boss === null ? null : blendBoss(latest.boss, previous.boss, alpha),
  };
}
