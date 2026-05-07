// Cycle detail + transition + delete.
//
// GET returns cycle metadata plus role-filtered decisions:
//   - org admin / HR  → all decisions
//   - manager         → decisions for their direct reports only
//   - employee        → forbidden (own-pay self-view will be a separate
//                        endpoint that only exposes APPROVED state)
//
// PATCH transitions DRAFT → OPEN → CLOSED (one-way) and lets admins
// edit metadata. Mid-cycle decisions are not modified by status
// transitions — closing a cycle just locks new decisions and stamps
// `closedAt` for audit.

import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  getSessionOrFail,
  getOrgId,
  getUserId,
  jsonError,
  jsonSuccess,
  isManager,
  isOrgAdmin,
} from "@/lib/api-helpers";
import { logActivity } from "@/lib/activity";

const VALID_STATUSES = new Set(["DRAFT", "OPEN", "CLOSED"]);

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;
  if (!isManager(session)) return jsonError("Forbidden", 403);

  const { id } = await params;
  const orgId = getOrgId(session);
  const userId = getUserId(session);

  const cycle = await prisma.compensationCycle.findFirst({
    where: { id, organizationId: orgId },
  });
  if (!cycle) return jsonError("Cycle not found", 404);

  // Decision visibility filter. Admin/HR sees everything; managers
  // see only their direct reports.
  const isAdmin = isOrgAdmin(session);
  const decisionWhere: Record<string, unknown> = { cycleId: id };
  if (!isAdmin) {
    const directReports = await prisma.user.findMany({
      where: { managerId: userId },
      select: { id: true },
    });
    const reportIds = directReports.map((r) => r.id);
    // A manager also sees their own row if it exists (so they can see
    // what's been proposed for them by *their* manager).
    decisionWhere.subjectId = { in: [...reportIds, userId] };
  }

  const decisions = await prisma.compensationDecision.findMany({
    where: decisionWhere,
    orderBy: [{ status: "asc" }, { createdAt: "asc" }],
    take: 1000,
    include: {
      subject: { select: { id: true, firstName: true, lastName: true, email: true } },
      proposedBy: { select: { id: true, firstName: true, lastName: true } },
    },
  });

  const serializedDecisions = decisions.map((d) => ({
    ...d,
    currentSalary: d.currentSalary === null ? null : Number(d.currentSalary),
    proposedSalary: d.proposedSalary === null ? null : Number(d.proposedSalary),
    bonusAmount: d.bonusAmount === null ? null : Number(d.bonusAmount),
    changePct: d.changePct === null ? null : Number(d.changePct),
  }));

  return jsonSuccess({
    cycle: {
      ...cycle,
      budgetPct: cycle.budgetPct === null ? null : Number(cycle.budgetPct),
    },
    decisions: serializedDecisions,
    viewerRole: isAdmin ? "ADMIN" : "MANAGER",
  });
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;
  if (!isOrgAdmin(session)) return jsonError("Forbidden", 403);

  const { id } = await params;
  const orgId = getOrgId(session);
  const userId = getUserId(session);

  const cycle = await prisma.compensationCycle.findFirst({
    where: { id, organizationId: orgId },
  });
  if (!cycle) return jsonError("Cycle not found", 404);

  const body = await req.json();
  const data: Record<string, unknown> = {};

  if (typeof body.name === "string") {
    const name = body.name.trim();
    if (!name) return jsonError("name cannot be empty");
    if (name.length > 120) return jsonError("name too long");
    data.name = name;
  }
  if (body.description !== undefined) {
    data.description = typeof body.description === "string" ? body.description.trim() || null : null;
  }
  if (body.startDate) {
    const d = new Date(body.startDate);
    if (Number.isNaN(d.getTime())) return jsonError("Invalid startDate");
    data.startDate = d;
  }
  if (body.endDate) {
    const d = new Date(body.endDate);
    if (Number.isNaN(d.getTime())) return jsonError("Invalid endDate");
    data.endDate = d;
  }
  if (body.budgetPct !== undefined) {
    if (body.budgetPct === null || body.budgetPct === "") {
      data.budgetPct = null;
    } else {
      const num = Number(body.budgetPct);
      if (!Number.isFinite(num)) return jsonError("Invalid budgetPct");
      if (num < -50 || num > 100) return jsonError("budgetPct out of range");
      data.budgetPct = num;
    }
  }

  if (typeof body.status === "string") {
    if (!VALID_STATUSES.has(body.status)) return jsonError("Invalid status");
    // One-way transitions: DRAFT → OPEN → CLOSED. Reopening a closed
    // cycle would invalidate audit; refuse it.
    const order: Record<string, number> = { DRAFT: 0, OPEN: 1, CLOSED: 2 };
    if (order[body.status] < order[cycle.status]) {
      return jsonError(`Can't move cycle backward from ${cycle.status} to ${body.status}`, 409);
    }
    data.status = body.status;
    if (body.status === "CLOSED") data.closedAt = new Date();
  }

  if (Object.keys(data).length === 0) return jsonError("No changes");

  const updated = await prisma.compensationCycle.update({
    where: { id },
    data,
  });

  logActivity({
    type: "comp_cycle_updated",
    actorId: userId,
    organizationId: orgId,
    description: `Updated compensation cycle "${updated.name}"`,
    targetId: id,
    targetType: "comp_cycle",
  });

  return jsonSuccess({
    ...updated,
    budgetPct: updated.budgetPct === null ? null : Number(updated.budgetPct),
  });
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;
  if (!isOrgAdmin(session)) return jsonError("Forbidden", 403);

  const { id } = await params;
  const orgId = getOrgId(session);

  const cycle = await prisma.compensationCycle.findFirst({
    where: { id, organizationId: orgId },
  });
  if (!cycle) return jsonError("Cycle not found", 404);
  if (cycle.status !== "DRAFT") {
    return jsonError("Only DRAFT cycles can be deleted. Close instead.", 409);
  }

  await prisma.compensationCycle.delete({ where: { id } });
  return jsonSuccess({ deleted: true });
}
