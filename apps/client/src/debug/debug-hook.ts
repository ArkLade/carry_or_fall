/**
 * A read-only debug hook exposed on `window`, for browser-driven tests
 * (Playwright, `docs/TEST_PLAN.md` §2.3) to observe simulation state without
 * a separate transport. This is an **observation** channel only: every
 * method returns state the client already computed; nothing here can change
 * game state, issue input, or run a game rule (technical plan §5.1's "client
 * sends intent, renders state" invariant is unaffected by a read-only
 * observer).
 *
 * Dev/test builds only. `import.meta.env.DEV` is a Vite compile-time
 * constant: `vite build`'s production mode replaces it with the literal
 * `false`, and esbuild's minifier then dead-code-eliminates the guarded
 * block entirely, so this module contributes nothing to the production
 * bundle — verified by `apps/client/test/build.test.ts`, which asserts the
 * built output does not contain {@link DEBUG_HOOK_KEY}.
 */
import type { World } from "@carry-or-fall/simulation-core";

/** The `window` property name the hook is installed under. */
export const DEBUG_HOOK_KEY = "__CARRY_OR_FALL_DEBUG__";

export interface CarryOrFallDebugHook {
  /** The current simulation world, or `null` before a run has started. */
  readonly getWorld: () => World | null;
  /** The currently active Phaser scene's key ("loadout", "play", "boot"), or `null`. */
  readonly getActiveSceneKey: () => string | null;
}

declare global {
  interface Window {
    [DEBUG_HOOK_KEY]?: CarryOrFallDebugHook;
  }
}

/** Install `hook` on `window`, only in a dev build (never in production). */
export function installDebugHook(hook: CarryOrFallDebugHook): void {
  if (import.meta.env.DEV) {
    window[DEBUG_HOOK_KEY] = hook;
  }
}
