/**
 * Turning a client's access token into a trusted identity (M5.5,
 * `docs/M5_ISSUES.md` §6).
 *
 * The client signs in anonymously with Supabase (technical plan §17.1) and hands
 * the resulting access token to the room as a join option. **That token is the
 * only thing the server accepts as identity.** A client never sends a user id:
 * one it could send is one it could choose, and choosing another player's id is
 * the whole attack this replaces.
 *
 * Verification is a call to Supabase Auth (`auth.getUser(token)`), not a local
 * signature check. Local verification would be one fewer round trip, but it
 * needs a JWT/JWKS library — a dependency beyond the Supabase client, which this
 * milestone is not authorized to add. The round trip happens once per join, at a
 * boundary that already does network work, and never on the 50 ms step.
 *
 * `is_anonymous` comes back from the same call, so the server knows whether an
 * account is recoverable without asking the client to tell it
 * (`docs/DATA_MODEL.md` §2.1).
 */
import type { SupabaseClient } from "@supabase/supabase-js";

/** A verified identity. Everything downstream keys on `userId`. */
export interface VerifiedIdentity {
  readonly userId: string;
  readonly isAnonymous: boolean;
  /** Server-generated (technical plan §17.1); a client never supplies one. */
  readonly displayName: string;
}

export type TokenVerification =
  | { readonly ok: true; readonly identity: VerifiedIdentity }
  | { readonly ok: false; readonly reason: string };

/**
 * Generate the display name §17.1 requires. Derived from the user id so it is
 * stable across sessions without storing a second source of truth, and short
 * enough to render. It is not secret: a user id is not a credential, and the
 * first eight hex characters of one identify nothing an opponent could use.
 */
export function generateDisplayName(userId: string): string {
  const suffix = userId
    .replace(/[^0-9a-z]/gi, "")
    .slice(0, 6)
    .toUpperCase();
  return `Runner-${suffix.length > 0 ? suffix : "0000"}`;
}

export interface TokenVerifier {
  verify(accessToken: string | null): Promise<TokenVerification>;
}

/** Verifies against a real Supabase project. */
export class SupabaseTokenVerifier implements TokenVerifier {
  constructor(private readonly client: SupabaseClient) {}

  async verify(accessToken: string | null): Promise<TokenVerification> {
    if (accessToken === null || accessToken.length === 0) {
      return { ok: false, reason: "missing access token" };
    }

    const { data, error } = await this.client.auth.getUser(accessToken);
    if (error !== null || data.user === null) {
      // The reason is deliberately coarse. A verifier that distinguished
      // "expired" from "wrong project" from "forged" would be answering
      // questions for whoever is probing it.
      return { ok: false, reason: "access token rejected" };
    }

    return {
      ok: true,
      identity: {
        userId: data.user.id,
        isAnonymous: data.user.is_anonymous === true,
        displayName: generateDisplayName(data.user.id),
      },
    };
  }
}

/**
 * The verifier used when no Supabase project is configured — CI, a fresh clone,
 * and the browser suite (`docs/DECISIONS.md` D45/D46). It mints a distinct local
 * identity per join, so the room's per-account code paths are all exercised,
 * and it is unreachable in production because a production server without
 * Supabase does not start (`config/env.ts`'s `assertPersistenceConfigured`).
 *
 * It accepts a token if one is offered but does not verify it, because there is
 * nothing to verify against. That is why it is not a security fallback: it is
 * the "there are no accounts here" mode, and the warning in `select-store.ts`
 * says so.
 */
export class LocalTokenVerifier implements TokenVerifier {
  private counter = 0;

  verify(accessToken: string | null): Promise<TokenVerification> {
    // The token, when one is offered, *is* the identity: the same string is the
    // same account across joins. It is not verified — there is nothing to verify
    // it against — but treating it as an identity rather than ignoring it is
    // what makes this mode structurally the same shape as the real one, so
    // returning-player behavior (notably crash recovery, technical plan §14.3)
    // is exercised here rather than being reachable only with credentials.
    //
    // A tokenless join gets a fresh identity, because a tokenless client is
    // exactly a client with no session.
    let userId: string;
    if (accessToken !== null && accessToken.length > 0) {
      userId = `local-${localIdentityFrom(accessToken)}`;
    } else {
      this.counter += 1;
      userId = `local-anon-${String(this.counter).padStart(8, "0")}`;
    }
    return Promise.resolve({
      ok: true,
      identity: { userId, isAnonymous: true, displayName: generateDisplayName(userId) },
    });
  }
}

/**
 * A short, stable id for a token string. Not a security primitive — this mode
 * has no security to offer — just a deterministic mapping so one token means one
 * local account.
 */
function localIdentityFrom(token: string): string {
  let hash = 0x811c_9dc5;
  for (let index = 0; index < token.length; index += 1) {
    hash ^= token.charCodeAt(index);
    hash = Math.imul(hash, 0x0100_0193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}
