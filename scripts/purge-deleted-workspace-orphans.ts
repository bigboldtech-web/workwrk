// Delete what companies deleted for good BEFORE 2026-10-05 left behind, and
// the email log rows written before emails carried the right company.
//
// Until Batch 9, the hard-delete cron deleted only the Organization row and
// relied on cascades, but the tables in src/lib/admin/workspace-orphans.ts
// have no foreign key to Organization, so a deleted company's activity log,
// agreements, call records, document snapshots, email log, templates,
// reminders, assessments and Trash stayed for good, and so did its uploaded
// files, its people's password reset rows, the digests and reminders about it
// (which carried no company) and the names in staff audit rows, against the
// privacy policy's promise to delete workspace data 30 days after termination. The cron now deletes all of it with the company; this removes
// what is already stranded.
//
// RUN IT ON THE SERVER, by the founder, AFTER the Batch 9 deploy (whose SQL
// first records the old deletions in WorkspaceDeletion from these very rows),
// from the app's directory with the app's own environment loaded, so it sees
// the app's database AND its file storage (S3_ACCESS_KEY_ID,
// S3_SECRET_ACCESS_KEY, S3_BUCKET, S3_REGION, and S3_ENDPOINT where set):
//
//   cd /www/wwwroot/workwrk.com && set -a && . ./.env && set +a
//   DIRECT_URL= npx tsx scripts/purge-deleted-workspace-orphans.ts           # counts only
//   DIRECT_URL= npx tsx scripts/purge-deleted-workspace-orphans.ts --write   # deletes
//
// It prints the database and whether it can see S3 first. --write refuses
// while S3 is not configured in the shell, because the rows that name a gone
// company's files would go and its files in S3 could never be found again;
// pass --no-s3 only on a server that keeps no files in S3.
//
// The table loop touches ONLY rows whose organizationId names no Organization
// row (a row with no organizationId, such as a global template, is never
// touched there), in batches of 5000, and prints counts only. The steps after
// it also act on rows with no company: StaffAction rows still naming a deleted
// company or account (scrubbed), password reset rows whose address no account
// has, and FINISHED email log rows written before emails carried the right
// company (manager digests and reminder emails with none; monthly evaluation
// reminders without the per-company marker), whatever company received them.
// WorkspaceDeletion is never touched. Trashed files of companies that no
// longer exist are freed by Trash's own rule (src/lib/trash.ts: only a file
// stamped for its uploader that nothing else names). Files go only where ownership is provable (src/lib/company-files.ts):
// with S3 configured, orgs/<id>/scribe/ and orgs/<id>/files/ of a company
// that no longer exists; on disk, file-<id>-* and logo-<id>-* of a company
// that no longer exists and avatar-<id>-* of an account that no longer
// exists. Older uploads are left: orgs/<id>/notes/ in S3 (its key named the
// uploader's home workspace, so it can hold a live company's files) and
// file-<random> on disk. There is no undo: read the dry run first.

