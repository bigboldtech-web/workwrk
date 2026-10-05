// Cron: purge expired Trash, per org, on the org's own retention window.
//
// Spec: docs/plans/ui-refresh/spec-spaces-lists.md section 2 (/trash),
// "Realtime": "the purge runs in the retention cron (settings 5.10), not on
// GET as today (a read must not delete)".
//
// WHAT THIS REPLACES. `GET /api/trash` ran `purgeExpiredTrash` plus three
// `deleteMany` calls before it answered, so:
//   - opening the page destroyed rows, and two people opening it at once
//     destroyed them twice;
//   - the retention window was only honoured while somebody happened to look,
//     so a workspace nobody visited kept deleted rows forever;
//   - the archived Docs, Canvases and Contracts were hard-deleted after 60
//     days even though an archive is not a deletion and never expires.
//
// THIS ROUTE DELETES USER DATA, so it is fail-closed and narrow:
//   0. No `CRON_SECRET` in the environment is a 503. It never runs open.
//   1. It purges the DELETED side only: `TrashItem` snapshots past the org's
//      window. Archived Spaces, Folders, Lists, tasks, Docs, Canvases and
//      Contracts are never touched, because the Archived tab has no clock.
//   2. Each org is read for its own `settings.retention.trashDays`; a missing
//      or nonsense value falls back to 60 (trash-view.retentionDays), and a
//      stored zero is floored at one day rather than purging same-day.
//   3. File blobs are freed before the rows that name them go, or the storage
//      is orphaned with no way left to find it.
//   4. `?dry=1` reports exactly what it would delete and deletes nothing.
//
// NOT INSTALLED. scripts/CRON-SETUP.md carries the row; putting it in the
// crontab is the founder's step, like every other cron here.

import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { BLOB_TRASH_TYPES, freeTrashStorageMany } from "@/lib/trash";
import { retentionDays } from "@/lib/trash-view";
import { cronRefusal } from "@/lib/cron-auth";
import { trashPurgeOn, trashPurgeSince } from "@/lib/purge-jobs";
import { cronJob } from "@/lib/cron-result";

export const dynamic = "force-dynamic";

const ORG_PAGE = 200;

async function handle(req: NextRequest) {
  const refused = cronRefusal(req);
  if (refused) return refused;

  const dryRun = req.nextUrl.searchParams.get("dry") === "1";
  // Deletes for real only once it is turned on (src/lib/purge-jobs.ts),
  // when Trash also starts showing its countdown; a dry run always reports.
  if (!dryRun && !trashPurgeOn()) {
    return Response.json({ ran: false, skipped: "TRASH_PURGE_CRON is not on. A dry run (?dry=1) still reports what would be deleted." });
  }
  const now = Date.now();
  const purged: Array<{ organizationId: string; days: number; deleted: number }> = [];
  let orgs = 0;
  let cursor: string | undefined;
  // A row's window starts no earlier than the day the purge was turned on
  // (src/lib/purge-jobs.ts): until that day plus the window has passed,
  // nothing in a workspace is old enough.
  const since = trashPurgeSince();

  for (;;) {
    const page = await prisma.organization.findMany({
      select: { id: true, settings: true },
      orderBy: { id: "asc" },
      take: ORG_PAGE,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });
    if (page.length === 0) break;
    orgs += page.length;
    cursor = page[page.length - 1].id;

    for (const org of page) {
      const settings = (org.settings ?? {}) as { retention?: { trashDays?: unknown } };
      const days = retentionDays(settings.retention?.trashDays);
      const cutoff = new Date(now - days * 86_400_000);
      if (since && since.getTime() >= cutoff.getTime()) continue;
      const where = { organizationId: org.id, deletedAt: { lt: cutoff } };

      if (dryRun) {
        const count = await prisma.trashItem.count({ where });
        if (count > 0) purged.push({ organizationId: org.id, days, deleted: count });
        continue;
      }

      // The rows go FIRST, in one statement that returns them, and only the
      // files of what it returned are freed: a restore that commits first
      // leaves nothing for this to return (its files stay), and one that
      // comes later finds the row gone. Freeing first let a restore during a
      // long freeing loop bring a Space back with its files deleted. (A crash
      // between the two leaves a file in storage, never a file lost.)
      const gone = await prisma.$queryRaw<Array<{ id: string; entityType: string; snapshot: unknown }>>`
        DELETE FROM "TrashItem"
        WHERE "organizationId" = ${org.id}
          AND "deletedAt" < (now() AT TIME ZONE 'UTC') - make_interval(days => ${days})
        RETURNING "id", "entityType",
          CASE WHEN "entityType" = ANY(${[...BLOB_TRASH_TYPES]}::text[]) THEN "snapshot" ELSE NULL END AS "snapshot"`;
      await freeTrashStorageMany(gone.filter((r) => r.snapshot !== null), org.id);
      if (gone.length > 0) purged.push({ organizationId: org.id, days, deleted: gone.length });
    }

    if (page.length < ORG_PAGE) break;
  }

  return Response.json({
    ok: true,
    dryRun,
    orgs,
    orgsPurged: purged.length,
    totalDeleted: purged.reduce((n, p) => n + p.deleted, 0),
    purged,
  });
}

// Any throw answers 500 and alerts like a failed run (src/lib/cron-result.ts).
export const POST = cronJob("trash-purge", handle);
