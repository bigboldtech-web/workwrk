// Pay runs — list + create. Org-admin only.

import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  getSessionOrFail,
  getOrgId,
  getUserId,
  jsonError,
  jsonSuccess,
  isOrgAdmin,
} from "@/lib/api-helpers";
import { logAuditEvent } from "@/lib/activity";

export async function GET(req: NextRequest) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;
  if (!isOrgAdmin(session)) return jsonError("Forbidden", 403);

  const orgId = getOrgId(session);
  const sp = new URL(req.url).searchParams;
  const limit = Math.min(200, Number(sp.get("limit")) || 50);
  const status = sp.get("status")?.toUpperCase();

  const where: Record<string, unknown> = { organizationId: orgId };
  if (status) where.status = status;

  const runs = await prisma.payRun.findMany({
    where,
    orderBy: { payDate: "desc" },
    take: limit,
    include: {
      payGroup: { select: { id: true, name: true } },
      _count: { select: { payslips: true } },
    },
  });
  return jsonSuccess(runs);
}

export async function POST(req: NextRequest) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;
  if (!isOrgAdmin(session)) return jsonError("Forbidden", 403);

  const body = await req.json();
  const payGroupId = typeof body.payGroupId === "string" ? body.payGroupId : "";
  const periodStart = typeof body.periodStart === "string" ? new Date(body.periodStart) : null;
  const periodEnd = typeof body.periodEnd === "string" ? new Date(body.periodEnd) : null;
  const payDate = typeof body.payDate === "string" ? new Date(body.payDate) : null;
  if (!payGroupId) return jsonError("payGroupId required");
  if (!periodStart || Number.isNaN(periodStart.getTime())) return jsonError("periodStart required");
  if (!periodEnd || Number.isNaN(periodEnd.getTime())) return jsonError("periodEnd required");
  if (!payDate || Number.isNaN(payDate.getTime())) return jsonError("payDate required");
  if (periodEnd <= periodStart) return jsonError("periodEnd must be after periodStart");

  const orgId = getOrgId(session);
  // Make sure the group belongs to this org — important defense for
  // any admin attempting to schedule runs on someone else's tenant.
  const group = await prisma.payGroup.findFirst({
    where: { id: payGroupId, organizationId: orgId },
    select: { id: true },
  });
  if (!group) return jsonError("Pay group not found", 404);

  try {
    const run = await prisma.payRun.create({
      data: {
        organizationId: orgId,
        payGroupId,
        periodStart,
        periodEnd,
        payDate,
        notes: typeof body.notes === "string" ? body.notes.trim() || null : null,
      },
    });

    // Pay runs disburse money — log as critical for forensic audit.
    logAuditEvent({
      type: "pay_run_created",
      actorId: getUserId(session),
      organizationId: orgId,
      description: `Created pay run for ${periodStart.toISOString().slice(0, 10)} → ${periodEnd.toISOString().slice(0, 10)} (pay date ${payDate.toISOString().slice(0, 10)})`,
      targetId: run.id,
      targetType: "pay_run",
      metadata: { payGroupId, periodStart: periodStart.toISOString(), periodEnd: periodEnd.toISOString(), payDate: payDate.toISOString() },
      severity: "critical",
    });

    return jsonSuccess(run, 201);
  } catch (e: unknown) {
    if (typeof e === "object" && e && "code" in e && (e as { code: string }).code === "P2002") {
      return jsonError("A pay run already exists for that pay group + period start", 409);
    }
    throw e;
  }
}
