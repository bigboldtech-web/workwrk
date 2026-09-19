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
import { freeTrashStorage } from "@/lib/trash";
import { retentionDays } from "@/lib/trash-view";

export const dynamic = "force-dynamic";

const ORG_PAGE = 200;

export async function POST(req: NextRequest) {
  const cronSecret = (process.env.CRON_SECRET ?? "").trim();
  if (!cronSecret) {
    return Response.json(
      { error: "CRON_SECRET is not set; this route deletes rows and will not run without it." },
      { status: 503 },
    );
  }
  const header = req.headers.get("x-cron-secret") ?? req.headers.get("authorization");
  if (header?.replace(/^Bearer\s+/i, "") !== cronSecret) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const dryRun = req.nextUrl.searchParams.get("dry") === "1";
  const now = Date.now();
  const purged: Array<{ organizationId: string; days: number; deleted: number }> = [];
  let orgs = 0;
  let cursor: string | undefined;

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
      const where = { organizationId: org.id, deletedAt: { lt: cutoff } };

      if (dryRun) {
        const count = await prisma.trashItem.count({ where });
        if (count > 0) purged.push({ organizationId: org.id, days, deleted: count });
        continue;
      }

      const expiringFiles = await prisma.trashItem.findMany({
        where: { ...where, entityType: "file" },
        select: { entityType: true, snapshot: true },
      });
      for (const f of expiringFiles) await freeTrashStorage(f.entityType, f.snapshot);

      const res = await prisma.trashItem.deleteMany({ where });
      if (res.count > 0) purged.push({ organizationId: org.id, days, deleted: res.count });
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
