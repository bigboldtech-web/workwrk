// Manager proposes / edits a single compensation decision row.
//
// Authorization:
//   - admin: any decision
//   - the named proposedBy: their own row
//   - the subject's direct manager (current `managerId` on the user):
//     even if proposedBy is null they can claim the row
// Cycle must be DRAFT or OPEN. Once decided (APPROVED/REJECTED), only
// admins can edit (e.g. to retract before close).

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

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;

  const { id } = await params;
  const orgId = getOrgId(session);
  const userId = getUserId(session);

  const decision = await prisma.compensationDecision.findFirst({
    where: { id, organizationId: orgId },
    include: {
      cycle: { select: { status: true, reportingCurrency: true } },
      subject: { select: { managerId: true } },
    },
  });
  if (!decision) return jsonError("Decision not found", 404);

  const adminCanAct = isOrgAdmin(session);
  const isClaimedProposer = decision.proposedById === userId;
  const isCurrentManager = decision.subject.managerId === userId;
  const canEdit = adminCanAct || isClaimedProposer || isCurrentManager;
  if (!canEdit) return jsonError("Forbidden", 403);

  if (decision.cycle.status === "CLOSED" && !adminCanAct) {
    return jsonError("Cycle is closed", 409);
  }
  if ((decision.status === "APPROVED" || decision.status === "REJECTED") && !adminCanAct) {
    return jsonError("Decision is already final", 409);
  }
  // Reporters can never decide on themselves — even if a manager IS
  // their own subject (rare edge case where the row is self-referential),
  // they shouldn't propose for themselves.
  if (decision.subjectId === userId && !adminCanAct) {
    return jsonError("You can't propose your own compensation", 403);
  }

  const body = await req.json();
  const data: Record<string, unknown> = {};

  if (body.currentSalary !== undefined) {
    if (body.currentSalary === null || body.currentSalary === "") {
      data.currentSalary = null;
    } else {
      const num = Number(body.currentSalary);
      if (!Number.isFinite(num) || num < 0) return jsonError("Invalid currentSalary");
      if (num > 9_999_999_999) return jsonError("currentSalary exceeds the column limit");
      data.currentSalary = num;
    }
  }
  if (body.proposedSalary !== undefined) {
    if (body.proposedSalary === null || body.proposedSalary === "") {
      data.proposedSalary = null;
    } else {
      const num = Number(body.proposedSalary);
      if (!Number.isFinite(num) || num < 0) return jsonError("Invalid proposedSalary");
      if (num > 9_999_999_999) return jsonError("proposedSalary exceeds the column limit");
      data.proposedSalary = num;
    }
  }
  if (typeof body.currency === "string") {
    const cur = body.currency.trim().toUpperCase();
    if (cur.length !== 3) return jsonError("currency must be a 3-letter ISO code");
    data.currency = cur;
  }
  if (body.changePct !== undefined) {
    if (body.changePct === null || body.changePct === "") {
      data.changePct = null;
    } else {
      const num = Number(body.changePct);
      if (!Number.isFinite(num)) return jsonError("Invalid changePct");
      if (num < -100 || num > 1000) return jsonError("changePct out of range");
      data.changePct = num;
    }
  }
  if (body.bonusAmount !== undefined) {
    if (body.bonusAmount === null || body.bonusAmount === "") {
      data.bonusAmount = null;
    } else {
      const num = Number(body.bonusAmount);
      if (!Number.isFinite(num) || num < 0) return jsonError("Invalid bonusAmount");
      if (num > 9_999_999_999) return jsonError("bonusAmount exceeds the column limit");
      data.bonusAmount = num;
    }
  }
  if (body.reasoning !== undefined) {
    data.reasoning = typeof body.reasoning === "string" ? body.reasoning.trim() || null : null;
  }

  // If proposedBy is null, the first non-admin manager to write claims
  // the row — keeps the audit pinned to who actually proposed it.
  if (decision.proposedById === null && !adminCanAct) {
    data.proposedById = userId;
  }

  // Submit transition: managers flip DRAFT → PROPOSED to send to HR.
  // Reverting PROPOSED → DRAFT is allowed before HR decides.
  if (body.submit === true && decision.status === "DRAFT") {
    data.status = "PROPOSED";
  }
  if (body.retract === true && decision.status === "PROPOSED") {
    data.status = "DRAFT";
  }

  if (Object.keys(data).length === 0) return jsonError("No changes");

  const updated = await prisma.compensationDecision.update({
    where: { id },
    data,
  });

  logActivity({
    type: "comp_decision_updated",
    actorId: userId,
    organizationId: orgId,
    description: `Updated comp decision for subject`,
    targetId: id,
    targetType: "comp_decision",
  });

  return jsonSuccess({
    ...updated,
    currentSalary: updated.currentSalary === null ? null : Number(updated.currentSalary),
    proposedSalary: updated.proposedSalary === null ? null : Number(updated.proposedSalary),
    bonusAmount: updated.bonusAmount === null ? null : Number(updated.bonusAmount),
    changePct: updated.changePct === null ? null : Number(updated.changePct),
  });
}
