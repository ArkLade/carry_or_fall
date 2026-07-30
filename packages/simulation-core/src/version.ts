/**
 * Version of the deterministic simulation ruleset. Authoritative gameplay is not
 * implemented in M0; this placeholder exists so that once deterministic movement
 * and combat land, any change to the rules can bump this number and let replays
 * or lockstep checks detect a mismatch. It is intentionally not `0.0.0`-style
 * because it tracks rule semantics, not the package release.
 */
export const SIMULATION_RULESET_VERSION = 0;
