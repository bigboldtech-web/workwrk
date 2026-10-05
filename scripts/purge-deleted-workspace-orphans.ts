// Delete what companies deleted for good BEFORE 2026-10-05 left behind.
//
// Until Batch 9, the hard-delete cron deleted only the Organization row and
// relied on cascades, but the tables in src/lib/admin/workspace-orphans.ts
// have no foreign key to Organization, so a deleted company's activity log,
// agreements, call records, document snapshots, email log, templates,
// reminders, assessments and Trash stayed for good, and so did its uploaded
// files, its people's password reset rows and the names in staff audit rows,
// against the privacy policy's promise to delete workspace data 30 days after
// termination. The cron now deletes all of it with the company; this removes
// what is already stranded.
//
// RUN IT ON THE SERVER, by the founder, AFTER the Batch 9 deploy (whose SQL
// first records the old deletions in WorkspaceDeletion from these very rows):
//
//   DIRECT_URL= DATABASE_URL=<the app's database> npx tsx scripts/purge-deleted-workspace-orphans.ts           # counts only
//   DIRECT_URL= DATABASE_URL=<the app's database> npx tsx scripts/purge-deleted-workspace-orphans.ts --write   # deletes
//
// It touches ONLY rows whose organizationId names no Organization row (a row
// with no organizationId, such as a global template, is never touched), in
// batches of 5000, and prints counts only. WorkspaceDeletion is never
// touched. Trashed files are freed (disk or S3) before their Trash rows go,
// and with S3 configured everything under orgs/<id>/ of a company that no
// longer exists is deleted. There is no undo: read the dry run first.

import { databaseLabel, scriptPrisma } from "./lib/script-prisma";
import { WORKSPACE_ORPHAN_TABLES } from "../src/lib/admin/workspace-orphans";
import { ACTION_LABEL } from "../src/lib/admin/staff-activity";
import { BLOB_TRASH_TYPES, freeTrashStorage } from "../src/lib/trash";
import { deleteObjectsWithPrefix, isS3Configured } from "../src/lib/s3";

const prisma = scriptPrisma();
const BATCH = 5000;

/** Rows of a table whose company no longer exists (the table name comes from the constant list). */
const orphansOf = (table: string) =>
  `FROM "${table}" t WHERE t."organizationId" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "Organization" o WHERE o."id" = t."organizationId")`;

async function tableExists(table: string): Promise<boolean> {
  const r = await prisma.$queryRaw<{ ok: boolean }[]>`SELECT to_regclass(format('%I', ${table}::text)) IS NOT NULL AS ok`;
  return r[0]?.ok === true;
}

