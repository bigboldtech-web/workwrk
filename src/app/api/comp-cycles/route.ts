// Compensation cycles — list + create. Manager+ can read; only org
// admin / HR can create. Heavy auth on the inner decisions route, not
// here (the cycle row itself is metadata, not pay data).

import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  getSessionOrFail,
  getOrgId,
  jsonError,
  jsonSuccess,
  isManager,
  isOrgAdmin,
} from "@/lib/api-helpers";
import { logActivity } from "@/lib/activity";

export async function GET() {
  const { error, session } = await getSessionOrFail();
  if (error) return error;
  if (!isManager(session)) return jsonError("Forbidden", 403);

  const cycles = await prisma.compensationCycle.findMany({
    where: { organizationId: getOrgId(session) },
    orderBy: [{ status: "asc" }, { startDate: "desc" }],
    take: 50,
    select: {
      id: true,
      name: true,
      description: true,
      status: true,
      startDate: true,
      endDate: true,
      budgetPct: true,
      reportingCurrency: true,
      closedAt: true,
      _count: { select: { decisions: true } },
    },
  });

  const serialized = cycles.map((c) => ({
    ...c,
    budgetPct: c.budgetPct === null ? null : Number(c.budgetPct),
  }));

  return jsonSuccess(serialized);
}

export async function POST(req: NextRequest) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;
  // Only HR / admin can open a comp cycle.
  if (!isOrgAdmin(session)) return jsonError("Forbidden", 403);

  const body = await req.json();
  const name = typeof body.name === "string" ? body.name.trim() : "";
  const description = typeof body.description === "string" ? body.description.trim() || null : null;
  const reportingCurrency = (typeof body.reportingCurrency === "string"
    ? body.reportingCurrency.trim().toUpperCase()
    : "USD"
  ).slice(0, 3);

  if (!name) return jsonError("name is required");
  if (name.length > 120) return jsonError("name too long (max 120)");
  if (reportingCurrency.length !== 3) return jsonError("reportingCurrency must be a 3-letter ISO code");

  const startDate = body.startDate ? new Date(body.startDate) : null;
  const endDate = body.endDate ? new Date(body.endDate) : null;
  if (!startDate || Number.isNaN(startDate.getTime())) return jsonError("startDate is required");
  if (!endDate || Number.isNaN(endDate.getTime())) return jsonError("endDate is required");
  if (endDate <= startDate) return jsonError("endDate must be after startDate");

  let budgetPct: number | null = null;
  if (body.budgetPct !== undefined && body.budgetPct !== null && body.budgetPct !== "") {
    const num = Number(body.budgetPct);
    if (!Number.isFinite(num)) return jsonError("Invalid budgetPct");
    if (num < -50 || num > 100) return jsonError("budgetPct out of range");
    budgetPct = num;
  }

  const orgId = getOrgId(session);
  const cycle = await prisma.compensationCycle.create({
    data: {
      organizationId: orgId,
      name,
      description,
      startDate,
      endDate,
      reportingCurrency,
      budgetPct,
    },
  });

  logActivity({
    type: "comp_cycle_created",
    actorId: (session.user as { id: string }).id,
    organizationId: orgId,
    description: `Created compensation cycle "${name}"`,
    targetId: cycle.id,
    targetType: "comp_cycle",
  });

  return jsonSuccess(
    {
      ...cycle,
      budgetPct: cycle.budgetPct === null ? null : Number(cycle.budgetPct),
    },
    201,
  );
}
