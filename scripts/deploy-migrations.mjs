// Only run `prisma migrate deploy` when there's actual work to do.
//
// Prisma's `migrate deploy` takes a Postgres advisory lock with a
// hardcoded 10s timeout. Since migrations rarely change between
// deploys, we check what's pending ourselves (direct SQL diff of
// the migrations folder vs. the `_prisma_migrations` table) and
// only invoke Prisma when we actually have migrations to apply.
//
// When there ARE pending migrations, we call `prisma migrate
// deploy` with a retry loop. Between retries we also clear orphaned
// advisory-lock holders — a killed previous deploy can leave its
// session alive on the server, holding lock 72707369 forever, in
// which case naive retries all fail the same way.
//
// Run with: node scripts/deploy-migrations.mjs
import { Client } from "pg";
import { readdirSync, existsSync } from "fs";
import { spawnSync } from "child_process";
import "dotenv/config";

const PRISMA_LOCK_ID = 72707369;

const url = process.env.DIRECT_URL || process.env.DATABASE_URL;

if (!url) {
  console.error("deploy-migrations: no DATABASE_URL / DIRECT_URL set");
  process.exit(1);
}

// ── Hand-written SQL (prisma/sql) ─────────────────────────────────────
//
// WHY THIS EXISTS. `prisma migrate deploy` reads prisma/migrations and
// nothing else, so for a long time the files in prisma/sql were applied
// by hand on the box before each deploy. Miss one and the new release
// meets a database without its tables: the deploy "succeeds" and the
// product 500s. Applying them here closes that window, because this
// script runs inside `npm run build`, before `next build` and therefore
// before pm2 reloads onto the new release. A failure below exits non
// zero, which aborts the build and leaves production on the old build.
//
// EXPLICIT MANIFEST, not a directory glob. A glob would auto-apply
// whatever happens to be in the folder, including files that are not
// idempotent or are deliberately withheld. Add a file here only after
// reading it.
//
// NOT IN THE MANIFEST, on purpose:
//   2026-07-21-operating-core.sql — 35 DDL statements with ZERO
//   IF NOT EXISTS guards, so it is additive but NOT idempotent, and it
//   belongs to the Operating Core work which is deliberately gated. Since
//   everything here runs on EVERY deploy, a non-idempotent file would fail
//   the second one. Leave it to a decision, not a glob.
const SQL_MANIFEST = [
  "2026-09-18-task-detail-phase2.sql",
  "2026-09-18-notification-cleared-at.sql",
  "2026-09-19-archived-by.sql",
  "2026-09-19-canvas-folder.sql",
  "2026-09-19-template-key.sql",
  // Phase 3 (knowledge unit). Both are ADD COLUMN IF NOT EXISTS only. The
  // contract routes select the new Agreement / AgreementParty columns on
  // every read, so a release that shipped without this line would 500 on
  // every contract list, open, send and sign until the file was applied by
  // hand; the doc-lock columns are read through a raw query that tolerates
  // their absence, but they belong here for the same reason.
  "2026-09-21-doc-lock.sql",
  "2026-09-21-contract-send-decline.sql",
  "2026-09-21-agreement-archived-by.sql",
  // Phase 4 (Time and Talk). Seven ADD COLUMN IF NOT EXISTS statements plus
  // one already-satisfied UPDATE. It belongs here because Prisma selects
  // every model field on a findMany with no select, so the moment the client
  // knows about Meeting.deletedAt or Conversation.findable, a database
  // without those columns 500s the meetings list and the Talk sidebar.
  "2026-09-22-time-and-talk.sql",
  // Phase 4, decided additions (b) and (c): the org working calendar table
  // and the two time-tracking-depth columns. It is late-safe only because
  // every TimeEntry query on the clock and timesheet paths names its
  // columns explicitly (a bare Prisma query emits every scalar, including
  // billable and tags, and would 500 the clock against a database without
  // them) and because readOrgWorkSchedule swallows a missing table and
  // answers the defaults. Read the header of the .sql file before touching
  // any TimeEntry query.
  "2026-09-22-work-schedule.sql",
  // Phase 4, spec-planner section 4 step 6: Meeting."itemId", the link to
  // the hidden per-organization Meetings List, so a meeting is gated through
  // the one Item ladder rather than through a new object type. Same reason
  // as the file two above: once the generated client knows about the column,
  // a database without it 500s the meetings list, because a findMany with no
  // select asks for every scalar. The Item rows themselves are a separate,
  // dry-run-by-default data script (scripts/backfill-meeting-items.mjs) and
  // are NOT part of the deploy.
  "2026-09-22-meeting-item.sql",
  // Phase 4, spec-planner section 2 `/planner` Data: the CalendarEvent
  // table, the home for a personal calendar entry and for the rows the
  // Google sync cron brings in. Deploy order is free (every reader is
  // wrapped and answers "no events" while the relation is absent), but it
  // belongs in the manifest anyway: until it is applied, "New event" on the
  // Calendar surfaces a failure instead of saving, and that is a visible
  // regression rather than a quiet one.
  "2026-09-22-calendar-event.sql",
  // Phase 4, the Calendar's "Show declined Google events" switch:
  // CalendarEvent."declined". Genuinely late-safe, and checked rather than
  // asserted: the calendar read tries the filtered query and falls back to
  // the unfiltered one, and the sync write retries without the field. It is
  // in the manifest so the switch stops being a control with no effect on
  // the same deploy that ships it.
  "2026-09-22-calendar-declined.sql",
  // Phase 5, the form builder: FormDefinition."settings" (JSONB NOT NULL
  // DEFAULT '{}'), the form's own settings bucket. One ADD COLUMN IF NOT
  // EXISTS and no backfill: an empty bucket reads as today's behaviour. It
  // must land before the code, because a findFirst with no select asks for
  // every scalar and would 500 the builder and the /forms list.
  "2026-09-23-form-settings.sql",
  // Phase 5b, the data layer: "ItemListLink" (tasks in more than one List)
  // and "ReportSchedule" (scheduled email reports). Two CREATE TABLE IF NOT
  // EXISTS, five indexes, three guarded foreign keys, nothing else. Deploy
  // order is free: no existing model gains a column, every link reader
  // falls back to today's home-only read while the table is absent, and the
  // report routes answer a named 503 (the cron a no-op) until it lands. It
  // is here so the release that ships the code is the release that can use it.
  "2026-09-24-phase5b-data.sql",
];

