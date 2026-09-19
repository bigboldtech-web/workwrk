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
import { readdirSync, readFileSync } from "fs";
import { createHash } from "crypto";
import { spawnSync } from "child_process";
import "dotenv/config";

const PRISMA_LOCK_ID = 72707369;

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
//   belongs to the Operating Core work which is deliberately gated. The
//   ledger below would apply it exactly once and safely, but nobody has
//   asked for that feature to ship. Leave it to a decision, not a glob.
const SQL_MANIFEST = [
  "2026-09-18-task-detail-phase2.sql",
  "2026-09-18-notification-cleared-at.sql",
  "2026-09-19-canvas-folder.sql",
  "2026-09-19-template-key.sql",
];

const LEDGER = `
  CREATE TABLE IF NOT EXISTS "_sql_migrations" (
    filename   TEXT PRIMARY KEY,
    checksum   TEXT NOT NULL,
    applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`;

/**
 * Apply each manifest file exactly once, recording it in a ledger table.
 *
 * The ledger (rather than relying on IF NOT EXISTS everywhere) means a
 * file that is NOT idempotent still applies safely, and a file whose
 * content changed after it was applied is reported rather than re-run:
 * re-running edited DDL is how a "safe" migration quietly becomes a
 * destructive one. Each file runs in its own transaction, so a failure
 * leaves no half-applied file behind.
 */
async function applyHandWrittenSql() {
  // Deliberately NO statement_timeout here, unlike the migration-state client
  // below which uses 15s. One of these files backfills a column across every
  // row of Notification, and on a real org that single UPDATE can outlast any
  // short timeout. A timeout would abort the transaction, roll the file back,
  // and fail the deploy for no reason other than the table being big.
  const client = new Client({ connectionString: url });
  try {
    await client.connect();
  } catch (err) {
    console.error(`deploy-migrations: cannot reach the database to apply prisma/sql (${err.code || err.message})`);
    try { await client.end(); } catch {}
    return false;
  }
  try {
    await client.query(LEDGER);
    const done = new Map(
      (await client.query(`SELECT filename, checksum FROM "_sql_migrations"`)).rows.map((r) => [r.filename, r.checksum]),
    );
    for (const name of SQL_MANIFEST) {
      const path = `prisma/sql/${name}`;
      let sql;
      try {
        sql = readFileSync(path, "utf8");
      } catch {
        console.error(`deploy-migrations: ${path} is in the manifest but missing on disk`);
        return false;
      }
      const sum = createHash("sha256").update(sql).digest("hex");
      const seen = done.get(name);
      if (seen === sum) {
        console.log(`deploy-migrations: sql ${name} already applied`);
        continue;
      }
      if (seen && seen !== sum) {
        console.log(`deploy-migrations: WARNING ${name} changed after it was applied; NOT re-running it.`);
        console.log("  If the change must reach this database, ship it as a NEW file in prisma/sql.");
        continue;
      }
      console.log(`deploy-migrations: applying sql ${name}`);
      try {
        await client.query("BEGIN");
        await client.query(sql);
        await client.query(`INSERT INTO "_sql_migrations" (filename, checksum) VALUES ($1, $2)`, [name, sum]);
        await client.query("COMMIT");
        console.log(`deploy-migrations: applied ${name}`);
      } catch (err) {
        try { await client.query("ROLLBACK"); } catch {}
        console.error(`deploy-migrations: ${name} FAILED, rolled back: ${err.message}`);
        return false;
      }
    }
    return true;
  } finally {
    try { await client.end(); } catch {}
  }
}

const url = process.env.DIRECT_URL || process.env.DATABASE_URL;

if (!url) {
  console.error("deploy-migrations: no DATABASE_URL / DIRECT_URL set");
  process.exit(1);
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
if (!(await applyHandWrittenSql())) {
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
