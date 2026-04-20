import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionOrFail, getOrgId, getUserId, jsonError, jsonSuccess } from "@/lib/api-helpers";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;

  const { id: surveyId } = await params;
  const orgId = getOrgId(session);
  const userId = getUserId(session);
  const { answers } = await req.json();

  if (!Array.isArray(answers)) return jsonError("answers required");

  const survey = await prisma.pulseSurvey.findFirst({
    where: { id: surveyId, organizationId: orgId },
    select: { audienceType: true, officeIds: true, departmentIds: true, userIds: true, status: true },
  });
  if (!survey) return jsonError("Survey not found", 404);
  if (survey.status === "CLOSED") return jsonError("Survey is closed", 400);

  if (survey.audienceType !== "ALL") {
    const viewer = await prisma.user.findUnique({
      where: { id: userId },
      select: { officeId: true, departmentId: true },
    });
    const inAudience =
      (survey.audienceType === "OFFICES" && !!viewer?.officeId && survey.officeIds.includes(viewer.officeId)) ||
      (survey.audienceType === "DEPARTMENTS" && !!viewer?.departmentId && survey.departmentIds.includes(viewer.departmentId)) ||
      (survey.audienceType === "USERS" && survey.userIds.includes(userId));
    if (!inAudience) return jsonError("You're not in this survey's audience", 403);
  }

  const response = await prisma.surveyResponse.upsert({
    where: { surveyId_userId: { surveyId, userId } },
    create: { surveyId, userId, answers: answers as any },
    update: { answers: answers as any },
  });

  return jsonSuccess(response);
}
