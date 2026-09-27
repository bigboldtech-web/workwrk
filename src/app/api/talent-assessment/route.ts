import type { Prisma } from "@/generated/prisma";
import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionOrFail, getOrgId, getUserId, jsonError, jsonSuccess } from "@/lib/api-helpers";
import { logActivity } from "@/lib/activity";
import { chainOf, isPeopleTeamOrAdmin } from "@/lib/people/review-cycle-access";

/**
 * Who may read and place on the 9-box, and over whom (Phase 6): the page's
 * own rule (the `talent` APP_RULES row), so page and data always agree. The
 * People team, Owner and Admin see the org; anyone with reports sees their
 * reporting chain (solid plus dotted, the engine's tree); nobody else sees
 * anything, whatever their legacy access level (a legacy org-wide level with
 * no reports is not given the org's placements: an Admin adds them to the
 * People team if they should be). NEVER THEMSELF (DECIDED: a person does
 * not see their own placement), whoever they are.
 */
async function talentScope(session: Parameters<typeof getOrgId>[0]): Promise<{ allowed: boolean; ids: string[] | null }> {
  const callerId = getUserId(session);
  if (await isPeopleTeamOrAdmin(session)) return { allowed: true, ids: null };
  const chain = (await chainOf(callerId)).filter((id) => id !== callerId);
  return { allowed: chain.length > 0, ids: chain };
}

export async function GET(req: NextRequest) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;
  const scope = await talentScope(session);
  if (!scope.allowed) return jsonError("Forbidden", 403);

  const orgId = getOrgId(session);
  const callerId = getUserId(session);
  const url = new URL(req.url);
  const period = url.searchParams.get("period") || "";
  // A GET never writes (PO-22): the old ?auto=true seeded placements from
  // a read. Auto-place is POST { autoPlace: true, period } now.

  // Scope (talentScope above): the org or the caller's tree, never the
  // caller's own placement.
  const where: any = { organizationId: orgId };
  if (period) where.period = period;
  where.userId = scope.ids === null ? { not: callerId } : { in: scope.ids };

  const assessments = await prisma.talentAssessment.findMany({
    where,
    orderBy: { createdAt: "desc" },
  });


  // Get user details
  const userIds = [...new Set(assessments.map((a) => a.userId))];
  const users = userIds.length > 0 ? await prisma.user.findMany({
    where: { id: { in: userIds } },
    select: { id: true, firstName: true, lastName: true, avatar: true, department: { select: { name: true } }, role: { select: { title: true } } },
  }) : [];
  const userMap = new Map(users.map((u) => [u.id, u]));

  return jsonSuccess(assessments.map((a) => ({
    ...a,
    user: userMap.get(a.userId) || null,
  })));
}


/**
 * Auto-place: one placement per person in scope who has no placement for
 * the period and has a performance score, mapping the score to a box
 * (performance from the score, potential medium until someone decides).
 * Never overwrites a placement a person made, never the caller. Returns the
 * number placed.
 */
