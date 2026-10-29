// POST /api/okrs/[id]/key-results/preview: the target editor's live number
// for a List or table source (docs/plans/recurring-goals.md E3, I): "This
// month so far: 42 of 60". Counted AS THE PERSON EDITING (never stored), over
// the period running now on a repeating goal, or the goal's start to due date
// on a one-time goal, with the same engine the stored count uses
// (goal-source.server.ts countSource: a table's formulas through the embed's
// engine path, TODAY() the workspace's day).
//
// Only a goal editor (goalEditDenial, the key-results routes' gate), and
// only while RECURRING_GOALS is on (the switch closes the doors that connect
// a source, 2.0), from the person's one count budget (goal-count-limit.ts:
// 30 a minute, shared with the first count of a saved source and Refresh).
// Answers { value, listCount, paused, openToWorkspace, errorRows }:
// `paused` is the reason the source could not be counted (the same words a
// stored source would pause with), `openToWorkspace` false makes the
// editor say "Everyone who can see this goal will see this number." (C9),
// and `errorRows` is how many table rows a formula error left out (the
// editor says "3 rows show an error and are left out.", C5). A table's read
// comes from the shared request cache (goal-source.server.ts), so a preview
// asked again, and the save after it, build its engine once.

import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionOrFail, getOrgId, getUserId, jsonError, jsonSuccess } from "@/lib/api-helpers";
import { goalEditDenial } from "@/lib/goal-audience";
import { recurringGoalsOn, RECURRING_GOALS_OFF } from "@/lib/goals/recurring-flag";
import { parseConnectedSource, periodWindow, goalDatesWindow } from "@/lib/goals/goal-source";
import { connectSourceProblem, connectorFor, countSource, sourceOpenToWorkspace } from "@/lib/goals/goal-source.server";
import { currentStoredPeriod, orgPeriodSettings, settleOnRead } from "@/lib/goals/goal-periods.server";
import { isGoalCadence, type GoalCadence } from "@/lib/goals/goal-period";
import { COUNTING_TOO_OFTEN, takeGoalCount } from "@/lib/goals/goal-count-limit";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;
  if (!recurringGoalsOn()) return jsonError(RECURRING_GOALS_OFF, 400);
  const { id } = await params;
  const orgId = getOrgId(session);
  const okr = await prisma.oKR.findFirst({
    where: { id, organizationId: orgId },
    select: { id: true, level: true, ownerId: true, departmentId: true, repeat: true, startDate: true, endDate: true, createdAt: true },
  });
  if (!okr) return jsonError("OKR not found", 404);
  const denied = await goalEditDenial(session, okr);
  if (denied) return jsonError(denied.error, denied.status);
  // Each preview is a full count as the caller, from their one count budget
  // (the editor asks once per settled change, 300ms after the last one).
  if (!takeGoalCount(getUserId(session))) return jsonError(COUNTING_TOO_OFTEN, 429);

  const body = (await req.json().catch(() => null)) as { source?: unknown } | null;
  const source = parseConnectedSource(body?.source);
  if (!source) return jsonError("Choose where, what and how it is counted.", 400);
  const userId = getUserId(session);
  const problem = await connectSourceProblem(orgId, userId, source);
  if (problem) return jsonSuccess({ value: null, listCount: 0, paused: problem, openToWorkspace: true, errorRows: 0 });

  const now = new Date();
  const settings = await orgPeriodSettings(orgId);
  let window = goalDatesWindow(okr.startDate, okr.endDate, settings.timezone, okr.createdAt);
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
  if (!conn.ok) return jsonSuccess({ value: null, listCount: 0, paused: conn.reason, openToWorkspace: true, errorRows: 0 });
  const outcome = await countSource({ orgId, source, connector: conn.connector, window, zone: settings.timezone, now });
  // Open to the workspace: the Space, Lists or table it names, and every List the count read (C9).
  const open = await sourceOpenToWorkspace(orgId, source, outcome.kind === "counted" ? outcome.listIds : []);
  if (outcome.kind === "paused") return jsonSuccess({ value: null, listCount: 0, paused: outcome.reason, openToWorkspace: open, errorRows: 0 });
  const counted = outcome.kind === "counted" ? outcome : null;
  return jsonSuccess({ value: counted ? counted.value : null, listCount: outcome.listCount, paused: null, openToWorkspace: open, errorRows: counted?.errorRows ?? 0 });
}
