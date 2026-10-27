// PATCH  /api/okrs/[id]/key-results/[krId], edit a key result, including
//         linking (kpiId, validated against the caller's org) or unlinking
//         (kpiId: null) a role-level KPI gauge.
// DELETE /api/okrs/[id]/key-results/[krId], remove the key result.
//
// While a KR is linked, it is measured BY the gauge: a hand-typed
// currentValue is ignored (derived wins, `currentValueIgnored` in the
// response says so) and the stored hand-typed number is left untouched,
// so unlinking later restores exactly what the owner last typed. Nothing
// here ever writes a KPI or KPIRecord.

import { NextRequest } from "next/server";
import { goalEditDenial } from "@/lib/goal-audience";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getSessionOrFail, getOrgId, getUserId, jsonError, jsonSuccess } from "@/lib/api-helpers";
import { Prisma } from "@/generated/prisma";
import { logActivity } from "@/lib/activity";
import { applyTargetEditToPeriod, CHECK_IN_INSTEAD, deleteRepeatingTarget, KPI_NEEDS_MONTHS, recomputeOpenCloses } from "@/lib/goals/goal-periods.server";
import { parseTargetSource } from "@/lib/goals/target-source";
import {
  enrichKeyResults,
  inferKeyResultDirection,
  keyResultProgress,
  KR_KPI_SELECT,
  persistGoalRollupChain,
  resolveKpiLink,
} from "@/lib/alignment";

const patchSchema = z.object({
  title: z.string().min(1).max(300).optional(),
  unit: z.string().max(32).nullish(),
  startValue: z.number().finite().optional(),
  targetValue: z.number().finite().optional(),
  currentValue: z.number().finite().optional(),
  // undefined = leave the link alone; null = clear it; string = link.
  kpiId: z.string().min(1).nullish(),
  // Repeating goals (docs/plans/recurring-goals.md B4, C6).
  periodStart: z.enum(["START", "LAST"]).nullish(),
  source: z.unknown().optional(),
});

