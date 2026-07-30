/**
 * `@carry-or-fall/simulation-core` — the headless, fixed-step local simulation
 * (`docs/M1_EXECUTION_PLAN.md` §2.1). This is the single seam the client calls
 * into (`createSimulation`/`stepSimulation`); no game rule runs in Phaser scene
 * code. M1 ships movement and map collision; combat, the enemy, health/death,
 * and dash are added by later M1 chunks.
 */
export * from "./version";
export * from "./prng";
export * from "./world";
export * from "./movement";
export * from "./collision";
export * from "./simulation";
