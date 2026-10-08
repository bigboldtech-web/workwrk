import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { cronRefusal } from "@/lib/cron-auth";
import { CREATED_SOMETHING, SETUP_DONE } from "@/lib/admin/company-milestones";
import { ACTION_LABEL } from "@/lib/admin/staff-activity";
import { WORKSPACE_ORPHAN_TABLES, isWorkspaceOrphanTable } from "@/lib/admin/workspace-orphans";
import { freeCompanyFiles } from "@/lib/company-files";
import { moveHomesOutOf } from "@/lib/access/workspace-anchor";
import { companyOwnedTables, deleteNotificationsAbout } from "@/lib/admin/company-notifications";
import { HARD_DELETE_FIRST, isHardDeleteFirst } from "@/lib/admin/hard-delete-order";
import { cronJob, cronResult } from "@/lib/cron-result";
import { queueWorkspaceRevocations } from "@/lib/connectors/connections";

/**
 * Cron: hard-delete tenants whose 30-day grace window has elapsed.
 *
 * Work queue: organizations with status=CANCELLED whose
 * settings.scheduledHardDeleteAt is in the past, the earliest due first.
 *
 * Each company is deleted in its own transaction so a misbehaving cascade on
 * one tenant doesn't block the rest of the batch. The foreign keys to
 * Organization cascade in the database, so users, departments, tasks, etc.
 * go with it. WORKSPACE_ORPHAN_TABLES (src/lib/admin/workspace-orphans.ts) hold
 * the company's own rows that NO foreign
 * key ties to it (its activity log, agreements, call records, document
 * snapshots, email log, templates, reminders, assessments, Trash and more):
 * the same transaction deletes them by organizationId once the company is
 * gone, or they would outlive it for good.
 *
 * THE DELETE IS CONDITIONAL. The transaction first locks the company's row,
 * still CANCELLED with the same schedule this run read, so a restore that
 * lands between the read and the delete keeps the company (and its staff
 * audit rows untouched), and one that comes after finds it gone.
 *
 * ACCOUNTS THAT BELONG ELSEWHERE STAY. The delete cascades every account
 * anchored to the company, and the anchor is only where its person last was.
 * So first, in the same transaction, everyone who also belongs to another
 * workspace is moved there at the level held there
 * (src/lib/access/workspace-anchor.ts moveHomesOutOf), and only the rest go.
 *
 * ITS FILES GO TOO, where ownership is provable (src/lib/company-files.ts):
 * in S3 orgs/<id>/files/ and orgs/<id>/scribe/, on disk the names carrying
 * its id or the ids of the accounts that go with it. Older uploads
 * (orgs/<id>/notes/, file-<random>) are left: their key named the uploader's
 * home workspace, so it can hold a live company's files. Freed only after the
 * transaction commits, so a delete that rolls back loses nothing; never by a
 * file reference, which a client chose.
 *
 * AND WHAT NAMES ITS PEOPLE ELSEWHERE. Their password reset rows and the
 * emails to them that name no company, which hold their addresses, are
 * deleted while their accounts still exist to match them by. In the inboxes
 * of the people who outlive it, the notifications whose link names one of its
 * records go too (src/lib/admin/company-notifications.ts); one whose link
 * names no record cannot be told apart from another workspace's and stays.
 *
 * STAFF AUDIT ROWS KEEP NO NAMES. The rows about the company (StaffAction,
 * whose company link goes on delete) are kept, with their action, who did it
 * and when, but their label, sentence, free-text reason and the name, email
 * and company-name values in before and after are replaced, in the same
 * transaction: the privacy policy deletes workspace data 30 days after
 * termination, and those rows named the company and some of its people.
 *
 * THE RECORD THAT OUTLIVES IT is WorkspaceDeletion (no foreign key, no name,
 * no person). In the same transaction as the delete, the row for this
 * deletion is stamped hardDeletedAt, with the signup date and the two funnel
 * milestones as they stood at the end, or written if the company has none (a
 * deletion scheduled before that table existed, say), so the staff console's
 * long-range numbers (cancellations, new companies, the funnel, retention)
 * still count every hard-deleted company. This used to
 * write an ActivityLog row instead, which could never survive: its actor was
 * the Owner, whose User row this delete cascades (and ActivityLog.actor
 * cascades), or, with no Owner recorded, the company's own id, which is no
 * User at all and failed the foreign key. And a row that did survive would
 * have kept the company's name past the 30 days the privacy policy promises.
 *
 * ITS OWN TIMEOUT. In Prisma 7 every transaction, the array form included,
 * runs under the client's transaction timeout, 5 seconds unless the call
 * gives its own. A large company's cascade takes longer than that, and a
 * timed-out transaction rolls the delete back on every run, forever (the
 * company, and its people's data, kept past the promised 30 days). So this
 * is the callback form, which takes a timeout: 30 minutes, at 03:30.
 *
 * Schedule: daily (scripts/CRON-SETUP.md). Lateness tolerance is about a day
 * since the grace window is already 30 days. Guarded by the shared cron door
 * (src/lib/cron-auth.ts): fail-closed.
 */

