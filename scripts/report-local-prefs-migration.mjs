#!/usr/bin/env node
// Dry-run report for the one-time localStorage move (settings-architecture
// 7.3, src/lib/local-prefs-migration.ts). READ ONLY: it never writes, and it
// refuses a non-local database unless --allow-remote is passed.
//
// Browser storage cannot be counted from the server, so what this reports is
// the side the server CAN see: per organization, how many people have no
// value yet for each server key the move would fill. Those are the people
// whose browser value, if they still hold one, WILL be carried up on their
// next sign-in; everyone else already has a server value, and the server
// wins (their old browser key is removed without a write).
//
//   node scripts/report-local-prefs-migration.mjs [--out <file>] [--allow-remote]
//
// The write itself happens in each browser, once, key by key, and removes a
// key only after the write that carried it succeeded (see the module).

import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { writeFileSync } from "node:fs";
import dotenv from "dotenv";
import pg from "pg";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const value = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};

dotenv.config({ path: join(ROOT, ".env.local") });
dotenv.config({ path: join(ROOT, ".env") });
const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is not set");
  process.exit(2);
}
const host = new URL(url).hostname;
if (!["localhost", "127.0.0.1", "::1"].includes(host) && !flag("--allow-remote")) {
  console.error(`DATABASE_URL host is ${host}; pass --allow-remote to read a non-local database`);
  process.exit(2);
}

const client = new pg.Client({ connectionString: url });
await client.connect();
try {
  await client.query("SET default_transaction_read_only = on");
  await client.query("BEGIN READ ONLY");
  const { rows } = await client.query(`
    SELECT u."organizationId" AS org,
           COUNT(*)::int AS people,
           COUNT(p."userId")::int AS "withPreferenceRow",
           COUNT(*) FILTER (WHERE p.sidebar IS NULL OR p.sidebar->'width' IS NULL)::int AS "noSidebarWidth",
           COUNT(*) FILTER (WHERE p.sidebar IS NULL OR p.sidebar->'collapsed' IS NULL)::int AS "noSidebarCollapsed",
           COUNT(*) FILTER (WHERE p.sidebar IS NULL OR p.sidebar->'quickTools' IS NULL)::int AS "noQuickTools",
           COUNT(*) FILTER (WHERE p.home IS NULL OR p.home->'notifications'->'mutedUntil' IS NULL)::int AS "noMutedUntil",
           COUNT(*) FILTER (WHERE p.home IS NULL OR p.home->'notifications'->'desktop' IS NULL)::int AS "noDesktopPref",
           COUNT(*) FILTER (WHERE p.density IS NULL)::int AS "noDensity",
           COUNT(*) FILTER (WHERE p.home IS NULL OR jsonb_array_length(COALESCE(p.home->'work'->'savedFilters', '[]'::jsonb)) = 0)::int AS "noSavedFilters",
           COUNT(*) FILTER (WHERE u."presenceStatus" IS NULL)::int AS "noPresence"
      FROM "User" u
      LEFT JOIN "UserPreference" p ON p."userId" = u.id
     WHERE u."deletedAt" IS NULL
     GROUP BY u."organizationId"
     ORDER BY people DESC
  `);
  await client.query("ROLLBACK");
  const totals = rows.reduce((acc, r) => {
    for (const [k, v] of Object.entries(r)) if (typeof v === "number") acc[k] = (acc[k] ?? 0) + v;
    return acc;
  }, {});
  const report = {
    kind: "local-prefs-migration dry run",
    at: new Date().toISOString(),
    database: host,
    note: "Counts of people with NO server value for each key: their browser value, if any, is carried up once on next sign-in. Nothing was written.",
    organizations: rows.length,
    totals,
    perOrg: rows,
  };
  const out = value("--out");
  if (out) writeFileSync(out, JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ ...report, perOrg: `${rows.length} rows${out ? `, full list in ${out}` : ""}` }, null, 2));
} finally {
  await client.end();
}
