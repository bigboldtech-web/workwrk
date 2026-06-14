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
import * as dotenv from "dotenv";
dotenv.config({ path: ".env.production" });
dotenv.config(); // .env — does not override vars already set above

import { PrismaClient } from "../src/generated/prisma";
import { PrismaPg } from "@prisma/adapter-pg";

const connStr = process.env.DATABASE_URL;
if (!connStr) throw new Error("DATABASE_URL is not set");
const adapter = new PrismaPg({ connectionString: connStr });
const prisma = new PrismaClient({ adapter });

const CONFIRM = process.argv.includes("--confirm");
const KEEP_NAME_RE = /cashk/i; // matches "Cashkr Team" / "Cashker" etc.
const MIN_REAL_USERS = 10; // the real org has ~18 users; junk orgs have 1

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

  const keep = orgs.filter((o) => KEEP_NAME_RE.test(o.name));
  const del = orgs.filter((o) => !KEEP_NAME_RE.test(o.name));

  console.log(`\nTotal orgs: ${orgs.length}\n`);
  console.log(`=== KEEP (${keep.length}) ===`);
  keep.forEach((o) => console.log(`  ✓ ${fmt(o)}`));
  console.log(`\n=== DELETE (${del.length}) ===`);
  del.forEach((o) => console.log(`  ✗ ${fmt(o)}`));

  // Safety guards — refuse to run if the result looks wrong.
  if (keep.length === 0 || del.length === orgs.length) {
    console.error("\nABORT: keep set is empty. Adjust KEEP_NAME_RE and re-run.");
    process.exit(1);
  }
  if (!keep.some((o) => o._count.users >= MIN_REAL_USERS)) {
    console.error(
      `\nABORT: no kept org has >= ${MIN_REAL_USERS} users — the keep filter may be wrong. Nothing deleted.`,
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
