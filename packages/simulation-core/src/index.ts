/**
 * `@carry-or-fall/simulation-core` — the headless, fixed-step simulation
 * (`docs/M1_EXECUTION_PLAN.md` §2.1). It is the single seam a host calls into
 * (`createSimulation`/`stepSimulation`); no game rule runs in Phaser scene code.
 *
 * Through M3 that host was the browser client, running a local single-player
 * world. From M4 the host is the **authoritative Colyseus room**
 * (`apps/server/src/rooms/MatchRoom.ts`): the server steps one world holding two
 * to eight players from their validated inputs, and the client renders the
 * result without stepping anything. Nothing in this package knows about the
 * network — it gained a player collection, not a transport.
 */
export * from "./version";
export * from "./prng";
export * from "./vec2";
export * from "./angles";
export * from "./world";
export * from "./movement";
export * from "./collision";
export * from "./dash";
export * from "./enemy";
export * from "./inventory";
export * from "./points";
export * from "./build-effects";
export * from "./extraction";
export * from "./loot-drop";
export * from "./skill-loadout";
export * from "./skill-effects";
export * from "./skill-chip";
export * from "./run-result";
export * from "./simulation";
export * from "./combat/caps";
export * from "./combat/events";
export * from "./combat/pipeline";
export * from "./combat/melee";
export * from "./combat/ranged";
