// Headcount plans — list + upsert (one row per department per
// period). Admin-only writes (this is finance-sensitive); manager+
// reads for view.

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

export async function GET(req: NextRequest) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;
  if (!isManager(session)) return jsonError("Forbidden", 403);

  const orgId = getOrgId(session);
  const period = new URL(req.url).searchParams.get("period");

  const where: Record<string, unknown> = { organizationId: orgId };
  if (period) where.period = period;

  const plans = await prisma.headcountPlan.findMany({
    where,
    orderBy: [{ period: "desc" }, { departmentId: "asc" }],
    include: { department: { select: { id: true, name: true } } },
  });

  return jsonSuccess(
    plans.map((p) => ({
      ...p,
      plannedBudget: p.plannedBudget === null ? null : Number(p.plannedBudget),
    })),
  );
}

export async function POST(req: NextRequest) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;
  if (!isOrgAdmin(session)) return jsonError("Forbidden", 403);

  const body = await req.json();
  const period = typeof body.period === "string" ? body.period.trim() : "";
  const departmentId = typeof body.departmentId === "string" && body.departmentId
    ? body.departmentId
    : null;
  const plannedHeadcount = Math.max(0, Math.min(1_000_000, Number(body.plannedHeadcount) || 0));
  const budgetCurrency = (typeof body.budgetCurrency === "string" ? body.budgetCurrency.trim().toUpperCase() : "USD").slice(0, 3);
  const notes = typeof body.notes === "string" ? body.notes.trim() || null : null;

  if (!period) return jsonError("period is required");
  if (period.length > 20) return jsonError("period too long");
  if (budgetCurrency.length !== 3) return jsonError("Invalid currency");
  if (!Number.isFinite(plannedHeadcount)) return jsonError("Invalid plannedHeadcount");

  let plannedBudget: number | null = null;
  if (body.plannedBudget !== undefined && body.plannedBudget !== null && body.plannedBudget !== "") {
    plannedBudget = Number(body.plannedBudget);
    if (!Number.isFinite(plannedBudget) || plannedBudget < 0) return jsonError("Invalid plannedBudget");
  }

  const orgId = getOrgId(session);

  if (departmentId) {
    const dept = await prisma.department.findFirst({
      where: { id: departmentId, organizationId: orgId },
      select: { id: true },
    });
    if (!dept) return jsonError("Department not found", 404);
  }

  // Upsert on (org, dept, period). The (deptId=null) row represents
  // an org-wide plan when no department-level breakdown is given.
  const upserted = departmentId
    ? await prisma.headcountPlan.upsert({
        where: {
          organizationId_departmentId_period: {
            organizationId: orgId,
            departmentId,
            period,
          },
        },
        update: { plannedHeadcount, plannedBudget, budgetCurrency, notes },
        create: { organizationId: orgId, departmentId, period, plannedHeadcount, plannedBudget, budgetCurrency, notes },
      })
    : await (async () => {
        // Prisma can't upsert with a composite key that includes a
        // nullable column — find-then-update / create instead.
        const existing = await prisma.headcountPlan.findFirst({
          where: { organizationId: orgId, departmentId: null, period },
        });
        if (existing) {
          return prisma.headcountPlan.update({
            where: { id: existing.id },
            data: { plannedHeadcount, plannedBudget, budgetCurrency, notes },
          });
        }
        return prisma.headcountPlan.create({
          data: { organizationId: orgId, departmentId: null, period, plannedHeadcount, plannedBudget, budgetCurrency, notes },
        });
      })();

  return jsonSuccess({
    ...upserted,
    plannedBudget: upserted.plannedBudget === null ? null : Number(upserted.plannedBudget),
  });
}
