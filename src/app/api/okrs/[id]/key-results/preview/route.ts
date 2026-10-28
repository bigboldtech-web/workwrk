// POST /api/okrs/[id]/key-results/preview: the target editor's live number
// for a List source (docs/plans/recurring-goals.md E3, I): "This month so
// far: 42 of 60". Counted AS THE PERSON EDITING (never stored), over the
// period running now on a repeating goal, or the goal's start to due date
// on a one-time goal, with the same engine the stored count uses
// (goal-source.server.ts countListSource).
//
// Only a goal editor (goalEditDenial, the key-results routes' gate), and
// only while RECURRING_GOALS is on (the switch closes the doors that connect
// a source, 2.0). Answers { value, listCount, paused, openToWorkspace }:
// `paused` is the reason the source could not be counted (the same words a
// stored source would pause with), and `openToWorkspace` false makes the
// editor say "Everyone who can see this goal will see this number." (C9).

import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionOrFail, getOrgId, getUserId, jsonError, jsonSuccess } from "@/lib/api-helpers";
import { goalEditDenial } from "@/lib/goal-audience";
import { recurringGoalsOn, RECURRING_GOALS_OFF } from "@/lib/goals/recurring-flag";
import { parseListSource, periodWindow, goalDatesWindow } from "@/lib/goals/goal-source";
import { connectSourceProblem, connectorFor, countListSource, sourceOpenToWorkspace } from "@/lib/goals/goal-source.server";
import { currentStoredPeriod, orgPeriodSettings, settleOnRead } from "@/lib/goals/goal-periods.server";
import { isGoalCadence, type GoalCadence } from "@/lib/goals/goal-period";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;
  if (!recurringGoalsOn()) return jsonError(RECURRING_GOALS_OFF, 400);
  const { id } = await params;
  const orgId = getOrgId(session);
  const okr = await prisma.oKR.findFirst({
    where: { id, organizationId: orgId },
    select: { id: true, level: true, ownerId: true, departmentId: true, repeat: true, startDate: true, endDate: true },
  });
  if (!okr) return jsonError("OKR not found", 404);
  const denied = await goalEditDenial(session, okr);
  if (denied) return jsonError(denied.error, denied.status);

  const body = (await req.json().catch(() => null)) as { source?: unknown } | null;
  const source = parseListSource(body?.source);
  if (!source) return jsonError("Choose where, what and how it is counted.", 400);
  const userId = getUserId(session);
  const problem = await connectSourceProblem(orgId, userId, source);
  if (problem) return jsonSuccess({ value: null, listCount: 0, paused: problem, openToWorkspace: true });

  const now = new Date();
  const settings = await orgPeriodSettings(orgId);
  let window = goalDatesWindow(okr.startDate, okr.endDate, settings.timezone);
  if (isGoalCadence(okr.repeat)) {
    await settleOnRead(orgId, [id], "the target preview", now);
    const periods = await prisma.goalPeriod.findMany({
      where: { okrId: id },
      select: { key: true, cadence: true, startsAt: true, endsAt: true, graceEndsAt: true, closesAt: true, trackedFrom: true, status: true },
    });
    const current = currentStoredPeriod(periods.filter((p) => isGoalCadence(p.cadence)).map((p) => ({ ...p, cadence: p.cadence as GoalCadence })), now);
    if (current) window = periodWindow(current, settings);
  }
  const conn = await connectorFor(orgId, userId);
  if (!conn.ok) return jsonSuccess({ value: null, listCount: 0, paused: conn.reason, openToWorkspace: true });
  const [outcome, open] = await Promise.all([
    countListSource({ orgId, source, connector: conn.connector, window, zone: settings.timezone, now }),
    sourceOpenToWorkspace(orgId, source),
  ]);
  if (outcome.kind === "paused") return jsonSuccess({ value: null, listCount: 0, paused: outcome.reason, openToWorkspace: open });
  return jsonSuccess({ value: outcome.kind === "counted" ? outcome.value : null, listCount: outcome.listCount, paused: null, openToWorkspace: open });
}
