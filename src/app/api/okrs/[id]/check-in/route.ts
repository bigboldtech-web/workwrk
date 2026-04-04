import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionOrFail, getOrgId, getUserId, jsonError, jsonSuccess } from "@/lib/api-helpers";

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
  });
  if (!kr) return jsonError("Key Result not found", 404);

  // Create check-in
  await prisma.kRCheckIn.create({
    data: { keyResultId, value: Number(value), note: note || null, userId },
  });

  // Update key result current value and progress
  const progress = kr.targetValue > kr.startValue
    ? Math.min(Math.round(((Number(value) - kr.startValue) / (kr.targetValue - kr.startValue)) * 100), 100)
    : 100;

  await prisma.keyResult.update({
    where: { id: keyResultId },
    data: { currentValue: Number(value), progress },
  });

  // Update OKR overall progress (average of all key results)
  const allKRs = await prisma.keyResult.findMany({
    where: { okrId },
    select: { progress: true },
  });
  const avgProgress = Math.round(allKRs.reduce((sum, k) => sum + k.progress, 0) / allKRs.length);

  const status = avgProgress >= 100 ? "COMPLETED" : avgProgress >= 70 ? "ON_TRACK" : avgProgress >= 40 ? "AT_RISK" : "BEHIND";

  await prisma.oKR.update({
    where: { id: okrId },
    data: { progress: avgProgress, status },
  });

  return jsonSuccess({ progress: avgProgress, status, krProgress: progress });
}
