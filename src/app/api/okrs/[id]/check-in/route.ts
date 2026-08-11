import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionOrFail, getOrgId, getUserId, jsonError, jsonSuccess } from "@/lib/api-helpers";
import { logActivity } from "@/lib/activity";
import { triggerRecalculation } from "@/services/performanceScoreService";
import {
  enrichKeyResults,
  keyResultProgress,
  KR_KPI_SELECT,
  okrStatusFor,
  rollUpOkrProgress,
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

  // Update OKR overall progress (average of all key results). KPI-linked KRs
  // contribute their DERIVED progress — their stored column is not the truth.
  const okrRow = await prisma.oKR.findUnique({
    where: { id: okrId },
    select: {
      ownerId: true,
      keyResults: {
        select: {
          id: true, startValue: true, targetValue: true, currentValue: true,
          progress: true, kpiId: true, kpi: { select: KR_KPI_SELECT },
        },
      },
    },
  });
  const allKRs = await enrichKeyResults(okrRow?.keyResults ?? [], { userId: okrRow?.ownerId });
  const avgProgress = rollUpOkrProgress(allKRs) ?? 0;

  const status = okrStatusFor(avgProgress);

  await prisma.oKR.update({
    where: { id: okrId },
    data: { progress: avgProgress, status },
  });

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