/**
 * Apply each manifest file with `prisma db execute`.
 *
 * WHY PRISMA AND NOT A RAW pg CLIENT. The first version of this opened its own
 * `new Client({ connectionString: DIRECT_URL || DATABASE_URL })`, and the
 * deploy died three minutes in, before the build, with no log I could read.
 * That client is not the connection path the rest of the deploy has been
 * proving for months: `prisma migrate deploy` and `prisma generate` resolve
 * their datasource through prisma.config.ts, which may not be the same URL,
 * SSL mode or socket. Using the proven path removes a whole class of failure
 * rather than guessing at which part of it bit.
 *
 * EVERY FILE IN THE MANIFEST MUST BE IDEMPOTENT, because this runs on every
 * deploy and there is no ledger any more. The ledger existed to make a
 * non-idempotent file safe, but the manifest already refuses those (see the
 * note on operating-core above), so it was protecting against a case that is
 * not allowed to exist, at the cost of a second connection that broke the
 * deploy. Guard every statement with IF NOT EXISTS, and guard any backfill on
 * its own effect.
 *
 * A failure exits non zero, which aborts the build before pm2 reloads, so
 * production stays on the previous release rather than meeting a database
 * that is missing what the new code needs.
 */
function applyHandWrittenSql() {
  for (const name of SQL_MANIFEST) {
    const file = `prisma/sql/${name}`;
    if (!existsSync(file)) {
      console.error(`deploy-migrations: ${file} is in the manifest but missing on disk`);
      return false;
    }
    console.log(`deploy-migrations: applying sql ${name}`);
    const r = spawnSync("npx", ["prisma", "db", "execute", "--file", file], { stdio: "inherit" });
    if (r.status !== 0) {
      console.error(`deploy-migrations: ${name} FAILED (exit ${r.status}). Aborting before the build.`);
      return false;
    }
    console.log(`deploy-migrations: applied ${name}`);
  }
  return true;
}

