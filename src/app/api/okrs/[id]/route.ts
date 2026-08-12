import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionOrFail, getOrgId, getUserId, isManager, jsonError, jsonSuccess } from "@/lib/api-helpers";
import { isOrgAdminLevel } from "@/lib/alignment-scope";
import { getTeamUserIds } from "@/lib/team";
import { enrichKeyResults, KR_KPI_SELECT, rollUpOkrProgress } from "@/lib/alignment";
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

  // KRs linked to a KPI read the gauge's latest number (read-side derivation);
  // objective progress rolls up from those live values.
  const orgId = getOrgId(session);
  const [keyResults, audiences] = await Promise.all([
    enrichKeyResults(okr.keyResults, { userId: okr.ownerId }),
    summarizeGoalAudiences(orgId, [{ id: okr.id, ownerId: okr.ownerId }]),
  ]);
  const rolled = rollUpOkrProgress(keyResults);
  return jsonSuccess({ ...okr, keyResults, progress: rolled ?? okr.progress, audience: audiences.get(okr.id) });
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
  return jsonSuccess({ message: "Deleted" });
}
