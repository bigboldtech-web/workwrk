import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
  {
    rules: {
      // Stylistic-only — React renders raw apostrophes/quotes correctly
      // and we don't ship any user-supplied content through these JSX
      // text nodes. Demoting to a warning so the signal stays in the
      // local lint pass without gating CI on cosmetic escapes.
      "react/no-unescaped-entities": "warn",
    },
  },
]);

export default eslintConfig;
