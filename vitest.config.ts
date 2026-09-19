import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

// Unit tests only: pure modules, nothing that touches React, the database or
// the network, so the default node environment is right and the suite stays
// fast enough to run on every change. Next.js builds ignore this file.
//
// THE INCLUDE LIST FOLLOWS THE FILES, not one directory. Five tests under
// src/components/marketing were invisible to `npx vitest run` for exactly as
// long as this read "src/lib/**" alone: they passed under a config of their
// own and nobody ran that config, which is the same as not having them. A
// test the mandated command does not execute is not a test.
//
// The `@` alias is here for the same reason: it is what tsconfig's paths
// give the app, so a test that imports a module the way the app imports it
// resolves under vitest too.
export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src/", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts", "scripts/**/*.test.ts"],
  },
});
