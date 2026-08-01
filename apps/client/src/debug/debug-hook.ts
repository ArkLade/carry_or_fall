/**
 * A read-only debug hook exposed on `window`, for browser-driven tests
 * (Playwright, `docs/TEST_PLAN.md` §2.3) to observe client state without a
 * separate transport. This is an **observation** channel only: every method
 * returns state the client already received; nothing here can change game
 * state, issue input, or run a game rule.
 *
 * From M4 what it observes is the **authoritative snapshot the server sent** —
 * not an interpolated render frame and not a locally simulated world, because
 * the client no longer has one. A test asserting on these values is asserting on
 * what the server decided, which is exactly what should be asserted.
 *
 * Dev/test builds only. `import.meta.env.DEV` is a Vite compile-time constant:
 * `vite build`'s production mode replaces it with the literal `false`, and
 * esbuild's minifier then dead-code-eliminates the guarded block entirely, so
 * this module contributes nothing to the production bundle — verified by
 * `apps/client/test/build.test.ts`, which asserts the built output does not
 * contain {@link DEBUG_HOOK_KEY}.
 */
import type { LocalPlayerState, MatchView } from "@carry-or-fall/protocol";

/** The `window` property name the hook is installed under. */
export const DEBUG_HOOK_KEY = "__CARRY_OR_FALL_DEBUG__";

export interface CarryOrFallDebugHook {
  /** The latest authoritative match snapshot, or `null` before the first arrives. */
  readonly getSnapshot: () => MatchView | null;
  /** This client's own player id (its room session id), or `null` before it joins. */
  readonly getLocalPlayerId: () => string | null;
  /** This client's private state — inventory, secure slot, skills, run result — or `null`. */
  readonly getPrivateState: () => LocalPlayerState | null;
  /** The room connection status ("connecting", "connected", "reconnecting", …). */
  readonly getConnectionStatus: () => string;
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
