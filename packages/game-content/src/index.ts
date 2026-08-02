/**
 * `@carry-or-fall/game-content` — data-driven content definitions.
 *
 * M1 ships the two weapons (`basic_sword`, `basic_bow`) and the one enemy
 * (`chaser`); M2 adds loot (`ALL_LOOT`); M3 adds skills (`ALL_SKILLS`); M4 adds
 * the arena (`testArena`) and `CONTENT_VERSION`, the version both ends exchange
 * at join so they cannot disagree about these tables (technical plan §35) — all
 * real data, consumed by the shared engine in `@carry-or-fall/simulation-core`.
 * Armor and bosses are deferred to the milestones that implement each system.
 * Adding a real weapon, loot item, or skill later should be a data definition
 * plus tests, not a rewrite (see docs/DEVELOPMENT_RULES.md, "Content and code
 * quality").
 */

/** Categories of content that will become data-driven definitions later. */
export type ContentKind =
  "weapon" | "armor" | "skill" | "loot" | "enemy" | "boss" | "arena" | "unlock";

/**
 * Shared shape every content definition will carry. Per-kind fields (damage,
 * cooldowns, drop tables, and so on) are added by the milestone that owns each
 * kind; keeping this minimal avoids inventing a schema before its mechanic
 * exists.
 */
export interface ContentDefinition {
  readonly id: string;
  readonly kind: ContentKind;
}

export * from "./version";
export * from "./weapons";
export * from "./enemies";
export * from "./loot";
export * from "./skills";
export * from "./arena";
export * from "./unlocks";
