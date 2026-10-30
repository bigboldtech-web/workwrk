// PATCH  /api/okrs/[id]/key-results/[krId], edit a key result, including
//         linking (kpiId, validated against the caller's org) or unlinking
//         (kpiId: null) a role-level KPI gauge.
// DELETE /api/okrs/[id]/key-results/[krId], remove the key result. On a
//         repeating goal, a 409 naming the last day while a period that
//         has ended but not closed still holds a row of it (B5, fixes
//         review M1): "October still takes numbers until 5 Nov, so this
//         target can't be deleted yet. Delete it after that."
//
// While a KR is linked, it is measured BY the gauge: a hand-typed
// currentValue is ignored (derived wins, `currentValueIgnored` in the
// response says so) and the stored hand-typed number is left untouched,
// so unlinking later restores exactly what the owner last typed. Nothing
// here ever writes a KPI or KPIRecord.
//
// A List or table source (docs/plans/recurring-goals.md C3, C5, C8, C10, H;
// only while RECURRING_GOALS is on): sent back unchanged it keeps its
// connector; a new one, or `reconnect`, is checked as the caller (Can view on
// its Lists or its table now, the Tables module on for a table) and the
// caller becomes its connector; then it counts at once, from the caller's
// one count budget (goal-count-limit.ts). The budget never refuses the save
// (fixes review L4): once it is spent, the target is saved uncounted
// (`countsLater` in the response) and the cron or the next page open counts
// it. An editor who cannot open a private source never receives its
// settings, so they can replace it but not send it back.
//
// A new KPI link reads the goal OWNER's KPI records: a caller who is not the
// owner links one only when they may read those (canTouchUserAlignment;
// final review, privacy L2), and a repeating goal takes one only once no
// weekly period runs or is still to come (kpiLinkRefusal, C6).

import { NextRequest } from "next/server";
import { goalEditDenial } from "@/lib/goal-audience";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getSessionOrFail, getOrgId, getUserId, jsonError, jsonSuccess } from "@/lib/api-helpers";
import { Prisma } from "@/generated/prisma";
import { logActivity } from "@/lib/activity";
import { canTouchUserAlignment } from "@/lib/alignment-scope";
import { applyTargetEditToPeriod, CHECK_IN_INSTEAD, deleteRepeatingTarget, GoalPeriodRefusal, kpiLinkRefusal, kpiOwnerDenied } from "@/lib/goals/goal-periods.server";
import { parseTargetSource } from "@/lib/goals/target-source";
import { recurringGoalsOn, RECURRING_GOALS_OFF } from "@/lib/goals/recurring-flag";
import { parseConnectedSource, sameConnectedSource } from "@/lib/goals/goal-source";
import { connectSourceProblem, refreshGoalSources } from "@/lib/goals/goal-source.server";
import { takeGoalCount } from "@/lib/goals/goal-count-limit";
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
  // Reconnect a paused List or table source as the caller (C10), after the same checks.
  reconnect: z.literal(true).optional(),
});

/** One thing measures a target: a KPI, a List or a table, never two (C2). */
const ONE_MEASURE = "A target is measured by one thing: check-ins, a List, a table or a KPI.";

