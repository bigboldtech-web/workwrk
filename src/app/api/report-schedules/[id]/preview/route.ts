// GET /api/report-schedules/[id]/preview: the email THE CALLER would receive.
//
// Its creator, an org admin or one of its recipients. Built by
// buildRecipientReport for the caller ONLY: nobody can preview another
// recipient's copy, because each copy is that recipient's access. Nothing is
// queued.

import { NextResponse } from "next/server";
import { itemCtx } from "@/lib/item-gate";
import { prisma } from "@/lib/prisma";
import { requireWorkApp } from "@/lib/dashboards/dashboard-server";
import { buildRecipientReport, canEditSchedule, withReportTable } from "@/lib/reports/report-server";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const c = await itemCtx();
  if ("error" in c) return c.error;
  const app = await requireWorkApp();
  if ("error" in app) return app.error;
  const { id } = await params;
  return withReportTable(async () => {
    const row = await prisma.reportSchedule.findFirst({ where: { id, organizationId: c.organizationId } });
    if (!row || !(canEditSchedule(row, c) || row.recipientUserIds.includes(c.userId))) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    const report = await buildRecipientReport(row, c);
    return NextResponse.json(report, { headers: { "Cache-Control": "private, no-store" } });
  });
}