async function main() {
  const write = process.argv.includes("--write");
  console.log(`Database: ${databaseLabel()}${write ? "" : " (dry run: nothing is deleted)"}`);
  const goneCompanies = new Set<string>();
  let total = 0;

  for (const table of WORKSPACE_ORPHAN_TABLES) {
    if (!(await tableExists(table))) {
      console.log(`${table}: not in this database, skipped`);
      continue;
    }
    for (const r of await prisma.$queryRawUnsafe<{ id: string }[]>(`SELECT DISTINCT t."organizationId" AS id ${orphansOf(table)}`)) goneCompanies.add(r.id);
    const [{ n }] = await prisma.$queryRawUnsafe<{ n: bigint }[]>(`SELECT count(*)::bigint AS n ${orphansOf(table)}`);
    const count = Number(n);
    total += count;
    if (!write || count === 0) {
      console.log(`${table}: ${count} rows of companies that no longer exist`);
      continue;
    }
    if (table === "TrashItem") {
      // Free a trashed file before the row that names it goes, or nothing
      // will ever point at it again.
      for (;;) {
        const rows = await prisma.$queryRawUnsafe<{ id: string; entityType: string; snapshot: unknown }[]>(
          `SELECT t."id", t."entityType", t."snapshot" ${orphansOf("TrashItem")} AND t."entityType" = ANY($1::text[]) LIMIT ${BATCH}`,
          [...BLOB_TRASH_TYPES],
        );
        if (rows.length === 0) break;
        for (const r of rows) await freeTrashStorage(r.entityType, r.snapshot);
        await prisma.trashItem.deleteMany({ where: { id: { in: rows.map((r) => r.id) } } });
      }
    }
    let deleted = 0;
    for (;;) {
      const gone = await prisma.$executeRawUnsafe(`DELETE FROM "${table}" WHERE "id" IN (SELECT t."id" ${orphansOf(table)} LIMIT ${BATCH})`);
      deleted += gone;
      if (gone < BATCH) break;
    }
    console.log(`${table}: deleted ${count} (${deleted} in the last pass)`);
  }

  // Companies already gone, also known from their deletion records.
  for (const r of await prisma.$queryRaw<{ id: string }[]>`
    SELECT DISTINCT d."organizationId" AS id FROM "WorkspaceDeletion" d
     WHERE NOT EXISTS (SELECT 1 FROM "Organization" o WHERE o."id" = d."organizationId")`) goneCompanies.add(r.id);

  // Their files in S3, all under their own prefix.
  if (isS3Configured()) {
    let objects = 0;
    for (const id of goneCompanies) objects += write ? await deleteObjectsWithPrefix(`orgs/${id}/`).catch(() => 0) : 0;
    console.log(write ? `S3: deleted ${objects} objects of ${goneCompanies.size} companies that no longer exist` : `S3: ${goneCompanies.size} companies that no longer exist would have orgs/<id>/ emptied`);
  }

  // Staff audit rows that still name a deleted company or a deleted account.
  const labels = JSON.stringify(ACTION_LABEL);
  const [{ n: staffRows }] = await prisma.$queryRaw<{ n: bigint }[]>`
    SELECT count(*)::bigint AS n FROM "StaffAction"
     WHERE ("targetCompanyId" IS NULL AND "action" LIKE 'admin.org.%' AND "targetLabel" IS DISTINCT FROM 'A deleted company')
        OR ("action" = 'admin.access.denied' AND "actorUserId" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "User" u WHERE u."id" = "StaffAction"."actorUserId"))`;
  if (write) {
    await prisma.$executeRaw`
      UPDATE "StaffAction"
         SET "targetLabel" = 'A deleted company',
             "summary" = COALESCE(${labels}::jsonb ->> "action", 'Changed') || ' (the company was later deleted for good)',
             "reason" = NULL,
             "before" = CASE WHEN jsonb_typeof("before") = 'object' THEN "before" - 'name' - 'email' - 'keptOwnerAccess' - 'companyName' ELSE "before" END,
             "after" = CASE WHEN jsonb_typeof("after") = 'object' THEN "after" - 'name' - 'email' - 'keptOwnerAccess' - 'companyName' ELSE "after" END
       WHERE "targetCompanyId" IS NULL AND "action" LIKE 'admin.org.%' AND "targetLabel" IS DISTINCT FROM 'A deleted company'`;
    await prisma.$executeRaw`
      UPDATE "StaffAction"
         SET "actorEmail" = 'a deleted account',
             "summary" = 'An account of a workspace later deleted for good tried to open the Staff console',
             "actorUserId" = NULL,
             "ip" = NULL
       WHERE "action" = 'admin.access.denied' AND "actorUserId" IS NOT NULL
         AND NOT EXISTS (SELECT 1 FROM "User" u WHERE u."id" = "StaffAction"."actorUserId")`;
  }
  console.log(`StaffAction: ${Number(staffRows)} rows naming a deleted company or account${write ? ", scrubbed" : ""}`);

  // Password reset rows whose address no account has any more.
  const [{ n: tokens }] = await prisma.$queryRaw<{ n: bigint }[]>`
    SELECT count(*)::bigint AS n FROM "PasswordResetToken" t
     WHERE NOT EXISTS (SELECT 1 FROM "User" u WHERE lower(u."email") = lower(t."email"))`;
  if (write) {
    await prisma.$executeRaw`
      DELETE FROM "PasswordResetToken" t
       WHERE NOT EXISTS (SELECT 1 FROM "User" u WHERE lower(u."email") = lower(t."email"))`;
  }
  console.log(`PasswordResetToken: ${Number(tokens)} rows of addresses no account has${write ? ", deleted" : ""}`);

  console.log(write ? `Done: ${total} table rows found at the start.` : `Total: ${total} table rows. Run again with --write to delete them.`);
}

main()
  .catch((err) => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
