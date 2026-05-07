// Only run `prisma migrate deploy` when there's actual work to do.
//
// Prisma's `migrate deploy` takes a Postgres advisory lock with a
// hardcoded 10s timeout. On Neon, that lock acquisition is flaky
// even when nothing holds it, so every build can fail with P1002.
// Since migrations rarely change between deploys, we check what's
// pending ourselves (direct SQL diff of the migrations folder vs.
// the `_prisma_migrations` table) and only invoke Prisma when we
// actually have migrations to apply.
//
// When there ARE pending migrations, we still call `prisma migrate
// deploy`, with a retry loop for transient P1002 errors. Between
// retries we also clear orphaned advisory-lock holders — a killed
// previous deploy can leave its session alive on the server, holding
// lock 72707369 forever, in which case naive retries all fail the
// same way. We used to fix this by running `npm run db:unstick` by
// hand. Now the deploy script does it automatically.
//
// Run with: node scripts/deploy-migrations.mjs
import { Client } from "pg";
import { readdirSync } from "fs";
import { spawnSync } from "child_process";
import "dotenv/config";

const PRISMA_LOCK_ID = 72707369;

const pooled = process.env.DATABASE_URL;
const url = process.env.DIRECT_URL || (pooled ? pooled.replace("-pooler.", ".") : undefined);

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
