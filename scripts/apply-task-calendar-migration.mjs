// One-shot: apply the 20260421000000_task_calendar_phase1 migration's SQL
// directly.
//
// Background: this migration was marked as applied via
// `prisma migrate resolve --applied` during baselining, but the SQL
// inside it never actually ran against the production DB. Prisma now
// believes it's done and won't re-run it, yet the schema is missing
// columns (startAt, endAt, allDay, parentTaskId, etc.) and tables
// (TaskComment, TaskLabel, TaskLabelOnTask, CalendarSubscription).
// Symptom: any POST /api/tasks 500s with
//   "The column `startAt` does not exist in the current database."
//
// This script reads the migration file and applies it statement by
// statement, treating "already exists" (42P07 / 42701 / 42710) as a
// no-op so it's safe to run multiple times.
//
// Run once with: node scripts/apply-task-calendar-migration.mjs
import { Client } from "pg";
import { readFileSync } from "fs";
import "dotenv/config";

const MIGRATION_PATH = "prisma/migrations/20260421000000_task_calendar_phase1/migration.sql";
const IGNORABLE = new Set(["42P07", "42701", "42710", "42P16"]);

const url = process.env.DIRECT_URL || process.env.DATABASE_URL;

if (!url) {
  console.error("apply-task-calendar-migration: no DATABASE_URL / DIRECT_URL set");
  process.exit(1);
}

// Split the SQL into top-level statements. Naive: split on `;` at end of
// line, respecting nothing else (no strings with semicolons in this file).
const raw = readFileSync(MIGRATION_PATH, "utf8");
// Strip a statement to its non-comment content to decide whether it has
// any real SQL to execute (a chunk of only `-- ...` lines is a no-op).
function hasExecutableSql(stmt) {
  return stmt
    .split("\n")
    .some((line) => line.trim().length > 0 && !line.trim().startsWith("--"));
}

const statements = raw
  .split(/;\s*\n/)
  .map((s) => s.trim())
  .filter((s) => s.length > 0 && hasExecutableSql(s))
  .map((s) => (s.endsWith(";") ? s : s + ";"));

// Pre-check: does the parent FK already exist? The migration's
// ADD CONSTRAINT isn't idempotent in SQL.
async function constraintExists(client, name) {
  const r = await client.query(
    `SELECT 1 FROM pg_constraint WHERE conname = $1 LIMIT 1`,
    [name],
  );
  return r.rowCount > 0;
}

const client = new Client({ connectionString: url, statement_timeout: 60_000 });
await client.connect();

const parentFkExists = await constraintExists(client, "Task_parentTaskId_fkey");

let applied = 0;
let skipped = 0;

for (const stmt of statements) {
  // Skip the FK add if already present
  if (/ADD CONSTRAINT "Task_parentTaskId_fkey"/i.test(stmt) && parentFkExists) {
    console.log("skip: Task_parentTaskId_fkey already exists");
    skipped++;
    continue;
  }

  try {
    await client.query(stmt);
    const preview = stmt.split("\n").find((l) => l.trim() && !l.trim().startsWith("--")) || stmt.slice(0, 60);
    console.log(`ok:   ${preview.trim().slice(0, 80)}`);
    applied++;
  } catch (err) {
    if (IGNORABLE.has(err.code)) {
      console.log(`skip: ${err.message.split("\n")[0]} (${err.code})`);
      skipped++;
    } else {
      console.error(`FAIL (${err.code}): ${err.message}`);
      await client.end();
      process.exit(1);
    }
  }
}

await client.end();
console.log(`\napply-task-calendar-migration: ${applied} applied, ${skipped} skipped.`);
