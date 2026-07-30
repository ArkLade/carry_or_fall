// Root ESLint flat config for the Carry or Fall monorepo.
// Type-aware linting is enabled through the TypeScript project service, which
// locates the nearest tsconfig for each linted file automatically.

import tseslint from "typescript-eslint";

import { baseConfigs, ignores } from "./packages/config/eslint.base.mjs";

export default tseslint.config(
  { ignores },
  ...baseConfigs,
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  {
    // Server and test code legitimately log to the console; nothing else does.
    files: ["apps/server/**/*.ts", "**/*.test.ts"],
    rules: {
      "no-console": "off",
    },
  },
);
