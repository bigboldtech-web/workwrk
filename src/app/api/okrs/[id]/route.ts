import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionOrFail, getOrgId, jsonError, jsonSuccess } from "@/lib/api-helpers";
import { canDeleteGoal, canEditGoal } from "@/lib/alignment-scope";
import {
  computeGoalRollups,
  enrichKeyResults,
  goalRollupFor,
  KR_KPI_SELECT,
  persistGoalRollupChain,
} from "@/lib/alignment";
import { canSeeGoal, summarizeGoalAudiences } from "@/lib/goal-audience";
import { GOAL_DELETE_REFUSED } from "@/lib/goals/goal-rights";
import { currentPeriodPayload, orgPeriodSettings, settleOnRead } from "@/lib/goals/goal-periods.server";
import { periodView, repeatEditFacts } from "@/lib/goals/goal-period-view.server";
import { recurringGoalsOn } from "@/lib/goals/recurring-flag";
import { pauseWordsFor } from "@/lib/goals/goal-source";

const PERIOD_KEY = /^\d{4}-\d{2}-\d{2}$/;

// GET ?period=<key>: a repeating goal's period as the goal page shows it
// (docs/plans/recurring-goals.md E2, I): `periodView` carries that period's
// dates, state, progress, result and targets; an unknown key is a 404. With
// no ?period= it is the period shown for now. ?edit=1 adds what the Edit
// modal needs (`repeatEdit`: the current period, whether Starts may move,
// the conversion's numbers), for the goal's editors only.
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;
  const { id } = await params;
  const sp = new URL(req.url).searchParams;
  const askedPeriod = sp.get("period");
  if (askedPeriod !== null && !PERIOD_KEY.test(askedPeriod)) return jsonError("period must be a period key (yyyy-mm-dd).", 400);
  // A repeating goal opens any period it is missing first (docs/plans/recurring-goals.md B3).
  const repeating = await prisma.oKR.findFirst({ where: { id, organizationId: getOrgId(session), repeat: { not: null } }, select: { id: true } });
  if (repeating) await settleOnRead(getOrgId(session), [id], "the goal route");
  const okr = await prisma.oKR.findFirst({
    where: { id, organizationId: getOrgId(session) },
    include: {
      keyResults: {
        include: {
          checkIns: { orderBy: { createdAt: "desc" }, take: 5 },
          kpi: { select: KR_KPI_SELECT },
        },
      },
      children: { select: { id: true, title: true, progress: true, level: true, ownerId: true, departmentId: true } },
    },
  });
  if (!okr) return jsonError("Not found", 404);
  // Visibility: own it, be a resolved audience member, manage someone who
  // is, or COMPANY level, see src/lib/goal-audience.ts.
  if (!(await canSeeGoal(session, okr))) return jsonError("Not found", 404);

  // KRs linked to a KPI read the gauge's latest number (read-side
  // derivation); the goal's progress/status roll up through the shared
  // org-wide goal graph (live KRs + measured children), the same
  // computeGoalRollups every other surface reads, so this endpoint can
  // never disagree with the list, the dashboard, or the profile hero.
  const orgId = getOrgId(session);
  const [keyResults, audiences, rollupCtx] = await Promise.all([
    enrichKeyResults(okr.keyResults, { userId: okr.ownerId }),
    summarizeGoalAudiences(orgId, [{ id: okr.id, ownerId: okr.ownerId }]),
    computeGoalRollups(orgId),
  ]);
  const rollup = goalRollupFor(rollupCtx, okr);
  // Only the goals under this one that the caller may open are named (the
  // goal page's rule): a Company goal is read by everyone, and must not list
  // the titles of Individual goals someone hung under it. The rest are
  // counted, since they still move this goal's progress.
  // A goal's editors see every goal under it: those goals move its number,
  // so its owner must be able to see and unlink them.
  const editor = await canEditGoal(session, okr);
  const visibleChildren = editor ? okr.children : (await Promise.all(okr.children.map(async (c) => ((await canSeeGoal(session, c)) ? c : null))))
    .filter((c): c is NonNullable<typeof c> => c !== null);
  const now = new Date();
  const settings = rollupCtx.periodSettings ?? (okr.repeat || sp.get("edit") === "1" ? await orgPeriodSettings(orgId) : null);
  const shown = okr.repeat && settings ? await periodView(rollupCtx, okr.id, askedPeriod, settings, now) : null;
  if (askedPeriod !== null && !shown) return jsonError("That period was not found.", 404);
  const repeatEdit = sp.get("edit") === "1" && editor && settings && (okr.repeat || recurringGoalsOn())
    ? await repeatEditFacts(okr, settings, now)
    : null;
  return jsonSuccess({
    ...okr,
    keyResults,
    progress: rollup.progress,
    status: rollup.status,
    progressSource: rollup.source,
    // Whether THIS viewer may delete the goal, same predicate the DELETE
    // handler enforces, surfaced so the client can show/hide its affordance.
    canDelete: await canDeleteGoal(session, okr),
    children: visibleChildren.map(({ ownerId: _o, departmentId: _d, ...c }) => {
      const childRoll = goalRollupFor(rollupCtx, { ...c, status: "" });
      return { ...c, progress: childRoll.progress, progressSource: childRoll.source };
    }),
    hiddenChildren: okr.children.length - visibleChildren.length,
    audience: audiences.get(okr.id),
    // A repeating goal's current period (I), or null.
    period: okr.repeat && rollupCtx.periodSettings ? currentPeriodPayload(rollupCtx.periods.get(okr.id) ?? [], rollupCtx.periodSettings, now) : null,
    // The period asked for (?period=), or the one shown for now. Why a
    // source paused is an editor's to read (C10).
    periodView: shown ? { ...shown, targets: shown.targets.map((t) => ({ ...t, pausedReason: pauseWordsFor(t.pausedReason, editor) })) } : null,
    recurringGoals: recurringGoalsOn(),
    ...(repeatEdit ? { repeatEdit } : {}),
  });
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;
  const { id } = await params;
  const okr = await prisma.oKR.findFirst({ where: { id, organizationId: getOrgId(session) } });
  if (!okr) return jsonError("Not found", 404);

  // A goal the caller cannot see answers exactly like a missing one, so a
  // refused delete never confirms that it exists.
  if (!(await canSeeGoal(session, okr))) return jsonError("Not found", 404);
  // mayDeleteGoal (src/lib/goals/goal-rights.ts): a peer, or a manager with
  // no tie to the goal, can never remove it, and a Company goal is only
  // removed by its owner or an Admin. Same predicate the list and detail
  // Delete controls gate on, so the UI never offers a Delete the API refuses.
  if (!(await canDeleteGoal(session, okr))) {
    return jsonError(GOAL_DELETE_REFUSED, 403);
  }

  // Key results, their check-ins, and the goal's audience rows all cascade
  // at the DB FK (KeyResult/KRCheckIn/GoalAssignee → onDelete: Cascade).
  // Any CHILD goals are re-homed to the top level automatically,
  // OKR.parentId is onDelete: SET NULL, so a parent delete never blocks on
  // its children and never leaves a dangling FK; the children survive as
  // roots. Their own numbers are unchanged (a child rolls up from its own
  // KRs/children, not its parent), so no child chain needs recomputing.
  await prisma.oKR.delete({ where: { id } });
  // The parent (and its ancestors) just lost a contributor, re-derive
  // their stored progress so no surface keeps quoting the old number.
  if (okr.parentId) {
    await persistGoalRollupChain(okr.parentId);
  }
  return jsonSuccess({ message: "Deleted" });
}
