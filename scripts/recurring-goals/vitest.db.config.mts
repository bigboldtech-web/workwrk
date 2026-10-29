// The live proof of repeating goals' locks against the LOCAL database only
// (docs/plans/recurring-goals.md B3, B8, C1): two settles at once make one
// period, a check-in racing the close lands before the freeze or gets the
// 409, and two closes at once close and patch once. The default suite proves
// the same logic over an in-memory store (src/lib/goals/goal-test-db.ts);
// this runs the real statements (pg_advisory_xact_lock, ON CONFLICT DO
// NOTHING, FOR UPDATE) on Postgres.
//
// Not part of `npx vitest run` (vitest.config.ts includes *.test.ts only).
// Run it with the local URL from .env.local, and nothing else
// (recurring-goals.dbtest.ts refuses any other host):
//
//   DATABASE_URL="$(grep DATABASE_URL= .env.local | cut -d'"' -f2)" TZ=UTC \
//     npx vitest run --config scripts/recurring-goals/vitest.db.config.mts
//
// It needs prisma/sql/2026-10-27-recurring-goals.sql (and, for step 4's
// item-completions.dbtest.ts, 2026-10-27-recurring-goals-kpi-identity.sql
// and 2026-10-27-item-completions.sql) applied locally, makes its own
// throwaway organizations, and deletes them at the end.
import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL("../../src/", import.meta.url)) },
  },
  test: {
    root: fileURLToPath(new URL("../..", import.meta.url)),
    environment: "node",
    include: ["scripts/recurring-goals/**/*.dbtest.ts"],
    testTimeout: 120_000,
    hookTimeout: 120_000,
    fileParallelism: false,
  },
});
