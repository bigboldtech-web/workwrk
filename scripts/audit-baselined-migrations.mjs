// Verify that migrations marked "applied" in _prisma_migrations actually
// have their schema changes present in the DB. Catches the class of bug
// where a migration was baselined via `prisma migrate resolve --applied`
// without its SQL ever running.
//
// Run with: node scripts/audit-baselined-migrations.mjs
import { Client } from "pg";
import "dotenv/config";

const pooled = process.env.DATABASE_URL;
const url = process.env.DIRECT_URL || (pooled ? pooled.replace("-pooler.", ".") : undefined);

if (!url) {
  console.error("audit: no DATABASE_URL / DIRECT_URL set");
  process.exit(1);
}

const client = new Client({ connectionString: url });
await client.connect();

async function tableExists(name) {
  const r = await client.query(`SELECT to_regclass($1) AS t`, [`public."${name}"`]);
  return r.rows[0].t !== null;
}

async function columnExists(table, column) {
  const r = await client.query(
    `SELECT 1 FROM information_schema.columns
     WHERE table_schema='public' AND table_name=$1 AND column_name=$2`,
    [table, column],
  );
  return r.rowCount > 0;
}

async function indexExists(name) {
  const r = await client.query(
    `SELECT 1 FROM pg_indexes WHERE schemaname='public' AND indexname=$1`,
    [name],
  );
  return r.rowCount > 0;
}

async function enumExists(name) {
  const r = await client.query(
    `SELECT 1 FROM pg_type t
     JOIN pg_namespace n ON t.typnamespace = n.oid
     WHERE n.nspname='public' AND t.typname=$1 AND t.typtype='e'`,
    [name],
  );
  return r.rowCount > 0;
}

const checks = [
  { mig: "add_onboarding_training", kind: "enum",   name: "OnboardingStatus" },
  { mig: "add_onboarding_training", kind: "table",  name: "OnboardingTemplate" },
  { mig: "add_onboarding_training", kind: "table",  name: "OnboardingInstance" },
  { mig: "review_perf_indexes",     kind: "index",  name: "Review_cycleId_status_idx" },
  { mig: "review_perf_indexes",     kind: "index",  name: "Review_reviewerId_idx" },
  { mig: "task_calendar_phase1",    kind: "column", table: "Task", name: "startAt" },
  { mig: "task_calendar_phase1",    kind: "table",  name: "TaskComment" },
  { mig: "task_calendar_phase1",    kind: "table",  name: "TaskLabel" },
  { mig: "task_calendar_phase1",    kind: "table",  name: "CalendarSubscription" },
  { mig: "survey_anonymous_flag",   kind: "column", table: "PulseSurvey", name: "anonymous" },
  { mig: "sop_folders",             kind: "table",  name: "SOPFolder" },
  { mig: "sop_folders",             kind: "table",  name: "SOPFolderAccess" },
  { mig: "sop_folders",             kind: "column", table: "SOP", name: "folderId" },
];

let missing = 0;
for (const c of checks) {
  let exists;
  if (c.kind === "table")  exists = await tableExists(c.name);
  if (c.kind === "column") exists = await columnExists(c.table, c.name);
  if (c.kind === "index")  exists = await indexExists(c.name);
  if (c.kind === "enum")   exists = await enumExists(c.name);
  const label = c.kind === "column" ? `${c.table}.${c.name}` : c.name;
  if (exists) {
    console.log(`  ok       ${c.mig.padEnd(26)} ${c.kind.padEnd(6)} ${label}`);
  } else {
    console.log(`  MISSING  ${c.mig.padEnd(26)} ${c.kind.padEnd(6)} ${label}`);
    missing++;
  }
}

console.log(missing === 0
  ? "\naudit: all baselined migration objects present."
  : `\naudit: ${missing} object(s) missing — baseline lied about them being applied.`);

await client.end();
process.exit(missing === 0 ? 0 : 2);
