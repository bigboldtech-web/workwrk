// Ping the database with a simple SELECT 1 to wake Neon's compute
// before Prisma migrations run. Without this, a cold Neon instance
// can take >10 seconds to wake, which exceeds Prisma's advisory-lock
// timeout and surfaces as P1002 on the next `migrate deploy`.
//
// Uses the same URL transform as prisma.config.ts so migrations and
// the warm-up hit the same (direct, non-pooled) endpoint.
import { Client } from "pg";
import "dotenv/config";

const pooled = process.env.DATABASE_URL;
const url = process.env.DIRECT_URL || (pooled ? pooled.replace("-pooler.", ".") : undefined);

if (!url) {
  console.error("warm-neon: no DATABASE_URL / DIRECT_URL set, skipping");
  process.exit(0);
}

const MAX_ATTEMPTS = 6;
const DELAY_MS = 2000;

async function ping(attempt) {
  const client = new Client({ connectionString: url, statement_timeout: 30_000 });
  try {
    await client.connect();
    await client.query("SELECT 1");
    await client.end();
    console.log(`warm-neon: ok (attempt ${attempt})`);
    return true;
  } catch (err) {
    try { await client.end(); } catch {}
    console.log(`warm-neon: attempt ${attempt} failed — ${err.message}`);
    return false;
  }
}

for (let i = 1; i <= MAX_ATTEMPTS; i++) {
  if (await ping(i)) process.exit(0);
  if (i < MAX_ATTEMPTS) await new Promise((r) => setTimeout(r, DELAY_MS));
}

console.error("warm-neon: could not reach database after retries — continuing anyway");
process.exit(0);
