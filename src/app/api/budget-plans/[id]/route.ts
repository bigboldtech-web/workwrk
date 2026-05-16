// Single budget plan — get + state transitions (publish, archive,
// rename) and scenario CRUD. Org-admin only.
//
// GET returns the plan + every scenario + the period set the lines
// can target (the fiscal year's monthly periods) and the org's
// expense-typed accounts (the cells the user can edit). The grid
// editor on /planning/[id] uses this single payload to render.

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
import { logActivity, logAuditEvent } from "@/lib/activity";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;
  if (!isOrgAdmin(session)) return jsonError("Forbidden", 403);

  const { id } = await params;
  const orgId = getOrgId(session);

  const plan = await prisma.budgetPlan.findFirst({
    where: { id, organizationId: orgId },
    include: {
      fiscalYear: {
        include: {
          periods: {
            orderBy: { startDate: "asc" },
            select: { id: true, label: true, startDate: true, endDate: true, status: true },
          },
        },
      },
      scenarios: { orderBy: [{ isDefault: "desc" }, { name: "asc" }] },
      lines: {
        select: {
          id: true,
          accountId: true,
          costCenterId: true,
          periodId: true,
          scenarioId: true,
          amount: true,
          driverId: true,
          notes: true,
        },
      },
    },
  });
  if (!plan) return jsonError("Not found", 404);

  // Default account selection: REVENUE + EXPENSE accounts (the lines
  // that actually drive a budget). Admins can extend in v2.
  const accounts = await prisma.glAccount.findMany({
    where: {
      organizationId: orgId,
      active: true,
      type: { in: ["REVENUE", "EXPENSE"] },
    },
    orderBy: [{ type: "asc" }, { code: "asc" }],
    select: { id: true, code: true, name: true, type: true, currency: true },
  });

  return jsonSuccess({ plan, accounts });
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;
  if (!isOrgAdmin(session)) return jsonError("Forbidden", 403);

  const { id } = await params;
  const body = await req.json();
  const action = typeof body.action === "string" ? body.action : "";
  const orgId = getOrgId(session);

  const plan = await prisma.budgetPlan.findFirst({
    where: { id, organizationId: orgId },
    select: { id: true, status: true, version: true, name: true },
  });
  if (!plan) return jsonError("Not found", 404);

  const userId = getUserId(session);

  if (action === "publish") {
    if (plan.status === "PUBLISHED") return jsonError("Already published");
    if (plan.status === "ARCHIVED") return jsonError("Cannot publish archived plan");
    const updated = await prisma.budgetPlan.update({
      where: { id },
      data: { status: "PUBLISHED", publishedAt: new Date() },
    });
    // Publishing a plan locks in the version that drives variance reports —
    // warning severity makes it findable.
    logAuditEvent({
      type: "budget_plan_published",
      actorId: userId,
      organizationId: orgId,
      description: `Published plan "${plan.name}" (v${plan.version})`,
      targetId: id,
      targetType: "budget_plan",
      metadata: { version: plan.version },
    });
    return jsonSuccess(updated);
  }

  if (action === "archive") {
    const updated = await prisma.budgetPlan.update({
      where: { id },
      data: { status: "ARCHIVED", archivedAt: new Date() },
    });
    logActivity({
      type: "budget_plan_archived",
      actorId: userId,
      organizationId: orgId,
      description: `Archived plan "${plan.name}"`,
      targetId: id,
      targetType: "budget_plan",
    });
    return jsonSuccess(updated);
  }

  if (action === "rename") {
    const name = typeof body.name === "string" ? body.name.trim() : "";
    if (!name) return jsonError("name required");
    const updated = await prisma.budgetPlan.update({ where: { id }, data: { name } });
    logActivity({
      type: "budget_plan_renamed",
      actorId: userId,
      organizationId: orgId,
      description: `Renamed plan "${plan.name}" → "${name}"`,
      targetId: id,
      targetType: "budget_plan",
      oldValue: { name: plan.name },
      newValue: { name },
    });
    return jsonSuccess(updated);
  }

  return jsonError("Unknown action. Use publish | archive | rename");
}
