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
// deploy`, with a retry loop for transient P1002 errors.
//
// Run with: node scripts/deploy-migrations.mjs
import { Client } from "pg";
import { readdirSync } from "fs";
import { spawnSync } from "child_process";
import "dotenv/config";

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

async function runPrismaDeployWithRetry(attempts = 3, delayMs = 15_000) {
  for (let i = 1; i <= attempts; i++) {
    console.log(`deploy-migrations: running prisma migrate deploy (attempt ${i}/${attempts})`);
    if (runPrismaDeploy()) return true;
    if (i < attempts) {
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
