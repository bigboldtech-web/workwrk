import { NextRequest } from "next/server";
import { Prisma } from "@/generated/prisma";
import { prisma } from "@/lib/prisma";
import { getSessionOrFail, getOrgId, getUserId, jsonError, jsonSuccess } from "@/lib/api-helpers";
import { resolveUserIdsByTags } from "@/lib/user-tags";

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
    select: { audienceType: true, officeIds: true, departmentIds: true, userIds: true, tagIds: true, status: true },
  });
  if (!survey) return jsonError("Survey not found", 404);
  // Only an open (launched, not-yet-closed) survey accepts responses.
  if (survey.status === "CLOSED") return jsonError("Survey is closed", 400);
  if (survey.status !== "ACTIVE") return jsonError("Survey is not open for responses", 400);

  if (survey.audienceType !== "ALL") {
    const viewer = await prisma.user.findUnique({
      where: { id: userId },
      select: { officeId: true, departmentId: true },
    });
    const tagMatch =
      survey.audienceType === "TAGS"
        ? (await resolveUserIdsByTags(orgId, survey.tagIds)).includes(userId)
        : false;
    const inAudience =
      (survey.audienceType === "OFFICES" && !!viewer?.officeId && survey.officeIds.includes(viewer.officeId)) ||
      (survey.audienceType === "DEPARTMENTS" && !!viewer?.departmentId && survey.departmentIds.includes(viewer.departmentId)) ||
      (survey.audienceType === "USERS" && survey.userIds.includes(userId)) ||
      tagMatch;
    if (!inAudience) return jsonError("You're not in this survey's audience", 403);
  }

  const response = await prisma.surveyResponse.upsert({
    where: { surveyId_userId: { surveyId, userId } },
    create: { surveyId, userId, answers: answers as Prisma.InputJsonValue },
    update: { answers: answers as Prisma.InputJsonValue },
  });

  return jsonSuccess(response);
}
