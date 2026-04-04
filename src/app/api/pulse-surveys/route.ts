import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionOrFail, getOrgId, getUserId, isManager, jsonError, jsonSuccess } from "@/lib/api-helpers";

export async function GET() {
  const { error, session } = await getSessionOrFail();
  if (error) return error;

  const orgId = getOrgId(session);
  const userId = getUserId(session);

  const surveys = await prisma.pulseSurvey.findMany({
    where: { organizationId: orgId },
    include: {
      responses: { where: { userId }, select: { id: true } },
      _count: { select: { responses: true } },
    },
    orderBy: { createdAt: "desc" },
    take: 20,
  });

  const totalUsers = await prisma.user.count({ where: { organizationId: orgId, deletedAt: null } });

  return jsonSuccess(surveys.map((s) => ({
    ...s,
    hasResponded: s.responses.length > 0,
    responseRate: totalUsers > 0 ? Math.round((s._count.responses / totalUsers) * 100) : 0,
    totalResponses: s._count.responses,
    totalUsers,
  })));
}

export async function POST(req: NextRequest) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;
  if (!isManager(session)) return jsonError("Forbidden", 403);

  const orgId = getOrgId(session);
  const body = await req.json();
  const { title, questions, frequency } = body;

  if (!title?.trim() || !Array.isArray(questions) || questions.length === 0) {
    return jsonError("Title and questions required");
  }

  const survey = await prisma.pulseSurvey.create({
    data: {
      title: title.trim(),
      questions: questions as any,
      frequency: frequency || null,
      status: "ACTIVE",
      organizationId: orgId,
    },
  });

  return jsonSuccess(survey, 201);
}
