// Handler-level checks for Phase 5b against the LOCAL database only.
//
// Not part of `npx vitest run` (vitest.config.ts includes *.test.ts only, and
// these are *.dbtest.ts), because the default suite is pure and runs in CI
// with no database. Run it with the local URL from .env.local, and nothing
// else (phase5b.dbtest.ts refuses any other host):
//
//   DATABASE_URL="$(grep DATABASE_URL= .env.local | cut -d'"' -f2)" TZ=UTC \
//     npx vitest run --config scripts/phase5b/vitest.db.config.mts
//
// It creates its own throwaway organization and deletes it at the end.
import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL("../../src/", import.meta.url)) },
  },
  test: {
    root: fileURLToPath(new URL("../..", import.meta.url)),
    environment: "node",
    include: ["scripts/phase5b/**/*.dbtest.ts"],
    testTimeout: 120_000,
    hookTimeout: 180_000,
    fileParallelism: false,
  },
});
