/**
 * `@carry-or-fall/game-content` — data-driven content definitions.
 *
 * M0 ships type placeholders only. Concrete content (weapons, armor, skills,
 * loot, enemies, bosses) is deferred to the milestones that implement each
 * system, per the concept document. There are intentionally no content *values*
 * here yet: adding a real weapon later should be a data definition plus tests,
 * not a rewrite (see docs/DEVELOPMENT_RULES.md, "Content and code quality").
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
