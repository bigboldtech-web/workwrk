import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

// The marketing unit's test config.
//
// The root vitest.config.ts now collects these: its include is src/** and it
// carries the `@` alias, so `npx vitest run` runs them with everything else,
// which is the only run that counts.
//
// This config stays as the way to run JUST this unit while working on it:
//
//   npx vitest run --config src/components/marketing/vitest.marketing.config.ts
//
// Same environment and same shape as the root config on purpose: these are
// pure unit tests over pure modules, no React renderer, no network, no
// database.

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("../../", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    include: ["src/components/marketing/**/*.test.ts"],
    root: fileURLToPath(new URL("../../../", import.meta.url)),
  },
});