async function autoPlaceFromScores(
  session: Parameters<typeof getOrgId>[0],
  scope: { ids: string[] | null },
  period: string,
): Promise<number> {
  const orgId = getOrgId(session);
  const callerId = getUserId(session);
  const isOrgWide = scope.ids === null;
  const where: Prisma.TalentAssessmentWhereInput = {
    organizationId: orgId,
    period,
    userId: scope.ids === null ? { not: callerId } : { in: scope.ids },
  };
  const assessments = await prisma.talentAssessment.findMany({ where, select: { userId: true } });
  {
    const assessedUserIds = new Set(assessments.map((a) => a.userId));
    const userScopeIds = isOrgWide ? null : scope.ids;
    const allUsers = await prisma.user.findMany({
      where: {
        organizationId: orgId,
        deletedAt: null,
        accessLevel: { not: "SUPER_ADMIN" },
        // Never the caller: nobody places themself, automatically or not.
        ...(userScopeIds ? { id: { in: userScopeIds } } : { id: { not: callerId } }),
      },
      select: { id: true },
    });

    // Get KPI scores for the period or latest
    const kpiPeriod = period.replace(/Q(\d) (\d{4})/, (_, q, y) => {
      const month = (parseInt(q) - 1) * 3 + 1;
      return `${y}-${String(month).padStart(2, "0")}`;
    });

    const performanceScores = await prisma.performanceScore.findMany({
      where: { organizationId: orgId },
      orderBy: { period: "desc" },
      distinct: ["userId"],
    });
    const scoreMap = new Map(performanceScores.map((s) => [s.userId, s.score]));

    const newAssessments: any[] = [];
    for (const user of allUsers) {
      if (assessedUserIds.has(user.id)) continue;
      const score = scoreMap.get(user.id);
      if (score == null) continue;

      // Map score to performance: 0-50 = Low(1), 50-80 = Medium(2), 80+ = High(3)
      const performance = score >= 80 ? 3 : score >= 50 ? 2 : 1;
      // Default potential to medium (can be manually adjusted)
      const potential = 2;
      const boxPosition = `${performance}-${potential}`;

      newAssessments.push({
        userId: user.id,
        period,
        performance,
        potential,
        boxPosition,
        action: null,
        notes: "Auto-placed from performance score",
        // Phase 6: where the placement came from, so the grid can say so.
        source: "SCORES",
        assessedBy: getUserId(session),
        organizationId: orgId,
      });
    }

    if (newAssessments.length > 0) {
      // assessedUserIds already filtered; skipDuplicates guards against
      // concurrent auto-place runs hitting the unique constraint.
      const r = await prisma.talentAssessment.createMany({ data: newAssessments, skipDuplicates: true });
      return r.count;
    }
    return newAssessments.length;
  }
}

export async function POST(req: NextRequest) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;
  const scope = await talentScope(session);
  if (!scope.allowed) return jsonError("Forbidden", 403);

  const orgId = getOrgId(session);
  const assessedBy = getUserId(session);
  const body = await req.json();
  const { userId, period, performance, potential, action, notes } = body;

  // Auto-place (a write, so a POST): { autoPlace: true, period }.
  if (body?.autoPlace === true) {
    if (typeof period !== "string" || !period.trim()) return jsonError("period required");
    const placed = await autoPlaceFromScores(session, scope, period.trim());
    if (placed > 0) {
      logActivity({
        type: "talent_assessment_auto_placed",
        actorId: assessedBy,
        organizationId: orgId,
        description: `Auto-placed ${placed} people from performance scores for ${period.trim()}`,
        targetType: "talent_assessment",
        metadata: { period: period.trim(), placed },
      });
    }
    return jsonSuccess({ placed, period: period.trim() });
  }

  if (!userId || !period || !performance || !potential) {
    return jsonError("userId, period, performance, and potential required");
  }
  // Performance and potential are the grid's 1 to 3 axes, nothing else.
  if (![1, 2, 3].includes(performance) || ![1, 2, 3].includes(potential)) {
    return jsonError("performance and potential must each be 1, 2 or 3");
  }
  // Only people the caller may place: in their scope, in this org, and never
  // themself (the route used to place anyone, the caller included).
  if (userId === assessedBy) return jsonError("You can't place yourself on the grid", 403);
  if (scope.ids !== null && !scope.ids.includes(userId)) return jsonError("Not found", 404);
  const target = await prisma.user.findFirst({ where: { id: userId, organizationId: orgId, deletedAt: null }, select: { id: true } });
  if (!target) return jsonError("Not found", 404);

  const boxPosition = `${performance}-${potential}`;

  const assessment = await prisma.talentAssessment.upsert({
    where: { userId_period_organizationId: { userId, period, organizationId: orgId } },
    create: { userId, period, performance, potential, boxPosition, action, notes, assessedBy, organizationId: orgId },
    update: { performance, potential, boxPosition, action, notes, assessedBy },
  });

  logActivity({
    type: "talent_assessment_upserted",
    actorId: assessedBy,
    organizationId: orgId,
    description: `Placed person in ${boxPosition} for ${period}${action ? ` (action: ${action})` : ""}`,
    targetId: assessment.id,
    targetType: "talent_assessment",
    metadata: { userId, period, performance, potential, boxPosition, action: action || null },
  });

  return jsonSuccess(assessment);
}