/** Companies read per run; the earliest due go first, so a backlog drains. */
const BATCH = 200;
/** The shape the delete route writes (Date.toISOString), the only one trusted as a date. */
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?Z$/;
/** A deletion row this close to the schedule's cancelledAt is that deletion's row. */
const SAME_DELETION_MS = 5 * 60 * 1000;

async function handle(req: NextRequest) {
  const refused = cronRefusal(req);
  if (refused) return refused;

  const now = new Date();

  // Due companies only, in SQL, earliest first, so a large CANCELLED set
  // (a staff cancellation schedules no delete) can never push a due company
  // past the batch. ISO strings of one shape sort in time order under the C
  // collation; each is still parsed below before anything is deleted.
  const candidates = await prisma.$queryRaw<{ id: string; plan: string; createdAt: Date; scheduled: string; cancelledAt: string | null }[]>`
    SELECT "id", "plan"::text AS "plan", "createdAt",
           "settings"->>'scheduledHardDeleteAt' AS "scheduled",
           "settings"->>'cancelledAt' AS "cancelledAt"
      FROM "Organization"
     WHERE "status" = 'CANCELLED'
       AND "settings"->>'scheduledHardDeleteAt' IS NOT NULL
       AND ("settings"->>'scheduledHardDeleteAt') COLLATE "C" <= ${now.toISOString()}
     ORDER BY ("settings"->>'scheduledHardDeleteAt') COLLATE "C" ASC
     LIMIT ${BATCH}`;

  const due = candidates.filter((org) => {
    const at = new Date(org.scheduled);
    return !Number.isNaN(at.getTime()) && at.getTime() <= now.getTime();
  });

  let deleted = 0;
  let kept = 0;
  const failures: Array<{ id: string; error: string }> = [];

  // The sentence each kind of staff action reads as, once its company is gone.
  const labels = JSON.stringify(ACTION_LABEL);
  // The orphan tables this database has (a name from the constant above,
  // never from input, so it is safe to place in the statement).
  const present = await prisma.$queryRaw<{ name: string }[]>`
    SELECT t.name FROM unnest(${[...WORKSPACE_ORPHAN_TABLES]}::text[]) AS t(name)
     WHERE to_regclass(format('%I', t.name)) IS NOT NULL`;
  const orphanTables = present.map((r) => r.name).filter(isWorkspaceOrphanTable);
  // Every table whose rows belong to one company, for the notification sweep.
  const ownedTables = await companyOwnedTables();
  // The records deleted before the company row (src/lib/admin/hard-delete-order.ts).
  const firstPresent = await prisma.$queryRaw<{ name: string }[]>`
    SELECT t.name FROM unnest(${[...HARD_DELETE_FIRST]}::text[]) AS t(name)
     WHERE to_regclass(format('%I', t.name)) IS NOT NULL`;
  const firstTables = HARD_DELETE_FIRST.filter((t) => firstPresent.some((r) => r.name === t) && isHardDeleteFirst(t));

  for (const org of due) {
    try {
      // Everything about one company, its parsing included, is inside the
      // try: a bad value lands in failures and the next company still goes.
      // The schedule's own cancelledAt when it is a real instant (a shape
      // that parses to nothing, like month 13, falls back to now).
      const parsed = org.cancelledAt && ISO.test(org.cancelledAt) ? new Date(org.cancelledAt) : null;
      const requestedAt = parsed && !Number.isNaN(parsed.getTime()) ? parsed : now;
      // Timestamps go in as ISO text cast to UTC wall time, the way Prisma
      // stores DateTime, so the result never depends on the session time zone.
      const at = now.toISOString();
      const asked = requestedAt.toISOString();
      const sameFrom = new Date(requestedAt.getTime() - SAME_DELETION_MS).toISOString();
      // The funnel's two milestones, read by the funnel's own definitions
      // (src/lib/admin/company-milestones.ts) while there is still a company.
      const [setupDone, createdSomething] = await Promise.all([
        prisma.organization.count({ where: { AND: [{ id: org.id }, SETUP_DONE] } }).then((n) => n > 0),
        prisma.organization.count({ where: { AND: [{ id: org.id }, CREATED_SOMETHING] } }).then((n) => n > 0),
      ]);
      const signedUp = new Date(org.createdAt).toISOString();
      const result = await prisma.$transaction(
        async (tx) => {
          // 1. The company's row, locked while it is still due. Restored, or
          // deleted by an overlapping run, since the read: nothing is done.
          const locked = await tx.$queryRaw<{ id: string }[]>`
            SELECT "id" FROM "Organization"
             WHERE "id" = ${org.id}
               AND "status" = 'CANCELLED'
               AND "settings"->>'scheduledHardDeleteAt' = ${org.scheduled}
               FOR UPDATE`;
          if (locked.length === 0) return { n: 0, userIds: [] as string[] };
          // 1b. Accounts that also belong to another workspace move there and
          // outlive it. Every step below reads "its people" after this.
          await moveHomesOutOf(org.id, tx);
          // The accounts that go with it (their photos go after the commit).
          const leaving = await tx.user.findMany({ where: { organizationId: org.id }, select: { id: true } });
          // 1c. Google is told about every AI teammate connection still
          // here (docs/plans/ai-teammates-phase3.md Decision 20): a revoke is
          // queued, in this transaction, for each Google account no other
          // workspace's connection holds. The queue has no foreign key, so it
          // outlives the cascade below that takes the connections.
          await queueWorkspaceRevocations(tx, org.id);
          // 2. Its staff audit rows lose every name (an AppSumo refund keeps
          // its label, which is the code, not a name).
          await tx.$executeRaw`
            UPDATE "StaffAction"
               SET "targetLabel" = CASE WHEN "action" = 'admin.code.refunded' THEN "targetLabel" ELSE 'A deleted company' END,
                   "summary" = COALESCE(${labels}::jsonb ->> "action", 'Changed') || ' (the company was later deleted for good)',
                   "reason" = NULL,
                   "before" = CASE WHEN jsonb_typeof("before") = 'object' THEN "before" - 'name' - 'email' - 'keptOwnerAccess' - 'companyName' ELSE "before" END,
                   "after" = CASE WHEN jsonb_typeof("after") = 'object' THEN "after" - 'name' - 'email' - 'keptOwnerAccess' - 'companyName' ELSE "after" END,
                   "updatedAt" = (${at}::timestamptz AT TIME ZONE 'UTC')
             WHERE "targetCompanyId" = ${org.id}
               AND EXISTS (
                     SELECT 1 FROM "Organization"
                      WHERE "id" = ${org.id} AND "status" = 'CANCELLED' AND "settings"->>'scheduledHardDeleteAt' = ${org.scheduled}
                   )`;
          // 2b. A denied Staff console visit by one of its people keeps no
          // email address, no account id and no address.
          await tx.$executeRaw`
            UPDATE "StaffAction"
               SET "actorEmail" = 'a deleted account',
                   "summary" = 'An account of a workspace later deleted for good tried to open the Staff console',
                   "actorUserId" = NULL,
                   "ip" = NULL,
                   "updatedAt" = (${at}::timestamptz AT TIME ZONE 'UTC')
             WHERE "action" = 'admin.access.denied'
               AND "actorUserId" IN (SELECT "id" FROM "User" WHERE "organizationId" = ${org.id})
               AND EXISTS (
                     SELECT 1 FROM "Organization"
                      WHERE "id" = ${org.id} AND "status" = 'CANCELLED' AND "settings"->>'scheduledHardDeleteAt' = ${org.scheduled}
                   )`;
          // 2c. Its people's password reset rows (matched by email while the
          // accounts exist; one also used by an account elsewhere is kept).
          await tx.$executeRaw`
            DELETE FROM "PasswordResetToken" t
             WHERE EXISTS (SELECT 1 FROM "User" u WHERE u."organizationId" = ${org.id} AND lower(u."email") = lower(t."email"))
               AND NOT EXISTS (SELECT 1 FROM "User" v WHERE v."organizationId" <> ${org.id} AND lower(v."email") = lower(t."email"))
               AND EXISTS (
                     SELECT 1 FROM "Organization"
                      WHERE "id" = ${org.id} AND "status" = 'CANCELLED' AND "settings"->>'scheduledHardDeleteAt' = ${org.scheduled}
                   )`;
          // 2d. Emails to its people that name no company (step 3b deletes
          // the ones that do), by the same match. A row the queue is sending
          // goes too: the queue's writes after its claim update nothing then.
          await tx.$executeRaw`
            DELETE FROM "EmailLog" e
             WHERE e."organizationId" IS NULL
               AND EXISTS (SELECT 1 FROM "User" u WHERE u."organizationId" = ${org.id} AND lower(u."email") = lower(e."to"))
               AND NOT EXISTS (SELECT 1 FROM "User" v WHERE v."organizationId" <> ${org.id} AND lower(v."email") = lower(e."to"))`;
          // 2e. Notifications about it in the inboxes of the people who
          // outlive it (members anchored elsewhere, and everyone moved out in
          // 1b), while its rows still exist to match the links against.
          await deleteNotificationsAbout(tx, org.id, ownedTables);
          // 2f. Personal reminders follow their person: the ones made while
          // working here by someone who outlives it (moved out in 1b, or
          // anchored elsewhere) move to where that person is now, unless
          // they are tied to one of its records; the rest go in 3b, and so do
          // every reminder of an account that goes, wherever it was made.
          await tx.$executeRaw`
            UPDATE "Reminder" r
               SET "organizationId" = u."organizationId"
              FROM "User" u
             WHERE r."organizationId" = ${org.id}
               AND r."entityType" IS NULL
               AND u."id" = r."userId"
               AND u."organizationId" <> ${org.id}`;
          await tx.$executeRaw`
            DELETE FROM "Reminder" r
             WHERE r."userId" IN (SELECT u."id" FROM "User" u WHERE u."organizationId" = ${org.id})`;
          // 2g. The records that sit two or three cascades below it and have a
          // restricting link to an account, each in its own statement: in the
          // one DELETE below, the accounts' links would be checked before the
          // deeper cascades reached them (src/lib/admin/hard-delete-order.ts).
          for (const table of firstTables) {
            await tx.$executeRawUnsafe(`DELETE FROM "${table}" WHERE "organizationId" = $1`, org.id);
          }
          // 3. The company.
          const n = await tx.$executeRaw`
            DELETE FROM "Organization"
             WHERE "id" = ${org.id}
               AND "status" = 'CANCELLED'
               AND "settings"->>'scheduledHardDeleteAt' = ${org.scheduled}`;
          // 3b. Once it is gone, its rows that no foreign key cascades to.
          if (n === 1) {
            for (const table of orphanTables) {
              await tx.$executeRawUnsafe(`DELETE FROM "${table}" WHERE "organizationId" = $1`, org.id);
            }
          }
          // 4. Only once the company is gone: stamp this deletion's row...
          await tx.$executeRaw`
            UPDATE "WorkspaceDeletion"
               SET "hardDeletedAt" = (${at}::timestamptz AT TIME ZONE 'UTC'),
                   "signedUpAt" = COALESCE("signedUpAt", (${signedUp}::timestamptz AT TIME ZONE 'UTC')),
                   "finishedSetup" = ${setupDone},
                   "createdSomething" = ${createdSomething}
             WHERE "organizationId" = ${org.id}
               AND "hardDeletedAt" IS NULL
               AND "requestedAt" >= (${sameFrom}::timestamptz AT TIME ZONE 'UTC')
               AND NOT EXISTS (SELECT 1 FROM "Organization" WHERE "id" = ${org.id})`;
          // 5. ...or write one when it has none.
          await tx.$executeRaw`
            INSERT INTO "WorkspaceDeletion"
                   ("id", "organizationId", "plan", "signedUpAt", "requestedAt", "hardDeletedAt", "finishedSetup", "createdSomething")
            SELECT ${`wd_hd_${org.id}_${now.getTime()}`}, ${org.id}, ${org.plan},
                   (${signedUp}::timestamptz AT TIME ZONE 'UTC'),
                   (${asked}::timestamptz AT TIME ZONE 'UTC'), (${at}::timestamptz AT TIME ZONE 'UTC'),
                   ${setupDone}, ${createdSomething}
             WHERE NOT EXISTS (SELECT 1 FROM "Organization" WHERE "id" = ${org.id})
               AND NOT EXISTS (
                     SELECT 1 FROM "WorkspaceDeletion"
                      WHERE "organizationId" = ${org.id} AND "hardDeletedAt" = (${at}::timestamptz AT TIME ZONE 'UTC')
                   )
            ON CONFLICT DO NOTHING`;
          return { n, userIds: leaving.map((u) => u.id) };
        },
        { maxWait: 10_000, timeout: 30 * 60_000 },
      );
      if (result.n === 1) {
        // Committed: now its files can go (best effort, never throws).
        await freeCompanyFiles(org.id, { userIds: result.userIds });
        deleted += 1;
        // The id only: the name is part of what was just deleted.
        console.info(`[org-hard-delete] deleted ${org.id}`);
      } else {
        kept += 1;
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[org-hard-delete] failed for ${org.id}:`, err);
      failures.push({ id: org.id, error: message });
    }
  }

  return cronResult("org-hard-delete", {
    ok: failures.length === 0,
    scanned: candidates.length,
    eligible: due.length,
    deleted,
    // Restored between the read and the delete, so left alone.
    kept,
    failures,
  }, failures.length);
}

// Any throw answers 500 and alerts like a failed run (src/lib/cron-result.ts).
export const POST = cronJob("org-hard-delete", handle);
