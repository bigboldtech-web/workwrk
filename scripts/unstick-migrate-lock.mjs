// Clears a stuck Prisma migration advisory lock on the database.
//
// Prisma takes advisory lock 72707369 while running `migrate deploy`.
// If an earlier `migrate` process was killed mid-flight, the lock's
// holder session may still be alive on the server, blocking the next
// run with P1002 (timeout acquiring advisory lock).
//
// This script:
//   1. Lists sessions currently holding the Prisma migration lock
//   2. Terminates those sessions (releases the lock)
// It does NOT touch your own session or unrelated application queries.
//
// Run with: node scripts/unstick-migrate-lock.mjs
import { Client } from "pg";
import "dotenv/config";

const PRISMA_LOCK_ID = 72707369;
const pooled = process.env.DATABASE_URL;
const url = process.env.DIRECT_URL || (pooled ? pooled.replace("-pooler.", ".") : undefined);

if (!url) {
  console.error("unstick-migrate-lock: no DATABASE_URL / DIRECT_URL set");
  process.exit(1);
}

const client = new Client({ connectionString: url, statement_timeout: 15_000 });
await client.connect();

const holders = await client.query(
  `SELECT a.pid, a.state, a.application_name, a.query_start, a.query
   FROM pg_locks l
   JOIN pg_stat_activity a ON a.pid = l.pid
   WHERE l.locktype = 'advisory'
     AND l.objid = $1
     AND l.pid <> pg_backend_pid()`,
  [PRISMA_LOCK_ID],
);

if (holders.rows.length === 0) {
  console.log("unstick-migrate-lock: no stuck holders — lock is free.");
  await client.end();
  process.exit(0);
}

console.log(`unstick-migrate-lock: found ${holders.rows.length} holder(s):`);
for (const row of holders.rows) {
  console.log(`  pid=${row.pid} state=${row.state} app=${row.application_name} since=${row.query_start}`);
}

const killed = await client.query(
  `SELECT pg_terminate_backend(pid) AS ok, pid
   FROM pg_stat_activity a
   WHERE pid IN (SELECT l.pid FROM pg_locks l
                 WHERE l.locktype = 'advisory'
                   AND l.objid = $1
                   AND l.pid <> pg_backend_pid())`,
  [PRISMA_LOCK_ID],
);

console.log(`unstick-migrate-lock: terminated ${killed.rowCount} session(s).`);
await client.end();
