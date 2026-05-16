import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionOrFail, getOrgId, getUserId, isManager, jsonError, jsonSuccess } from "@/lib/api-helpers";
import { getTeamUserIds } from "@/lib/team";
import { logActivity } from "@/lib/activity";

export async function GET(req: NextRequest) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;
  if (!isManager(session)) return jsonError("Forbidden", 403);

  const orgId = getOrgId(session);
  const callerId = getUserId(session);
  const url = new URL(req.url);
  const period = url.searchParams.get("period") || "";
  const autoPlace = url.searchParams.get("auto") === "true";

  // Scope: org-wide for admins/execs/HR, team-only for line
  // managers. The talent grid is sensitive — line managers should
  // not see other managers' people.
  const callerLevel = (session.user as any).accessLevel as string;
  const orgWideRoles = new Set(["COMPANY_ADMIN", "SUPER_ADMIN", "C_LEVEL", "VP", "DIRECTOR", "HR"]);
  const isOrgWide = orgWideRoles.has(callerLevel);

  const where: any = { organizationId: orgId };
  if (period) where.period = period;
  if (!isOrgWide) {
    const teamIds = await getTeamUserIds(orgId, callerId);
    where.userId = { in: teamIds };
  }

  let assessments = await prisma.talentAssessment.findMany({
    where,
    orderBy: { createdAt: "desc" },
  });

  // Auto-place: generate assessments from performance scores for users not yet assessed
  if (autoPlace && period) {
    const assessedUserIds = new Set(assessments.map((a) => a.userId));
    const userScopeIds = isOrgWide
      ? null
      : await getTeamUserIds(orgId, callerId);
    const allUsers = await prisma.user.findMany({
      where: {
        organizationId: orgId,
        deletedAt: null,
        accessLevel: { not: "SUPER_ADMIN" },
        ...(userScopeIds ? { id: { in: userScopeIds } } : {}),
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
        assessedBy: getUserId(session),
        organizationId: orgId,
      });
    }

    if (newAssessments.length > 0) {
      // assessedUserIds already filtered; skipDuplicates guards against
      // concurrent auto-place runs hitting the unique constraint.
      await prisma.talentAssessment.createMany({ data: newAssessments, skipDuplicates: true });
      // Re-fetch after auto-placement
      assessments = await prisma.talentAssessment.findMany({ where, orderBy: { createdAt: "desc" } });
    }
  }

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

export async function POST(req: NextRequest) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;
  if (!isManager(session)) return jsonError("Forbidden", 403);

  const orgId = getOrgId(session);
  const assessedBy = getUserId(session);
  const body = await req.json();
  const { userId, period, performance, potential, action, notes } = body;

  if (!userId || !period || !performance || !potential) {
    return jsonError("userId, period, performance, and potential required");
  }

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
