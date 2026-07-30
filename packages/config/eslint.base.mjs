// Shared ESLint flat-config building blocks for the Carry or Fall monorepo.
// The root eslint.config.mjs spreads these and layers on type-aware parsing
// (parserOptions.projectService). Keeping the pieces here avoids duplicating
// rule sets if additional flat configs are ever added.

import js from "@eslint/js";
import tseslint from "typescript-eslint";

// Paths ESLint must never lint: dependencies, build output, coverage, generated
// design artifacts, and this repo's own tooling/config files (plain ESM or
// standalone TS that are not part of any source tsconfig and would otherwise
// break type-aware parsing).
export const ignores = [
  "**/node_modules/**",
  "**/dist/**",
  "**/build/**",
  "**/out/**",
  "**/coverage/**",
  "**/.vite/**",
  "design-artifacts/**",
  "**/*.tsbuildinfo",
  "**/*.config.js",
  "**/*.config.cjs",
  "**/*.config.mjs",
  "**/*.config.ts",
  "eslint.config.mjs",
  "**/eslint.base.mjs",
];

// Ordered flat-config blocks applied to every TypeScript source file.
export const baseConfigs = [
  js.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  {
    rules: {
      // Allow intentionally unused identifiers when prefixed with an underscore.
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
        },
      ],
      // Server authority and async correctness depend on promises never being
      // dropped silently; these are the two highest-value type-aware rules here.
      "@typescript-eslint/no-floating-promises": "error",
      "@typescript-eslint/no-misused-promises": "error",
    },
  },
];
