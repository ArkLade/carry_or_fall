/**
 * `@carry-or-fall/game-content` — data-driven content definitions.
 *
 * M1 ships the two weapons (`basic_sword`, `basic_bow`) and the one enemy
 * (`chaser`) as real data, consumed by the shared engine in
 * `@carry-or-fall/simulation-core`. Armor, skills, loot, and bosses are
 * deferred to the milestones that implement each system. Adding a real weapon
 * later should be a data definition plus tests, not a rewrite (see
 * docs/DEVELOPMENT_RULES.md, "Content and code quality").
 */

/** Categories of content that will become data-driven definitions later. */
export type ContentKind = "weapon" | "armor" | "skill" | "loot" | "enemy" | "boss";

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

export * from "./weapons";
export * from "./enemies";
