// Cron: purge Audit log rows past each org's CHOSEN retention window
// (Settings > Data > Retention & privacy, "Keep the audit log for").
//
// THIS ROUTE DELETES RECORDS, so it is fail-closed and narrow, like
// /api/cron/trash-purge:
//   0. No CRON_SECRET in the environment is a 503. It never runs open.
//   1. It acts ONLY on orgs that set settings.retention.auditDays. An org
//      that never chose keeps its audit log forever: installing this cron
//      can never delete history nobody asked to lose.
//   2. The window is floored at 90 days (org-policy RETENTION_BOUNDS), so a
//      bad value can never empty a log.
//   3. It deletes in batches of 5000 by id, and writes ONE `audit.purged`
//      row per org naming how many rows went and the cut-off, so the purge
//      is itself on the record.
//   4. `?dry=1` reports what it would delete and deletes nothing.
//   5. It never deletes a row a feature reads back (weekly review decisions,
//      goal creators, invites, shares, the retired grid, consent, staff
//      rows): src/lib/audit-retention.ts, AUDIT_PURGE_KEEP_TYPES.
//
// NOT INSTALLED. scripts/CRON-SETUP.md carries the row; the crontab is the
// founder's step.

import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { retentionOf } from "@/lib/settings/org-policy";
import { auditPurgeWhere } from "@/lib/audit-retention";
import { cronRefusal } from "@/lib/cron-auth";
import { cronJob } from "@/lib/cron-result";

export const dynamic = "force-dynamic";

const BATCH = 5000;

async function handle(req: NextRequest) {
  const refused = cronRefusal(req);
  if (refused) return refused;

  const dryRun = req.nextUrl.searchParams.get("dry") === "1";
  const report: Array<{ organizationId: string; days: number; cutoff: string; deleted: number }> = [];
  let cursor: string | undefined;
  for (;;) {
    const orgs = await prisma.organization.findMany({
      select: { id: true, settings: true },
      orderBy: { id: "asc" },
      take: 200,
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
    });
    if (orgs.length === 0) break;
    for (const org of orgs) {
      const days = retentionOf(org.settings).auditDays;
      if (!days) continue;
      const cutoff = new Date(Date.now() - days * 86_400_000);
      // Never the rows a feature reads back (src/lib/audit-retention.ts).
      const where = auditPurgeWhere(org.id, cutoff);
      let deleted = 0;
      if (dryRun) {
        deleted = await prisma.activityLog.count({ where });
      } else {
        for (;;) {
          const ids = await prisma.activityLog.findMany({ where, select: { id: true }, take: BATCH, orderBy: { id: "asc" } });
          if (ids.length === 0) break;
          const r = await prisma.activityLog.deleteMany({ where: { id: { in: ids.map((x) => x.id) } } });
          deleted += r.count;
          if (ids.length < BATCH) break;
        }
        if (deleted > 0) {
          await prisma.activityLog.create({
            data: {
              type: "audit.purged",
              actorId: null,
              actorType: "system",
              actorLabel: "Retention",
              organizationId: org.id,
              description: `Removed ${deleted} audit log ${deleted === 1 ? "entry" : "entries"} older than ${days} days`,
              targetType: "Organization",
              targetId: org.id,
              severity: "info",
              metadata: { days, cutoff: cutoff.toISOString(), deleted },
            },
          });
        }
      }
      report.push({ organizationId: org.id, days, cutoff: cutoff.toISOString(), deleted });
    }
    cursor = orgs[orgs.length - 1].id;
    if (orgs.length < 200) break;
  }
  return Response.json({ ok: true, dryRun, orgs: report.length, report });
}

// Any throw answers 500 and alerts like a failed run (src/lib/cron-result.ts).
export const POST = cronJob("audit-purge", handle);
