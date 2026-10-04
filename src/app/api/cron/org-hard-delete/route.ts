import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { cronRefusal } from "@/lib/cron-auth";
import { CREATED_SOMETHING, SETUP_DONE } from "@/lib/admin/company-milestones";

/**
 * Cron: hard-delete tenants whose 30-day grace window has elapsed.
 *
 * Work queue: organizations with status=CANCELLED whose
 * settings.scheduledHardDeleteAt is in the past, the earliest due first.
 *
 * Each company is deleted in its own transaction so a misbehaving cascade on
 * one tenant doesn't block the rest of the batch. The foreign keys to
 * Organization cascade in the database, so users, departments, tasks, etc.
 * go with it.
 *
 * THE DELETE IS CONDITIONAL. It re-checks, in the same statement, that the
 * company is still CANCELLED with the same schedule this run read, so a
 * restore that lands between the read and the delete keeps the company.
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
 * NOT AN INTERACTIVE TRANSACTION. A large company's cascade can take longer
 * than an interactive transaction's timeout, which would roll the delete back
 * on every run, forever. A batch of plain statements has no such timeout.
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

export async function POST(req: NextRequest) {
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

  for (const org of due) {
    const requestedAt = org.cancelledAt && ISO.test(org.cancelledAt) ? new Date(org.cancelledAt) : now;
    // Timestamps go in as ISO text cast to UTC wall time, the way Prisma
    // stores DateTime, so the result never depends on the session time zone.
    const at = now.toISOString();
    const asked = requestedAt.toISOString();
    const sameFrom = new Date(requestedAt.getTime() - SAME_DELETION_MS).toISOString();
    try {
      // The funnel's two milestones, read by the funnel's own definitions
      // (src/lib/admin/company-milestones.ts) while there is still a company.
      const [setupDone, createdSomething] = await Promise.all([
        prisma.organization.count({ where: { AND: [{ id: org.id }, SETUP_DONE] } }).then((n) => n > 0),
        prisma.organization.count({ where: { AND: [{ id: org.id }, CREATED_SOMETHING] } }).then((n) => n > 0),
      ]);
      const signedUp = new Date(org.createdAt).toISOString();
      const [gone] = await prisma.$transaction([
        prisma.$executeRaw`
          DELETE FROM "Organization"
           WHERE "id" = ${org.id}
             AND "status" = 'CANCELLED'
             AND "settings"->>'scheduledHardDeleteAt' = ${org.scheduled}`,
        // Only once the company is gone: stamp this deletion's row...
        prisma.$executeRaw`
          UPDATE "WorkspaceDeletion"
             SET "hardDeletedAt" = (${at}::timestamptz AT TIME ZONE 'UTC'),
                 "signedUpAt" = COALESCE("signedUpAt", (${signedUp}::timestamptz AT TIME ZONE 'UTC')),
                 "finishedSetup" = ${setupDone},
                 "createdSomething" = ${createdSomething}
           WHERE "organizationId" = ${org.id}
             AND "hardDeletedAt" IS NULL
             AND "requestedAt" >= (${sameFrom}::timestamptz AT TIME ZONE 'UTC')
             AND NOT EXISTS (SELECT 1 FROM "Organization" WHERE "id" = ${org.id})`,
        // ...or write one when it has none.
        prisma.$executeRaw`
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
          ON CONFLICT DO NOTHING`,
      ]);
      if (gone === 1) {
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

  return Response.json({
    ok: true,
    scanned: candidates.length,
    eligible: due.length,
    deleted,
    // Restored between the read and the delete, so left alone.
    kept,
    failures,
  });
}