function runPrismaDeploy() {
  const r = spawnSync("npx", ["prisma", "migrate", "deploy"], { stdio: "inherit" });
  return r.status === 0;
}

// Mirrors scripts/unstick-migrate-lock.mjs. Returns the number of
// holder sessions we terminated. Safe to call when the lock is free
// (returns 0). Best-effort: if the cleanup query itself errors we log
// and let the retry try anyway — we don't want a transient pg blip
// here to fail the whole build.
async function clearStuckLockHolders() {
  const client = new Client({ connectionString: url, statement_timeout: 15_000 });
  try {
    await client.connect();
    const holders = await client.query(
      `SELECT a.pid, a.state, a.application_name, a.query_start
       FROM pg_locks l
       JOIN pg_stat_activity a ON a.pid = l.pid
       WHERE l.locktype = 'advisory'
         AND l.objid = $1
         AND l.pid <> pg_backend_pid()`,
      [PRISMA_LOCK_ID],
    );
    if (holders.rows.length === 0) return 0;
    console.log(`deploy-migrations: clearing ${holders.rows.length} orphaned migration-lock holder(s):`);
    for (const row of holders.rows) {
      console.log(`  pid=${row.pid} state=${row.state} app=${row.application_name} since=${row.query_start}`);
    }
    const killed = await client.query(
      `SELECT pg_terminate_backend(pid) FROM pg_stat_activity
       WHERE pid IN (SELECT l.pid FROM pg_locks l
                     WHERE l.locktype = 'advisory'
                       AND l.objid = $1
                       AND l.pid <> pg_backend_pid())`,
      [PRISMA_LOCK_ID],
    );
    return killed.rowCount ?? 0;
  } catch (err) {
    console.log(`deploy-migrations: clear-holders failed (${err.code || err.message}); continuing`);
    return 0;
  } finally {
    try { await client.end(); } catch {}
  }
}

async function runPrismaDeployWithRetry(attempts = 3, delayMs = 15_000) {
  for (let i = 1; i <= attempts; i++) {
    console.log(`deploy-migrations: running prisma migrate deploy (attempt ${i}/${attempts})`);
    if (runPrismaDeploy()) return true;
    if (i < attempts) {
      // Clear stuck holders before sleeping so a release has time to
      // propagate before we try again.
      await clearStuckLockHolders();
      console.log(`deploy-migrations: retrying in ${delayMs / 1000}s...`);
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }
  return false;
}

// Hand-written SQL first: the new release's code depends on these objects,
// and `next build` runs after this script. Abort the whole build if any of
// them fails rather than reloading onto a release the database cannot serve.
if (!applyHandWrittenSql()) {
  console.error("deploy-migrations: aborting the build; production stays on the previous release");
  process.exit(1);
}

const onDisk = readdirSync("prisma/migrations", { withFileTypes: true })
  .filter((d) => d.isDirectory())
  .map((d) => d.name)
  .sort();

const client = new Client({ connectionString: url, statement_timeout: 15_000 });

let applied = null;
try {
  await client.connect();
  const r = await client.query(
    `SELECT migration_name FROM _prisma_migrations
     WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL`,
  );
  applied = new Set(r.rows.map((row) => row.migration_name));
} catch (err) {
  // Table may not exist yet, or DB may be unreachable. Fall through
  // to prisma, which handles its own baselining / errors.
  console.log(`deploy-migrations: couldn't check migration state (${err.code || err.message}), delegating to prisma`);
} finally {
  try { await client.end(); } catch {}
}

if (applied === null) {
  const ok = await runPrismaDeployWithRetry();
  process.exit(ok ? 0 : 1);
}

const pending = onDisk.filter((m) => !applied.has(m));

if (pending.length === 0) {
  console.log(`deploy-migrations: all ${onDisk.length} migrations already applied, skipping prisma migrate deploy`);
  process.exit(0);
}

console.log(`deploy-migrations: ${pending.length} pending migration(s):`);
for (const m of pending) console.log(`  - ${m}`);

const ok = await runPrismaDeployWithRetry();
process.exit(ok ? 0 : 1);
