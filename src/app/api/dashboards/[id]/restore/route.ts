// POST /api/dashboards/[id]/restore: bring an archived dashboard back.
//
// Owner or org admin (canEditDashboard, awaited: it is async because a
// Space's Overview asks the Space's managers). Its report schedules resume at
// their next due instant with no other step, because an archived target only
// ever recorded a skip. A Guest is answered 404 by requireWorkApp.

import { NextResponse } from "next/server";
import { itemCtx } from "@/lib/item-gate";
import { prisma } from "@/lib/prisma";
import { canEditDashboard, notFound, readDashboard, requireWorkApp } from "@/lib/dashboards/dashboard-server";

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const c = await itemCtx();
  if ("error" in c) return c.error;
  const app = await requireWorkApp();
  if ("error" in app) return app.error;
  const { id } = await params;
  const found = await readDashboard(id, c, { archived: true });
  if (!found) return notFound();
  if (!(await canEditDashboard(found.row, c, found.spaceMissing))) {
    return NextResponse.json({ error: "no_access", reason: "not_dashboard_owner" }, { status: 403 });
  }
  await prisma.dashboard.updateMany({ where: { id, organizationId: c.organizationId }, data: { archivedAt: null } });
  return NextResponse.json({ ok: true });
}