async function findScopedKeyResult(okrId: string, krId: string, orgId: string) {
  return prisma.keyResult.findFirst({
    where: { id: krId, okrId, okr: { organizationId: orgId } },
    include: { okr: { select: { id: true, level: true, ownerId: true, departmentId: true, repeat: true } } },
  });
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; krId: string }> },
) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;
  const { id: okrId, krId } = await params;
  const orgId = getOrgId(session);

  const kr = await findScopedKeyResult(okrId, krId, orgId);
  if (!kr) return jsonError("Key Result not found", 404);

  // Editing a KR is a WRITE on the objective, owner / tree-manager /
  // org-wide only.
  const denied = await goalEditDenial(session, kr.okr);
  if (denied) return jsonError(denied.error, denied.status);

  const body = await req.json().catch(() => null);
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) return jsonError("Invalid key result payload");
  const d = parsed.data;

  const link = await resolveKpiLink(d.kpiId, orgId);
  if (!link.ok) return jsonError(link.message);
  const nextKpiId = link.value === undefined ? kr.kpiId : link.value;
  const source = parseTargetSource(d.source);
  if (!source.ok) return jsonError(source.error, 400);

  const startValue = d.startValue ?? kr.startValue;
  const targetValue = d.targetValue ?? kr.targetValue;

  // A repeating goal (docs/plans/recurring-goals.md B5, B8): the number is
  // the period's, moved by a check-in, so a typed currentValue is a 409; an
  // edit of the target reaches the template and the CURRENT open period,
  // never a closed one; a weekly goal reads no KPI (C6).
  if (kr.okr.repeat) {
    if (d.currentValue !== undefined) return jsonError(CHECK_IN_INSTEAD, 409);
    if (nextKpiId && kr.okr.repeat === "WEEKLY") return jsonError(KPI_NEEDS_MONTHS, 400);
    const before = { title: kr.title, unit: kr.unit, startValue: kr.startValue, targetValue: kr.targetValue };
    const after = { title: d.title !== undefined ? d.title.trim() : kr.title, unit: d.unit !== undefined ? d.unit ?? null : kr.unit, startValue, targetValue };
    const template = await prisma.keyResult.update({
      where: { id: kr.id },
      data: {
        title: after.title,
        unit: after.unit,
        startValue,
        targetValue,
        kpiId: nextKpiId,
        ...(d.periodStart !== undefined ? { periodStart: d.periodStart ?? null } : {}),
        ...(source.value !== undefined ? { source: source.value ?? Prisma.DbNull } : {}),
      },
      include: { kpi: { select: KR_KPI_SELECT } },
    });
    if (nextKpiId !== kr.kpiId) await recomputeOpenCloses(orgId, okrId);
    const changed = await applyTargetEditToPeriod({ orgId, okrId, keyResultId: kr.id, before, after });
    if (changed) logActivity({ type: "okr_updated", actorId: getUserId(session), organizationId: orgId, description: changed, targetId: okrId, targetType: "okr" });
    const fresh = await prisma.keyResult.findUnique({ where: { id: kr.id }, include: { kpi: { select: KR_KPI_SELECT } } });
    const [keyResult] = await enrichKeyResults([fresh ?? template], { userId: kr.okr.ownerId });
    const rollup = await persistGoalRollupChain(okrId);
    return jsonSuccess({ keyResult, currentValueIgnored: false, okr: rollup });
  }

  // Linked → the gauge is the truth; a hand-typed currentValue is ignored
  // and the stored one stays exactly as the owner last typed it.
  // Unlinked → apply the manual number and recompute progress.
  const currentValueIgnored = nextKpiId != null && d.currentValue !== undefined;
  const manualData =
    nextKpiId == null
      ? (() => {
          const currentValue = d.currentValue ?? kr.currentValue;
          return {
            currentValue,
            progress: keyResultProgress(
              startValue,
              targetValue,
              currentValue,
              inferKeyResultDirection({ startValue, targetValue }),
            ),
          };
        })()
      : {};

  const updated = await prisma.keyResult.update({
    where: { id: kr.id },
    data: {
      ...(d.title !== undefined && { title: d.title.trim() }),
      ...(d.unit !== undefined && { unit: d.unit ?? null }),
      startValue,
      targetValue,
      kpiId: nextKpiId,
      ...(d.periodStart !== undefined ? { periodStart: d.periodStart ?? null } : {}),
      ...(source.value !== undefined ? { source: source.value ?? Prisma.DbNull } : {}),
      ...manualData,
    },
    include: { kpi: { select: KR_KPI_SELECT } },
  });

  const [keyResult] = await enrichKeyResults([updated], { userId: kr.okr.ownerId });
  const rollup = await persistGoalRollupChain(okrId);

  return jsonSuccess({ keyResult, currentValueIgnored, okr: rollup });
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; krId: string }> },
) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;
  const { id: okrId, krId } = await params;
  const orgId = getOrgId(session);

  const kr = await findScopedKeyResult(okrId, krId, orgId);
  if (!kr) return jsonError("Key Result not found", 404);

  const denied = await goalEditDenial(session, kr.okr);
  if (denied) return jsonError(denied.error, denied.status);

  // A repeating goal (B5): its rows in OPEN and later periods go first, in
  // the same transaction; its rows in closed periods stay (keyResultId set
  // to null, the copied title and unit keep them readable), so past results
  // never change.
  if (kr.okr.repeat) await deleteRepeatingTarget(okrId, kr.id);
  else await prisma.keyResult.delete({ where: { id: kr.id } });

  // If that was the goal's LAST key result, it is no longer measured by
  // KRs. Clear the stored rollup number so the goal reads as "no measure
  // yet" instead of freezing at the last derived score, a goal that was
  // at 80% must not keep showing 80% with nothing left to back it. (A goal
  // whose progress was hand-set never had KRs, so this path never touches
  // it.) persistGoalRollupChain then propagates the empty state to ancestors.
  const remaining = await prisma.keyResult.count({ where: { okrId } });
  if (remaining === 0) {
    await prisma.oKR.update({
      where: { id: okrId },
      data: { progress: 0, status: "BEHIND" },
    });
  }
  const rollup = await persistGoalRollupChain(okrId);

  return jsonSuccess({ message: "Deleted", okr: rollup });
}
