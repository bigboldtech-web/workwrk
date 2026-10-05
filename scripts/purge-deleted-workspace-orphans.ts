// Delete what companies deleted for good BEFORE 2026-10-05 left behind.
//
// Until Batch 9, the hard-delete cron deleted only the Organization row and
// relied on cascades, but the tables in src/lib/admin/workspace-orphans.ts
// have no foreign key to Organization, so a deleted company's activity log,
// agreements, call records, document snapshots, email log, templates,
// reminders, assessments and Trash stayed for good, against the privacy
// policy's promise to delete workspace data 30 days after termination. The
// cron now deletes them with the company; this removes the ones already
// stranded.
//
// RUN IT ON THE SERVER, by the founder, AFTER the Batch 9 deploy (whose SQL
// first records the old deletions in WorkspaceDeletion from these very rows):
//
//   DIRECT_URL= DATABASE_URL=<the app's database> npx tsx scripts/purge-deleted-workspace-orphans.ts           # counts only
//   DIRECT_URL= DATABASE_URL=<the app's database> npx tsx scripts/purge-deleted-workspace-orphans.ts --write   # deletes
//
// It touches ONLY rows whose organizationId names no Organization row (a row
// with no organizationId, such as a global template, is never touched), in
// batches of 5000, table by table, and prints counts only. WorkspaceDeletion
// is never touched. There is no undo: read the dry run first.

import { databaseLabel, scriptPrisma } from "./lib/script-prisma";
import { WORKSPACE_ORPHAN_TABLES } from "../src/lib/admin/workspace-orphans";

const prisma = scriptPrisma();
const BATCH = 5000;

async function main() {
  const write = process.argv.includes("--write");
  console.log(`Database: ${databaseLabel()}${write ? "" : " (dry run: nothing is deleted)"}`);
  let total = 0;
  for (const table of WORKSPACE_ORPHAN_TABLES) {
    const exists = await prisma.$queryRaw<{ ok: boolean }[]>`SELECT to_regclass(format('%I', ${table}::text)) IS NOT NULL AS ok`;
    if (!exists[0]?.ok) {
      console.log(`${table}: not in this database, skipped`);
      continue;
    }
    // The table name comes from the constant list, never from input.
    const orphans = `FROM "${table}" t WHERE t."organizationId" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "Organization" o WHERE o."id" = t."organizationId")`;
    const [{ n }] = await prisma.$queryRawUnsafe<{ n: bigint }[]>(`SELECT count(*)::bigint AS n ${orphans}`);
    const count = Number(n);
    total += count;
    if (!write || count === 0) {
      console.log(`${table}: ${count} rows of companies that no longer exist`);
      continue;
    }
    let deleted = 0;
    for (;;) {
      const gone = await prisma.$executeRawUnsafe(`DELETE FROM "${table}" WHERE "id" IN (SELECT t."id" ${orphans} LIMIT ${BATCH})`);
      deleted += gone;
      if (gone < BATCH) break;
    }
    console.log(`${table}: deleted ${deleted}`);
  }
  console.log(write ? `Done: ${total} rows found at the start.` : `Total: ${total}. Run again with --write to delete them.`);
}

main()
  .catch((err) => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
