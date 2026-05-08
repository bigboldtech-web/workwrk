// Approve / reject a time-off request. Manager+ only. Refuses
// self-decision (manager who happens to be the requester can't
// approve their own time off — has to escalate).

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
  if (!["APPROVE", "REJECT"].includes(decision)) {
    return jsonError("decision must be APPROVE or REJECT");
  }

  const r = await prisma.timeOffRequest.findFirst({
    where: { id, organizationId: orgId },
  });
  if (!r) return jsonError("Request not found", 404);

  if (r.userId === userId) {
    return jsonError("You can't decide on your own time-off request", 403);
  }
  if (r.status !== "PENDING") {
    return jsonError(`Cannot decide on a ${r.status} request`, 409);
  }

  const updated = await prisma.timeOffRequest.update({
    where: { id },
    data: {
      status: decision === "APPROVE" ? "APPROVED" : "REJECTED",
      approverId: userId,
      decisionAt: new Date(),
      decisionNote: note,
    },
  });

  logActivity({
    type: `time_off_${decision.toLowerCase()}`,
    actorId: userId,
    organizationId: orgId,
    description: `${decision === "APPROVE" ? "Approved" : "Rejected"} time-off request`,
    targetId: id,
    targetType: "time_off_request",
  });

  return jsonSuccess({ ...updated, hours: Number(updated.hours) });
}