async function findScopedKeyResult(okrId: string, krId: string, orgId: string) {
  return prisma.keyResult.findFirst({
    where: { id: krId, okrId, okr: { organizationId: orgId } },
    include: { okr: { select: { id: true, level: true, ownerId: true, departmentId: true, repeat: true, completedAt: true } } },
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
  const linksKpi = !!nextKpiId && nextKpiId !== kr.kpiId;
  if (linksKpi && kr.okr.ownerId && kr.okr.ownerId !== getUserId(session) && !(await canTouchUserAlignment(session, kr.okr.ownerId))) {
    // A KPI target reads the owner's KPI records: only for a caller who may read them, told who can link it.
    return jsonError(await kpiOwnerDenied(kr.okr.ownerId), 403);
  }
  const source = parseTargetSource(d.source);
  if (!source.ok) return jsonError(source.error, 400);
  // Reconnect moves a source to the caller: one of the doors the switch
  // closes (2.0), with or without a source in the body.
  if (d.reconnect && !recurringGoalsOn()) return jsonError(RECURRING_GOALS_OFF, 400);

  // A List or table source (C3, C5, C8, H, C10): sent back unchanged it
  // keeps its connector; a new one, or Reconnect, is checked as the caller
  // (Can view on its Lists or its table now), who becomes its connector.
  // Clearing it, or a KPI, drops the connector.
  const stored = parseConnectedSource(kr.source);
  const wanted = source.connected ?? (source.value === undefined ? stored : null);
  if (d.reconnect && !wanted) return jsonError("Only a target counted from a List or a table can be reconnected.", 400);
  if (wanted && nextKpiId) return jsonError(ONE_MEASURE, 400);
  const takesOver = !!wanted && (!!d.reconnect || (!!source.connected && !sameConnectedSource(kr.source, source.value)));
  if (takesOver && wanted) {
    const problem = await connectSourceProblem(orgId, getUserId(session), wanted);
    if (problem) return jsonError(problem, 400);
  }
  const connectorData = takesOver
    ? { sourceById: getUserId(session), sourcePausedReason: null, sourceRefreshedAt: null }
    : source.value !== undefined && !source.connected
      ? { sourceById: null, sourcePausedReason: null }
      : {};

  const startValue = d.startValue ?? kr.startValue;
  const targetValue = d.targetValue ?? kr.targetValue;

  // A repeating goal (docs/plans/recurring-goals.md B5, B8): the number is
  // the period's, moved by a check-in, so a typed currentValue is a 409; an
  // edit of the target reaches the template and the CURRENT open period,
  // never a closed one; a week reads no KPI (C6), nor does a goal whose
  // weekly periods still run.
  if (kr.okr.repeat) {
    if (d.currentValue !== undefined) return jsonError(CHECK_IN_INSTEAD, 409);
    const weeks = nextKpiId && (linksKpi || kr.okr.repeat === "WEEKLY") ? await kpiLinkRefusal(orgId, kr.okr) : null;
    if (weeks) return jsonError(weeks, 400);
    const before = { title: kr.title, unit: kr.unit, startValue: kr.startValue, targetValue: kr.targetValue, kpiId: kr.kpiId };
    const after = { title: d.title !== undefined ? d.title.trim() : kr.title, unit: d.unit !== undefined ? d.unit ?? null : kr.unit, startValue, targetValue, kpiId: nextKpiId };
    const template = await prisma.keyResult.update({
      where: { id: kr.id },
      data: {
        title: after.title,
        unit: after.unit,
        startValue,
        targetValue,
        kpiId: nextKpiId,
        ...(d.periodStart !== undefined ? { periodStart: d.periodStart ?? null } : {}),
        ...(source.value !== undefined ? { source: (source.value as Prisma.InputJsonValue | null) ?? Prisma.DbNull } : {}),
        ...connectorData,
      },
      include: { kpi: { select: KR_KPI_SELECT } },
    });
    // The period running now follows the edit (its KPI link too); one that
    // has ended keeps what it was opened with. The close holds follow.
    const changed = await applyTargetEditToPeriod({ orgId, okrId, keyResultId: kr.id, before, after, ownerId: kr.okr.ownerId });
    if (changed) logActivity({ type: "okr_updated", actorId: getUserId(session), organizationId: orgId, description: changed, targetId: okrId, targetType: "okr" });
    const countsLater = await countTakenOver(orgId, kr.id, takesOver, getUserId(session));
    const fresh = await prisma.keyResult.findUnique({ where: { id: kr.id }, include: { kpi: { select: KR_KPI_SELECT } } });
    const [keyResult] = await enrichKeyResults([fresh ?? template], { userId: kr.okr.ownerId });
    const rollup = await persistGoalRollupChain(okrId);
    return jsonSuccess({ keyResult, currentValueIgnored: false, okr: rollup, countsLater });
  }

  // Linked → the gauge is the truth; a hand-typed currentValue is ignored
  // and the stored one stays exactly as the owner last typed it.
  // Unlinked → apply the manual number and recompute progress.
  // A List or table source is the truth the same way (C2): its count, never a typed number.
  const currentValueIgnored = (nextKpiId != null || !!wanted) && d.currentValue !== undefined;
  const manualData =
    nextKpiId == null && !wanted
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
      ...(source.value !== undefined ? { source: (source.value as Prisma.InputJsonValue | null) ?? Prisma.DbNull } : {}),
      ...connectorData,
      ...manualData,
    },
    include: { kpi: { select: KR_KPI_SELECT } },
  });
  const countsLater = await countTakenOver(orgId, kr.id, takesOver, getUserId(session));
  const counted = takesOver && !countsLater ? await prisma.keyResult.findUnique({ where: { id: kr.id }, include: { kpi: { select: KR_KPI_SELECT } } }) : null;

  const [keyResult] = await enrichKeyResults([counted ?? updated], { userId: kr.okr.ownerId });
  const rollup = await persistGoalRollupChain(okrId);

  return jsonSuccess({ keyResult, currentValueIgnored, okr: rollup, countsLater });
}

/**
 * A source taken over counts at once, from the caller's one count budget.
 * Once that is spent the save still stands, uncounted, and the cron or the
 * next page open counts it (fixes review L4). True when it was left for later.
 */
async function countTakenOver(orgId: string, keyResultId: string, takesOver: boolean, userId: string): Promise<boolean> {
  if (!takesOver) return false;
  if (!takeGoalCount(userId)) return true;
  await countNow(orgId, keyResultId);
  return false;
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

  // A repeating goal (B5): refused while a period that has ended but not
  // closed still holds a row of it (409 with the day, fixes review M1);
  // otherwise its rows in OPEN and later periods go first, in the same
  // transaction, and its rows in closed periods stay (keyResultId set to
  // null, the copied title and unit keep them readable), so past results
  // never change.
  if (kr.okr.repeat) {
    try {
      await deleteRepeatingTarget(orgId, okrId, kr.id);
    } catch (e) {
      if (e instanceof GoalPeriodRefusal) return jsonError(e.message, e.status);
      throw e;
    }
  } else await prisma.keyResult.delete({ where: { id: kr.id } });

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

/** Count a newly connected (or reconnected) List or table source now; a failure leaves it for the next refresh. */
async function countNow(orgId: string, keyResultId: string): Promise<void> {
  try {
    await refreshGoalSources(orgId, { keyResultIds: [keyResultId], force: true, sharedReads: true });
  } catch (e) {
    console.error("[key-results] counting a connected source failed; the next refresh counts it:", e instanceof Error ? e.message : e);
  }
}
