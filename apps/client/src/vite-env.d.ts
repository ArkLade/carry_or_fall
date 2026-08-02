/// <reference types="vite/client" />

// Strongly type the VITE_* variables this client reads from `import.meta.env`,
// so a missing or renamed variable is a compile error rather than a runtime
// surprise. See `.env.example` for the values.
interface ImportMetaEnv {
  readonly VITE_GAME_SERVER_URL: string;
  readonly VITE_BUILD_VERSION: string;
  // Supabase, browser half (M5). The publishable key is designed to be bundled
  // (technical plan §20.2); the secret key is not here, is not `VITE_`-prefixed,
  // and is asserted absent from the production bundle by `test/build.test.ts`.
  // Declaring only these four is itself a guard: reading any other variable in
  // client source is a compile error, and `test/architecture.test.ts` checks the
  // same thing from the other direction.
  readonly VITE_SUPABASE_URL: string;
  readonly VITE_SUPABASE_PUBLISHABLE_KEY: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
