// Manager acts on a report's submitted KPI score. Mirrors
// /api/weekly-reviews/[id]/manager-review: auth → fetch → gate
// (manager-of-report or org admin) → SUBMITTED-only → self-act refusal →
// delegate to the helper (status transition + notification).

import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { isInReportTree } from "@/lib/reporting-line";
import { actOnKpiRecord } from "@/lib/kpi-record";

const ORG_ADMIN_LEVELS = new Set(["SUPER_ADMIN", "COMPANY_ADMIN"]);

const bodySchema = z.object({
  action: z.enum(["approve", "request_changes"]),
  notes: z.string().max(5000).optional(),
});

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const u = session.user as { id?: string; accessLevel?: string; organizationId?: string };
  if (!u.id || !u.organizationId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid body", issues: parsed.error.issues }, { status: 400 });
  }

  const row = await prisma.kPIRecord.findUnique({
    where: { id },
    select: { id: true, userId: true, status: true, kpi: { select: { organizationId: true } } },
  });
  if (!row || row.kpi.organizationId !== u.organizationId) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  if (row.userId === u.id) {
    return NextResponse.json({ error: "Cannot review your own KPI" }, { status: 400 });
  }

  const isOrgAdmin = ORG_ADMIN_LEVELS.has(u.accessLevel ?? "EMPLOYEE");
  if (!isOrgAdmin && !(await isInReportTree(u.id, row.userId))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  if (row.status !== "SUBMITTED") {
    return NextResponse.json(
      { error: `Cannot act on a ${row.status.toLowerCase()} KPI score` },
      { status: 400 },
    );
  }

  await actOnKpiRecord(id, { action: parsed.data.action, notes: parsed.data.notes });
  return NextResponse.json({ ok: true });
}
