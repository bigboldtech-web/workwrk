import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionOrFail, getOrgId, getUserId, jsonError, jsonSuccess } from "@/lib/api-helpers";
import { canEditOkrOwner } from "@/lib/alignment-scope";
import { logActivity } from "@/lib/activity";
import { triggerRecalculation } from "@/services/performanceScoreService";
import {
  keyResultProgress,
  KR_KPI_SELECT,
  persistGoalRollupChain,
} from "@/lib/alignment";

// POST: Check in on a key result (update progress)
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;

  const { id: okrId } = await params;
  const userId = getUserId(session);
  const body = await req.json();
  const { keyResultId, value, note } = body;

  if (!keyResultId || value == null) return jsonError("keyResultId and value required");

  // Checking in is a WRITE on the objective — owner, tree-manager of the
  // owner, or org-wide level only (a peer can't move someone else's goal).
  const okrRef = await prisma.oKR.findFirst({
    where: { id: okrId, organizationId: getOrgId(session) },
    select: { ownerId: true },
  });
  if (!okrRef) return jsonError("OKR not found", 404);
  if (!(await canEditOkrOwner(session, okrRef.ownerId))) {
    return jsonError("You can only check in on your own goals or your reports' goals.", 403);
  }

  const kr = await prisma.keyResult.findFirst({
    where: { id: keyResultId, okrId },
    include: { kpi: { select: KR_KPI_SELECT } },
  });
  if (!kr) return jsonError("Key Result not found", 404);

  // A KR linked to a role KPI is measured BY that gauge — its number comes
  // from the KPI's records, not from a hand-typed check-in. Refuse rather
  // than accept a value we would then ignore on read.
  if (kr.kpiId) {
    return jsonError(
      `"${kr.title}" is measured by the KPI "${kr.kpi?.name ?? "linked KPI"}" — record the KPI reading instead of checking in here.`,
      409,
    );
  }

  // Create check-in
  await prisma.kRCheckIn.create({
    data: { keyResultId, value: Number(value), note: note || null, userId },
  });

  // Update key result current value and progress
  const progress = keyResultProgress(kr.startValue, kr.targetValue, Number(value));

  await prisma.keyResult.update({
    where: { id: keyResultId },
    data: { currentValue: Number(value), progress },
  });

  // Roll the objective up from its key results' LIVE numbers (KPI-linked
  // KRs contribute their derived progress) and persist the whole ancestor
  // chain — a check-in on a child must move its parent goal too.
  const rollup = await persistGoalRollupChain(okrId);
  const avgProgress = rollup?.progress ?? progress;
  const status = rollup?.status ?? "ON_TRACK";

  // Log activity and trigger recalculation
  const orgId = getOrgId(session);
  const okr = await prisma.oKR.findUnique({ where: { id: okrId }, select: { title: true, ownerId: true } });
  logActivity({
    type: "okr_check_in",
    actorId: userId,
    organizationId: orgId,
    description: `Updated OKR progress to ${avgProgress}% — "${okr?.title}"`,
    targetId: okrId,
    targetType: "okr",
  });
  if (okr?.ownerId) triggerRecalculation(okr.ownerId, orgId);

  return jsonSuccess({ progress: avgProgress, status, krProgress: progress });
}
