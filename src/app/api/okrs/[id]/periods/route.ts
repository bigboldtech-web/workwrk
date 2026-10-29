// GET /api/okrs/[id]/periods?page=: a repeating goal's periods, 12 a page,
// newest first (docs/plans/recurring-goals.md I, E2). Each period carries
// its label and dates, where it stands (open, grace, closing, closed), its
// result and attainment once closed, and its targets' start, target, value,
// progress and pause. A target deleted later still shows in its closed
// periods (its copied title and unit, B5). Whoever can see the goal reads
// it (canSeeGoal, H). A one-time goal answers an empty list.
//
// ?closed=1: the goal page's Past periods card (E2): only the closed
// periods, newest first, 12 a page, each with its result, attainment and,
// for a period with one target, that target's numbers ("112 of 100").

import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionOrFail, getOrgId, jsonError, jsonSuccess } from "@/lib/api-helpers";
import { canSeeGoal } from "@/lib/goal-audience";
import { computeGoalRollups } from "@/lib/alignment";
import { isGoalCadence, nominalLastDayKey, periodLabel, RESULT_LABEL, type GoalCadence, type GoalResult } from "@/lib/goals/goal-period";
import { orgPeriodSettings, periodState, settleOnRead } from "@/lib/goals/goal-periods.server";
import { periodScore } from "@/lib/goals/period-rollup";
import { closedPeriodsPage } from "@/lib/goals/goal-period-view.server";
import { canEditGoal } from "@/lib/alignment-scope";
import { pauseWordsFor } from "@/lib/goals/goal-source";

const PAGE_SIZE = 12;

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;
  const { id } = await params;
  const orgId = getOrgId(session);
  const okr = await prisma.oKR.findFirst({
    where: { id, organizationId: orgId },
    select: { id: true, level: true, ownerId: true, departmentId: true, repeat: true },
  });
  if (!okr) return jsonError("Not found", 404);
  if (!(await canSeeGoal(session, okr))) return jsonError("Not found", 404);

  const page = Math.max(1, Number.parseInt(new URL(req.url).searchParams.get("page") ?? "1", 10) || 1);
  const now = new Date();
  if (okr.repeat) await settleOnRead(orgId, [id], "the periods route", now);
  if (new URL(req.url).searchParams.get("closed") === "1") {
    const past = await closedPeriodsPage(id, await orgPeriodSettings(orgId), page, now);
    return jsonSuccess({ data: past.rows, pagination: { page: past.page, pageSize: past.pageSize, total: past.total } });
  }

  // Why a source paused is an editor's to read (C10): everyone else reads "Paused".
  const editor = await canEditGoal(session, okr);
  const [total, rows, settings] = await Promise.all([
    prisma.goalPeriod.count({ where: { okrId: id } }),
    prisma.goalPeriod.findMany({
      where: { okrId: id },
      orderBy: { startsAt: "desc" },
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      select: {
        id: true, key: true, cadence: true, startsAt: true, endsAt: true, trackedFrom: true, graceEndsAt: true,
        closesAt: true, status: true, progress: true, attainment: true, result: true, scored: true, closedAt: true,
        targets: {
          orderBy: { createdAt: "asc" },
          select: {
            id: true, keyResultId: true, title: true, unit: true, startValue: true, targetValue: true,
            currentValue: true, progress: true, carried: true, frozenAt: true, pausedSince: true, pausedReason: true,
          },
        },
      },
    }),
    orgPeriodSettings(orgId),
  ]);

  // Open periods read their live numbers (KPI months, children) from the
  // same rollup every surface reads; closed ones read what froze.
  const anyOpen = rows.some((r) => r.status === "OPEN");
  const ctx = anyOpen ? await computeGoalRollups(orgId, now) : null;
  const live = new Map((ctx?.periods.get(id) ?? []).map((p) => [p.id, p]));

  const data = rows
    .filter((r) => isGoalCadence(r.cadence))
    .map((r) => {
      const range = { key: r.key, cadence: r.cadence as GoalCadence, startsAt: r.startsAt, endsAt: r.endsAt };
      const stored = live.get(r.id);
      const liveRows = new Map((stored?.rows ?? []).map((x) => [x.id, x]));
      const score = r.status === "OPEN" && stored && ctx?.periodGraph ? periodScore(id, stored, ctx.periodGraph) : { progress: r.progress, attainment: r.attainment };
      const result = r.result as GoalResult | null;
      return {
        key: r.key,
        label: periodLabel(range, settings, now),
        nominalLastDay: nominalLastDayKey(range, settings),
        startsAt: r.startsAt,
        endsAt: r.endsAt,
        trackedFrom: r.trackedFrom,
        graceEndsAt: r.graceEndsAt,
        closesAt: r.closesAt,
        state: periodState(r, now),
        progress: score.progress,
        attainment: score.attainment,
        result,
        resultLabel: result ? RESULT_LABEL[result] : null,
        scored: r.scored,
        closedAt: r.closedAt,
        targets: r.targets.map((t) => {
          const l = liveRows.get(t.id);
          return {
            id: t.id,
            keyResultId: t.keyResultId,
            title: t.title,
            unit: t.unit,
            startValue: t.startValue,
            targetValue: t.targetValue,
            currentValue: l ? l.currentValue : t.currentValue,
            progress: l ? l.progress : t.progress,
            carried: t.carried,
            frozen: t.frozenAt != null,
            pausedSince: t.pausedSince,
            pausedReason: pauseWordsFor(t.pausedReason, editor),
          };
        }),
      };
    });

  return jsonSuccess({ data, pagination: { page, pageSize: PAGE_SIZE, total } });
}
