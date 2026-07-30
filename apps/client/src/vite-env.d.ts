/// <reference types="vite/client" />

// Strongly type the VITE_* variables this client reads from `import.meta.env`,
// so a missing or renamed variable is a compile error rather than a runtime
// surprise. See `.env.example` for the values.
interface ImportMetaEnv {
  readonly VITE_GAME_SERVER_URL: string;
  readonly VITE_BUILD_VERSION: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
