// Approver decision endpoint. Only managers (or admins) can approve or
// reject; reporters can't decide on their own expenses. Decision is
// stamped with actor + timestamp + optional note for the audit trail.

import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  getSessionOrFail,
  getOrgId,
  getUserId,
  jsonError,
  jsonSuccess,
  isManager,
} from "@/lib/api-helpers";
import { logActivity } from "@/lib/activity";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;
  if (!isManager(session)) return jsonError("Forbidden", 403);

  const { id } = await params;
  const orgId = getOrgId(session);
  const userId = getUserId(session);

  const body = await req.json();
  const decision = typeof body.decision === "string" ? body.decision.toUpperCase() : "";
  const note = typeof body.note === "string" ? body.note.trim() || null : null;

  if (!["APPROVE", "REJECT", "REIMBURSE"].includes(decision)) {
    return jsonError("decision must be APPROVE, REJECT, or REIMBURSE");
  }

  const existing = await prisma.expense.findFirst({
    where: { id, organizationId: orgId },
  });
  if (!existing) return jsonError("Expense not found", 404);

  // Reporter cannot self-approve. Belt-and-suspenders alongside the
  // role check, since some Fortune-500 deployments have managers who
  // also submit expenses for themselves.
  if (existing.reporterId === userId) {
    return jsonError("You can't decide on your own expense", 403);
  }

  if (decision === "APPROVE") {
    if (existing.status !== "SUBMITTED") {
      return jsonError(`Cannot approve a ${existing.status} expense`, 409);
    }
  } else if (decision === "REJECT") {
    if (existing.status !== "SUBMITTED") {
      return jsonError(`Cannot reject a ${existing.status} expense`, 409);
    }
  } else if (decision === "REIMBURSE") {
    if (existing.status !== "APPROVED") {
      return jsonError(`Only APPROVED expenses can be reimbursed`, 409);
    }
  }

  const nextStatus =
    decision === "APPROVE" ? "APPROVED" :
    decision === "REJECT" ? "REJECTED" :
    "REIMBURSED";

  const updated = await prisma.expense.update({
    where: { id },
    data: {
      status: nextStatus,
      approverId: nextStatus === "REIMBURSED" ? existing.approverId : userId,
      decisionAt: new Date(),
      decisionNote: note,
      reimbursedAt: nextStatus === "REIMBURSED" ? new Date() : existing.reimbursedAt,
    },
  });

  logActivity({
    type: `expense_${decision.toLowerCase()}`,
    actorId: userId,
    organizationId: orgId,
    description: `${decision === "APPROVE" ? "Approved" : decision === "REJECT" ? "Rejected" : "Marked reimbursed"} expense "${existing.description}"`,
    targetId: id,
    targetType: "expense",
  });

  return jsonSuccess({ ...updated, amount: Number(updated.amount) });
}
