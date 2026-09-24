// DELETE /api/report-schedules/[id]/recipients/me: stop receiving a report.
//
// ONE atomic statement, so it can only ever narrow who receives, and it never
// confirms a schedule to someone who is not on it (0 rows is a 404). Because
// the cron re-reads the recipient list under the row lock when it claims a
// run, it takes effect for every run not already queued.

import { NextResponse } from "next/server";
import { itemCtx } from "@/lib/item-gate";
import { prisma } from "@/lib/prisma";
import { withReportTable } from "@/lib/reports/report-server";
import { requireWorkApp } from "@/lib/dashboards/dashboard-server";

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const c = await itemCtx();
  if ("error" in c) return c.error;
  const app = await requireWorkApp();
  if ("error" in app) return app.error;
  const { id } = await params;
  return withReportTable(async () => {
    const n = await prisma.$executeRaw`
      UPDATE "ReportSchedule"
      SET "recipientUserIds" = array_remove("recipientUserIds", ${c.userId}), "updatedAt" = now()
      WHERE id = ${id} AND "organizationId" = ${c.organizationId} AND ${c.userId} = ANY("recipientUserIds")`;
    if (n === 0) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json({ ok: true });
  });
}
