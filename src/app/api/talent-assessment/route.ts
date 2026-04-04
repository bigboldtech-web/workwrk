import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionOrFail, getOrgId, getUserId, isManager, jsonError, jsonSuccess } from "@/lib/api-helpers";

export async function GET(req: NextRequest) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;
  if (!isManager(session)) return jsonError("Forbidden", 403);

  const orgId = getOrgId(session);
  const period = new URL(req.url).searchParams.get("period") || "";

  const where: any = { organizationId: orgId };
  if (period) where.period = period;

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

  return jsonSuccess(assessment);
}
