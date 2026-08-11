import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionOrFail, getOrgId, getUserId, isManager, jsonError, jsonSuccess } from "@/lib/api-helpers";
import { isOrgAdminLevel, isOrgWideAlignment } from "@/lib/alignment-scope";
import { getTeamUserIds } from "@/lib/team";
import { enrichKeyResults, KR_KPI_SELECT, rollUpOkrProgress } from "@/lib/alignment";

/**
 * Three-door visibility for a single objective (mirrors GET /api/okrs):
 * COMPANY → everyone; own goal → always; TEAM → own department; manager →
 * report tree + unowned; admin / exec / HR → org-wide.
 */
async function canSeeOkr(
  session: unknown,
  okr: { level: string; ownerId: string | null; departmentId: string | null },
): Promise<boolean> {
  if (isOrgWideAlignment(session)) return true;
  const callerId = getUserId(session);
  if (okr.level === "COMPANY") return true;
  if (okr.ownerId === callerId) return true;
  if (okr.level === "TEAM" && okr.departmentId) {
    const me = await prisma.user.findUnique({
      where: { id: callerId },
      select: { departmentId: true },
    });
    if (me?.departmentId === okr.departmentId) return true;
  }
  if (isManager(session)) {
    if (!okr.ownerId) return true;
    const teamIds = await getTeamUserIds(getOrgId(session), callerId);
    return teamIds.includes(okr.ownerId);
  }
  return false;
}

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
  if (!(await canSeeOkr(session, okr))) return jsonError("Not found", 404);

  // KRs linked to a KPI read the gauge's latest number (read-side derivation);
  // objective progress rolls up from those live values.
  const keyResults = await enrichKeyResults(okr.keyResults, { userId: okr.ownerId });
  const rolled = rollUpOkrProgress(keyResults);
  return jsonSuccess({ ...okr, keyResults, progress: rolled ?? okr.progress });
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
