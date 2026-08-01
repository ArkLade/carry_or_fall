/**
 * Version of the content tables as a whole — the third version technical plan
 * §35 requires the client and server to exchange, activated in M4
 * (`docs/DECISIONS.md` D34, `docs/PROTOCOL.md` §3).
 *
 * It lives here, with the content, because it versions the content: weapons,
 * enemies, loot, skills, and the arena. The client renders melee arcs,
 * projectile behavior cues, loot values, and point previews from its own copy of
 * these tables while the server computes outcomes from its copy, so a
 * disagreement between the two is a silent disagreement about game rules.
 *
 * Bump this whenever a change to any content definition would make a stale
 * client disagree with the server about what a player sees or is awarded —
 * changed damage, changed ranges, added or removed ids, changed arena geometry.
 * A purely cosmetic change (a comment, a reordering that no consumer observes)
 * does not require a bump.
 *
 * Version 1 is M4's content: two weapons, one enemy, the loot table, ten
 * skills, and one arena.
 */
export const CONTENT_VERSION = 1;
