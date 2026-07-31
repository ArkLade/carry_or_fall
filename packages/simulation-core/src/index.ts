/**
 * `@carry-or-fall/simulation-core` — the headless, fixed-step local simulation
 * (`docs/M1_EXECUTION_PLAN.md` §2.1). This is the single seam the client calls
 * into (`createSimulation`/`stepSimulation`); no game rule runs in Phaser scene
 * code. M1 is complete: movement, map collision, aim, the shared attack
 * pipeline (sword + bow, with hard caps), the chaser enemy, player health and
 * death, and the dash.
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
export * from "./simulation";
export * from "./combat/caps";
export * from "./combat/events";
export * from "./combat/pipeline";
export * from "./combat/melee";
export * from "./combat/ranged";
