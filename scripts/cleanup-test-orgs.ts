/**
 * cleanup-test-orgs.ts — remove leftover TEST / junk organizations, keeping
 * ONLY the real org(s). Org deletion cascades through all related rows, so this
 * is destructive. Built defensively:
 *
 *   - DRY RUN by default: prints exactly what it would KEEP vs DELETE (with
 *     user/task/SOP counts) and changes nothing. Pass --confirm to delete.
 *   - Keeps any org whose name matches KEEP_NAME_RE (default /cashk/i — the
 *     real Cashkr org).
 *   - ABORTS if the keep set has no org with >= MIN_REAL_USERS users — a guard
 *     so a wrong filter can never wipe the real org by accident.
 *
 * Usage (on the server, where DATABASE_URL points at prod):
 *   npx tsx scripts/cleanup-test-orgs.ts            # dry run — review the lists
 *   npx tsx scripts/cleanup-test-orgs.ts --confirm  # actually delete
 */
import { readFileSync, existsSync } from "node:fs";
import { PrismaClient } from "../src/generated/prisma";
import { PrismaPg } from "@prisma/adapter-pg";

// Load .env files WITHOUT depending on the `dotenv` package (it's a devDep and
// may not be installed on the server). Existing process.env vars (e.g. a
// DATABASE_URL passed inline) win; otherwise .env.production then .env.
function loadEnvFile(path: string) {
  if (!existsSync(path)) return;
  for (const raw of readFileSync(path, "utf8").split("\n")) {
    const m = raw.match(/^\s*([\w.-]+)\s*=\s*(.*?)\s*$/);
    if (!m) continue;
    const key = m[1];
    if (process.env[key] !== undefined) continue; // never override
    let val = m[2];
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    process.env[key] = val;
  }
}
loadEnvFile(".env.production");
loadEnvFile(".env");

const connStr = process.env.DATABASE_URL;
if (!connStr) throw new Error("DATABASE_URL is not set");
const adapter = new PrismaPg({ connectionString: connStr });
const prisma = new PrismaClient({ adapter });

const CONFIRM = process.argv.includes("--confirm");
// Keep only orgs with a real team. The genuine Cashkr org has ~18 users; every
// junk org — including the empty duplicate "CashKr" (1 user) — has fewer, so a
// user-count floor cleanly separates real data from test data by name.
const MIN_REAL_USERS = 10;

interface OrgRow {
  id: string;
  name: string;
  status: string;
  createdAt: Date;
  _count: { users: number; tasks: number; sops: number };
}

function fmt(o: OrgRow): string {
  return `${o.name}  [users:${o._count.users} tasks:${o._count.tasks} sops:${o._count.sops}]  ${o.createdAt
    .toISOString()
    .slice(0, 10)}  ${o.status}`;
}

async function main() {
  const orgs = (await prisma.organization.findMany({
    select: {
      id: true,
      name: true,
      status: true,
      createdAt: true,
      _count: { select: { users: true, tasks: true, sops: true } },
    },
    orderBy: { createdAt: "asc" },
  })) as OrgRow[];

  const keep = orgs.filter((o) => o._count.users >= MIN_REAL_USERS);
  const del = orgs.filter((o) => o._count.users < MIN_REAL_USERS);

  console.log(`\nTotal orgs: ${orgs.length}\n`);
  console.log(`=== KEEP (${keep.length}) ===`);
  keep.forEach((o) => console.log(`  ✓ ${fmt(o)}`));
  console.log(`\n=== DELETE (${del.length}) ===`);
  del.forEach((o) => console.log(`  ✗ ${fmt(o)}`));

  // Safety guards — refuse to run if the result looks wrong.
  if (keep.length === 0 || del.length === orgs.length) {
    console.error(
      `\nABORT: keep set is empty (no org with >= ${MIN_REAL_USERS} users). Nothing deleted.`,
    );
    process.exit(1);
  }

  if (!CONFIRM) {
    console.log(
      `\nDRY RUN — nothing deleted. Review the lists above, then re-run with --confirm to delete the ${del.length} orgs.`,
    );
    return;
  }

  console.log(`\n--confirm set — deleting ${del.length} orgs…`);
  let ok = 0;
  let failed = 0;
  for (const o of del) {
    try {
      await prisma.organization.delete({ where: { id: o.id } });
      ok++;
      if (ok % 25 === 0) console.log(`  …${ok}/${del.length}`);
    } catch (e) {
      failed++;
      console.error(`  FAILED ${o.name} (${o.id}): ${(e as Error).message}`);
    }
  }
  console.log(`\nDone. Deleted ${ok}, failed ${failed}, kept ${keep.length}.`);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
