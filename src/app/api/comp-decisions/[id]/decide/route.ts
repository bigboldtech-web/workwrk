// HR / admin decision on a manager's proposal. APPROVE / REJECT.
// Decision stamps decidedById + decidedAt + decisionNote for the audit
// trail. Cannot self-decide (admin who is also the subject can't
// approve their own row).

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
import { logActivity } from "@/lib/activity";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;
  if (!isOrgAdmin(session)) return jsonError("Forbidden", 403);

  const { id } = await params;
  const orgId = getOrgId(session);
  const userId = getUserId(session);

  const body = await req.json();
  const decision = typeof body.decision === "string" ? body.decision.toUpperCase() : "";
  const note = typeof body.note === "string" ? body.note.trim() || null : null;
  if (!["APPROVE", "REJECT"].includes(decision)) {
    return jsonError("decision must be APPROVE or REJECT");
  }

  const existing = await prisma.compensationDecision.findFirst({
    where: { id, organizationId: orgId },
    include: { cycle: { select: { status: true } } },
  });
  if (!existing) return jsonError("Decision not found", 404);

  if (existing.subjectId === userId) {
    return jsonError("You can't decide on your own compensation", 403);
  }
  if (existing.cycle.status === "CLOSED") {
    return jsonError("Cycle is closed", 409);
  }
  if (existing.status !== "PROPOSED") {
    return jsonError(`Cannot decide on a ${existing.status} row`, 409);
  }

  const updated = await prisma.compensationDecision.update({
    where: { id },
    data: {
      status: decision === "APPROVE" ? "APPROVED" : "REJECTED",
      decidedById: userId,
      decidedAt: new Date(),
      decisionNote: note,
    },
  });

  logActivity({
    type: `comp_decision_${decision.toLowerCase()}`,
    actorId: userId,
    organizationId: orgId,
    description: `${decision === "APPROVE" ? "Approved" : "Rejected"} comp decision`,
    targetId: id,
    targetType: "comp_decision",
  });

  // Notify the proposer (the manager who put up the row). The subject
  // is deliberately NOT notified — comp disclosure runs on a separate
  // ceremony, not via the inbox bell.
  if (existing.proposedById && existing.proposedById !== userId) {
    prisma.notification.create({
      data: {
        userId: existing.proposedById,
        type: `comp_decision_${decision.toLowerCase()}`,
        title: decision === "APPROVE" ? "Comp proposal approved" : "Comp proposal rejected",
        message: `Your compensation proposal was ${decision === "APPROVE" ? "approved" : "rejected"}${note ? ` — "${note}"` : "."}`,
        link: "/compensation",
      },
    }).catch((err) => console.error("[Comp] Notification failed:", err));
  }

  return jsonSuccess({
    ...updated,
    currentSalary: updated.currentSalary === null ? null : Number(updated.currentSalary),
    proposedSalary: updated.proposedSalary === null ? null : Number(updated.proposedSalary),
    bonusAmount: updated.bonusAmount === null ? null : Number(updated.bonusAmount),
    changePct: updated.changePct === null ? null : Number(updated.changePct),
  });
}
