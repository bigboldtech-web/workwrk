// POST /api/reviews/[id]/cancel { reason? } -> { id, status: "CANCELLED" }
//
// Cancel cycle (spec-teams-performance /reviews row menu): "Nothing is
// deleted. The cycle stops and nobody is asked for anything more." A Draft
// or Active cycle only; a cycle in calibration is finished by Finalize, and
// a completed one never changes. The People team, Admin, or the manager who
// started it; never an Agent (cap.agent.delete: a cancel ends every open
// review in the cycle, so it carries the delete cap).

import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionOrFail, getOrgId, getUserId, jsonError, jsonSuccess } from "@/lib/api-helpers";
import { canManageReviewCycle } from "@/lib/people/review-cycle-access";
import { cycleViewerCtx } from "@/lib/performance/review-cycle.server";
import { cycleTransitionBlocked } from "@/lib/performance/review-cycle";
import { logActivity } from "@/lib/activity";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;
  const { id } = await params;
  const cycle = await prisma.reviewCycle.findFirst({ where: { id, organizationId: getOrgId(session) } });
  if (!cycle) return jsonError("Review cycle not found", 404);
  const ctx = await cycleViewerCtx();
  if (!(await canManageReviewCycle(session, cycle)) || ctx?.isAgent) {
    return jsonError("Only the People team, an Admin or the manager who started this cycle can cancel it", 403);
  }
  const blocked = cycleTransitionBlocked(cycle.status, "CANCELLED");
  if (blocked) return jsonError(blocked, 409);
  const body = ((await req.json().catch(() => null)) ?? {}) as { reason?: unknown };
  const reason = typeof body.reason === "string" ? body.reason.trim().slice(0, 1000) : "";

  // Guarded on the status it starts from, so a launch racing the cancel
  // cannot leave a cancelled cycle with fresh reviews in it unnoticed.
  const res = await prisma.reviewCycle.updateMany({ where: { id, status: cycle.status }, data: { status: "CANCELLED" } });
  if (res.count === 0) return jsonError("This cycle changed a moment ago. Refresh and try again.", 409);

  logActivity({
    type: "review_cycle.cancel",
    actorId: getUserId(session),
    organizationId: getOrgId(session),
    description: `Cancelled review cycle: ${cycle.name}`,
    targetId: cycle.id,
    targetType: "ReviewCycle",
    metadata: { previousStatus: cycle.status, ...(reason ? { reason } : {}) },
  });
  return jsonSuccess({ id, status: "CANCELLED" });
}
