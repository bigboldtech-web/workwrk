import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionOrFail, getOrgId, getUserId, isManager, jsonError, jsonSuccess } from "@/lib/api-helpers";
import { isOrgAdminLevel } from "@/lib/alignment-scope";
import { getTeamUserIds } from "@/lib/team";
import {
  computeGoalRollups,
  enrichKeyResults,
  goalRollupFor,
  KR_KPI_SELECT,
  persistGoalRollupChain,
} from "@/lib/alignment";
import { canSeeGoal, summarizeGoalAudiences } from "@/lib/goal-audience";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;
  const { id } = await params;
  const okr = await prisma.oKR.findFirst({
    where: { id, organizationId: getOrgId(session) },
    include: {
      keyResults: {
        include: {
          checkIns: { orderBy: { createdAt: "desc" }, take: 5 },
          kpi: { select: KR_KPI_SELECT },
        },
      },
      children: { select: { id: true, title: true, progress: true, level: true } },
    },
  });
  if (!okr) return jsonError("Not found", 404);
  // Visibility: own it, be a resolved audience member, manage someone who
  // is, or COMPANY level — see src/lib/goal-audience.ts.
  if (!(await canSeeGoal(session, okr))) return jsonError("Not found", 404);

  // KRs linked to a KPI read the gauge's latest number (read-side
  // derivation); the goal's progress/status roll up through the shared
  // org-wide goal graph (live KRs + measured children) — the same
  // computeGoalRollups every other surface reads, so this endpoint can
  // never disagree with the list, the dashboard, or the profile hero.
  const orgId = getOrgId(session);
  const [keyResults, audiences, rollupCtx] = await Promise.all([
    enrichKeyResults(okr.keyResults, { userId: okr.ownerId }),
    summarizeGoalAudiences(orgId, [{ id: okr.id, ownerId: okr.ownerId }]),
    computeGoalRollups(orgId),
  ]);
  const rollup = goalRollupFor(rollupCtx, okr);
  return jsonSuccess({
    ...okr,
    keyResults,
    progress: rollup.progress,
    status: rollup.status,
    progressSource: rollup.source,
    children: okr.children.map((c) => {
      const childRoll = goalRollupFor(rollupCtx, { ...c, status: "" });
      return { ...c, progress: childRoll.progress, progressSource: childRoll.source };
    }),
    audience: audiences.get(okr.id),
  });
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;
  const { id } = await params;
  const okr = await prisma.oKR.findFirst({ where: { id, organizationId: getOrgId(session) } });
  if (!okr) return jsonError("Not found", 404);

  // Deleting a goal is owner / tree-manager / org-admin territory —
  // a peer can never remove someone else's objective.
  const callerId = getUserId(session);
  let canDelete = isOrgAdminLevel(session) || okr.ownerId === callerId;
  if (!canDelete && isManager(session)) {
    canDelete = okr.ownerId
      ? (await getTeamUserIds(getOrgId(session), callerId)).includes(okr.ownerId)
      : true;
  }
  if (!canDelete) {
    return jsonError("You can only delete your own goals or your reports' goals.", 403);
  }

  await prisma.oKR.delete({ where: { id } });
  // The parent (and its ancestors) just lost a contributor — re-derive
  // their stored progress so no surface keeps quoting the old number.
  if (okr.parentId) {
    await persistGoalRollupChain(okr.parentId);
  }
  return jsonSuccess({ message: "Deleted" });
}
