/**
 * Boss content definitions (M7.1, `docs/M7_ISSUES.md` §2,
 * `docs/CONTENT_AUTHORING.md` §10). Pure data — `@carry-or-fall/simulation-core`'s
 * `boss.ts` reads this table and implements no per-boss behaviour, so a second
 * boss is a definition plus tests rather than an engine change.
 *
 * Concept §14.3 constrains the *first* boss tightly, and every field below
 * exists to satisfy one of its bullets:
 *
 * - **limited move set** — exactly three {@link BossAttack}s: two normal, one
 *   area. The shape refuses a fourth (`attacks` is a fixed triple), so "limited"
 *   is enforced by the type rather than by remembering it.
 * - **readable** — each attack telegraphs for `telegraphMs` before it lands, and
 *   the area attack telegraphs longest, because it is the one worth moving out
 *   of.
 * - **supports melee and ranged interaction** — the boss is an ordinary
 *   damageable circle, so every weapon and every skill already works against it.
 * - **drops rare loot** — `coreLootId`, exactly one core (concept §11).
 * - **attracts nearby players** — `aggroRadiusPx`, paired with `leashRadiusPx`
 *   so attraction is "come to it", not "it comes to you". See below.
 * - **one phase or behavior change** — `enrageBelowHealthFraction`.
 *
 * **The leash is a design decision, not a convenience** (`docs/DECISIONS.md`
 * D66). Concept §14.3 also asks for optional PvPvE conflict, and PvP damage is
 * M7.5 (D59), so the conflict half cannot exist yet. A boss bounded to its lair
 * gives the attraction without it: the rare drop is worth walking to, and the
 * threat is one a player chooses to enter. It also means the boss cannot reach
 * anywhere else on the map, which is what keeps it from eroding the rest of the
 * game's — and the browser suite's — assumptions about where danger is.
 *
 * Provenance: concept §14.3 describes the first boss only qualitatively. Every
 * number here is proposed and balance-deferred (concept §12.3), like M1's weapon
 * and enemy numbers.
 */
import type { ContentDefinition } from "./index";

/**
 * One boss attack. `kind` selects the shape the engine resolves it with:
 *
 * - `"arc"` — a melee sweep in front of the boss, like the player's own sword.
 * - `"area"` — a radial burst centred on the boss, ignoring facing.
 *
 * There is deliberately no `"projectile"` kind. A projectile that damages a
 * *player* is the same plumbing M7.5 owns (D59), and adding it here would be
 * doing that milestone's work under this one's name (`docs/M7_ISSUES.md` §1.4).
 */
export interface BossAttack {
  readonly id: string;
  readonly kind: "arc" | "area";
  readonly damage: number;
  /** Reach from the boss's centre, in pixels. */
  readonly rangePx: number;
  /** Full sweep width for an `"arc"` attack; ignored for `"area"`. */
  readonly arcDegrees: number;
  /** How long the wind-up is visible before the hit lands (concept §14.3, "readable"). */
  readonly telegraphMs: number;
  /** How often this attack may start, measured from the previous start. */
  readonly intervalMs: number;
}

export interface BossDefinition extends ContentDefinition {
  readonly kind: "boss";
  readonly health: number;
  readonly radius: number;
  readonly moveSpeed: number;
  /** A player inside this radius of the lair wakes the boss (concept §14.3). */
  readonly aggroRadiusPx: number;
  /** The boss never travels further than this from its lair, whatever it is chasing. */
  readonly leashRadiusPx: number;
  /**
   * Exactly three attacks: two normal, then the area attack last (concept
   * §14.3's "two normal attacks, one area attack"). A fixed triple rather than
   * an array, so a fourth cannot be added without changing the type — which is
   * the point at which someone should re-read §14.3's "do not build a complex
   * raid boss".
   */
  readonly attacks: readonly [BossAttack, BossAttack, BossAttack];
  /** Concept §14.3's "one phase or behavior change": below this fraction of health. */
  readonly enrageBelowHealthFraction: number;
  /** What enrage does: every attack interval is multiplied by this (so, shortened). */
  readonly enrageIntervalMultiplier: number;
  /** The boss core this boss drops on death — one, per concept §11. */
  readonly coreLootId: string;
}

/**
 * The one boss M7 ships (technical plan §38 M7: "one boss").
 *
 * Health is deliberately modest. Concept §14.3 says in as many words not to
 * build a complex raid boss for the first version, and a first boss that takes
 * several minutes to kill is one no test — and no playtest — will exercise
 * often enough to find anything wrong with. At 300 health a sword-focused player
 * lands 25 swings; a bow-focused one takes comparably long at range while having
 * to keep moving out of the area attack.
 */
export const warden: BossDefinition = {
  id: "warden",
  kind: "boss",
  health: 300,
  radius: 34,
  // Slightly slower than the player's 220 px/s, so a ranged player can open
  // distance but not trivially: closing is the boss's job, kiting costs real
  // movement.
  moveSpeed: 150,
  aggroRadiusPx: 320,
  leashRadiusPx: 420,
  attacks: [
    {
      id: "warden_cleave",
      kind: "arc",
      damage: 14,
      rangePx: 96,
      arcDegrees: 110,
      telegraphMs: 400,
      intervalMs: 1_800,
    },
    {
      id: "warden_slam",
      kind: "arc",
      damage: 20,
      rangePx: 72,
      arcDegrees: 200,
      telegraphMs: 550,
      intervalMs: 3_200,
    },
    {
      // The area attack: the one that punishes standing at mid-range, which is
      // what stops a ranged player from kiting for free.
      id: "warden_nova",
      kind: "area",
      damage: 26,
      rangePx: 260,
      arcDegrees: 360,
      telegraphMs: 900,
      intervalMs: 7_000,
    },
  ],
  enrageBelowHealthFraction: 0.5,
  enrageIntervalMultiplier: 0.6,
  coreLootId: "split_return_core",
} as const;

/** Every boss the game defines. One, per technical plan §38 M7. */
export const ALL_BOSSES: readonly BossDefinition[] = [warden] as const;

/** Look up a boss definition by id, or `null` if the id is unknown. */
export function findBoss(bossId: string): BossDefinition | null {
  return ALL_BOSSES.find((boss) => boss.id === bossId) ?? null;
}