import { databaseLabel, scriptPrisma } from "./lib/script-prisma";
import { WORKSPACE_ORPHAN_TABLES } from "../src/lib/admin/workspace-orphans";
import { ACTION_LABEL } from "../src/lib/admin/staff-activity";
import { BLOB_TRASH_TYPES, freeTrashStorageMany } from "../src/lib/trash";
import { deleteObjectsWithPrefix, isS3Configured } from "../src/lib/s3";
import { ownedS3Prefixes } from "../src/lib/company-files";
import { deleteUpload, listUploads } from "../src/lib/local-uploads";

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
  const noS3 = process.argv.includes("--no-s3");
  console.log(`Database: ${databaseLabel()}${write ? "" : " (dry run: nothing is deleted)"}`);
  console.log(
    isS3Configured()
      ? "S3: configured, files of companies that no longer exist are included"
      : "S3: NOT configured in this shell (S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY, S3_BUCKET, S3_REGION), so nothing in S3 is touched",
  );
  if (write && !isS3Configured() && !noS3) {
    console.error(
      "Nothing written: load the app's environment first (set -a && . ./.env && set +a), or pass --no-s3 if this server keeps no files in S3. Deleting the rows without S3 would leave those companies' files in S3 with nothing left to find them by.",
    );
    process.exit(2);
  }
  // The companies that no longer exist, read BEFORE anything is deleted: the
  // rows deleted below are, for a company deleted before its deletion was
  // recorded, the only thing left that names it.
  const goneCompanies = new Set<string>();
  const present: string[] = [];
  for (const table of WORKSPACE_ORPHAN_TABLES) {
    if (!(await tableExists(table))) {
      console.log(`${table}: not in this database, skipped`);
      continue;
    }
    present.push(table);
    for (const r of await prisma.$queryRawUnsafe<{ id: string }[]>(`SELECT DISTINCT t."organizationId" AS id ${orphansOf(table)}`)) goneCompanies.add(r.id);
  }
  for (const r of await prisma.$queryRaw<{ id: string }[]>`
    SELECT DISTINCT d."organizationId" AS id FROM "WorkspaceDeletion" d
     WHERE NOT EXISTS (SELECT 1 FROM "Organization" o WHERE o."id" = d."organizationId")`) goneCompanies.add(r.id);

  // Their files in S3 first, under the prefixes only they could have written.
  // If S3 does not answer, nothing else is written, so a second run still
  // finds every company.
  if (isS3Configured()) {
    let objects = 0;
    let failed = 0;
    for (const id of goneCompanies) {
      for (const prefix of ownedS3Prefixes(id)) {
        if (!write) continue;
        objects += await deleteObjectsWithPrefix(prefix).catch((err) => {
          failed += 1;
          console.error(`S3: could not empty ${prefix}: ${err instanceof Error ? err.message : String(err)}`);
          return 0;
        });
      }
    }
    if (failed > 0) {
      console.error(`Nothing else written: S3 did not answer for ${failed} prefixes. Run again once it does.`);
      process.exit(1);
    }
    console.log(
      write
        ? `S3: deleted ${objects} objects of ${goneCompanies.size} companies that no longer exist (orgs/<id>/scribe/ and files/; notes/ left)`
        : `S3: ${goneCompanies.size} companies that no longer exist would have orgs/<id>/scribe/ and files/ emptied (notes/ is left)`,
    );
  }

  let total = 0;
  for (const table of present) {
    let moving = 0; // reminders a dry run counts as moving, not as deleted
    if (table === "Reminder") {
      // A personal reminder follows its person (they are listed and fired in
      // every workspace): one not tied to a record, of someone whose account
      // still exists, moves to where that person is now instead of going.
      const [{ n: kept }] = await prisma.$queryRawUnsafe<{ n: bigint }[]>(
        `SELECT count(*)::bigint AS n ${orphansOf("Reminder")} AND t."entityType" IS NULL AND EXISTS (SELECT 1 FROM "User" u WHERE u."id" = t."userId")`,
      );
      if (write && Number(kept) > 0) {
        await prisma.$executeRawUnsafe(
          `UPDATE "Reminder" t SET "organizationId" = u."organizationId" FROM "User" u
            WHERE u."id" = t."userId" AND t."entityType" IS NULL AND t."organizationId" IS NOT NULL
              AND NOT EXISTS (SELECT 1 FROM "Organization" o WHERE o."id" = t."organizationId")`,
        );
      }
      console.log(`Reminder: ${Number(kept)} personal reminders of people who still have an account${write ? " moved to their current workspace" : " would move to their current workspace"}`);
      if (!write) moving = Number(kept);
    }
    const [{ n }] = await prisma.$queryRawUnsafe<{ n: bigint }[]>(`SELECT count(*)::bigint AS n ${orphansOf(table)}`);
    const count = Number(n) - moving;
    total += count;
    if (!write || count === 0) {
      console.log(`${table}: ${count} rows of companies that no longer exist`);
      continue;
    }
    if (table === "TrashItem") {
      // Free a trashed file before the row that names it goes, or nothing
      // will ever point at it again.
      for (;;) {
        const rows = await prisma.$queryRawUnsafe<{ id: string; entityType: string; snapshot: unknown; organizationId: string }[]>(
          `SELECT t."id", t."entityType", t."snapshot", t."organizationId" ${orphansOf("TrashItem")} AND t."entityType" = ANY($1::text[]) LIMIT ${BATCH}`,
          [...BLOB_TRASH_TYPES],
        );
        if (rows.length === 0) break;
        // Freed company by company: each check reads that company's rows once.
        const byCompany = new Map<string, typeof rows>();
        for (const r of rows) byCompany.set(r.organizationId, [...(byCompany.get(r.organizationId) ?? []), r]);
        for (const [org, list] of byCompany) await freeTrashStorageMany(list, org);
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


  // Disk files whose names say they belong to a company or an account that
  // no longer exists (an id a row still has is never touched), in both
  // places a local file can be (storage/uploads, and public/uploads for one
  // not moved yet: src/lib/local-uploads.ts).
  {
    const names = await listUploads();
    const orgOf = (n: string) => /^(?:file|logo)-([a-z0-9]{20,})-/.exec(n)?.[1] ?? null;
    const userOf = (n: string) => /^avatar-([a-z0-9]{20,})-/.exec(n)?.[1] ?? null;
    const orgIds = [...new Set(names.map(orgOf).filter((x): x is string => !!x))];
    const userIds = [...new Set(names.map(userOf).filter((x): x is string => !!x))];
    const liveOrgs = new Set((await prisma.organization.findMany({ where: { id: { in: orgIds } }, select: { id: true } })).map((o) => o.id));
    const liveUsers = new Set((await prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true } })).map((u) => u.id));
    const stranded = names.filter((n) => /^[A-Za-z0-9._-]+$/.test(n) && ((orgOf(n) && !liveOrgs.has(orgOf(n)!)) || (userOf(n) && !liveUsers.has(userOf(n)!))));
    let removed = 0;
    if (write) for (const n of stranded) removed += (await deleteUpload(n)) ? 1 : 0;
    console.log(`Disk: ${stranded.length} files of companies or accounts that no longer exist${write ? `, ${removed} deleted` : ""}`);
  }

  // Staff audit rows that still name a deleted company or a deleted account.
  const labels = JSON.stringify(ACTION_LABEL);
  const [{ n: staffRows }] = await prisma.$queryRaw<{ n: bigint }[]>`
    SELECT count(*)::bigint AS n FROM "StaffAction"
     WHERE ("targetCompanyId" IS NULL AND "action" LIKE 'admin.org.%' AND "targetLabel" IS DISTINCT FROM 'A deleted company')
        OR ("action" = 'admin.access.denied' AND "actorUserId" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "User" u WHERE u."id" = "StaffAction"."actorUserId"))
        OR ("action" = 'admin.code.refunded' AND "targetCompanyId" IS NULL
            AND ((jsonb_typeof("before") = 'object' AND "before"->>'companyName' IS NOT NULL)
              OR (jsonb_typeof("after") = 'object' AND "after"->>'companyName' IS NOT NULL)))`;
  if (write) {
    await prisma.$executeRaw`
      UPDATE "StaffAction"
         SET "targetLabel" = 'A deleted company',
             "summary" = COALESCE(${labels}::jsonb ->> "action", 'Changed') || ' (the company was later deleted for good)',
             "reason" = NULL,
             "before" = CASE WHEN jsonb_typeof("before") = 'object' THEN "before" - 'name' - 'email' - 'keptOwnerAccess' - 'companyName' ELSE "before" END,
             "after" = CASE WHEN jsonb_typeof("after") = 'object' THEN "after" - 'name' - 'email' - 'keptOwnerAccess' - 'companyName' ELSE "after" END
       WHERE "targetCompanyId" IS NULL AND "action" LIKE 'admin.org.%' AND "targetLabel" IS DISTINCT FROM 'A deleted company'`;
    // A refund keeps its label (the code); its company's name goes.
    await prisma.$executeRaw`
      UPDATE "StaffAction"
         SET "summary" = COALESCE(${labels}::jsonb ->> "action", 'Changed') || ' (the company was later deleted for good)',
             "reason" = NULL,
             "before" = CASE WHEN jsonb_typeof("before") = 'object' THEN "before" - 'companyName' ELSE "before" END,
             "after" = CASE WHEN jsonb_typeof("after") = 'object' THEN "after" - 'companyName' ELSE "after" END
       WHERE "action" = 'admin.code.refunded' AND "targetCompanyId" IS NULL
         AND ((jsonb_typeof("before") = 'object' AND "before"->>'companyName' IS NOT NULL)
           OR (jsonb_typeof("after") = 'object' AND "after"->>'companyName' IS NOT NULL))`;
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

  // Emails written before they carried the company whose people and work they
  // name (src/app/api/email/send-reminders, src/lib/reminders.ts): manager
  // digests and reminder emails with no company, and monthly evaluation
  // reminders, which were tagged with the manager's own workspace rather than
  // their reports'. Which company a given row named cannot be read back, so
  // every FINISHED one goes, whoever received it: each is the log of an email
  // delivered long ago. Queued mail and every other kind of row are never
  // touched, and neither is an evaluation reminder sent since the release
  // (it carries the per-company marker byReportCompany), so a second run
  // deletes nothing new.
  const [{ n: oldMail }] = await prisma.$queryRaw<{ n: bigint }[]>`
    SELECT count(*)::bigint AS n FROM "EmailLog" e
     WHERE e."status" IN ('SENT', 'FAILED')
       AND ((e."organizationId" IS NULL AND e."template" IN ('overdue-manager', 'overdue-tasks-manager', 'reminder'))
         OR (e."template" = 'evaluation-reminder' AND e."variables"->>'byReportCompany' IS NULL))`;
  if (write) {
    await prisma.$executeRaw`
      DELETE FROM "EmailLog" e
       WHERE e."status" IN ('SENT', 'FAILED')
         AND ((e."organizationId" IS NULL AND e."template" IN ('overdue-manager', 'overdue-tasks-manager', 'reminder'))
           OR (e."template" = 'evaluation-reminder' AND e."variables"->>'byReportCompany' IS NULL))`;
  }
  console.log(`EmailLog: ${Number(oldMail)} finished digests and reminders that carried no company or the wrong one${write ? ", deleted" : ""}`);

  console.log(write ? `Done: ${total} table rows found at the start.` : `Total: ${total} table rows. Run again with --write to delete them.`);
}

main()
  .catch((err) => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
