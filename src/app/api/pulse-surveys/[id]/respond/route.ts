import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionOrFail, getUserId, jsonError, jsonSuccess } from "@/lib/api-helpers";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;

  const { id: surveyId } = await params;
  const userId = getUserId(session);
  const { answers } = await req.json();

  if (!Array.isArray(answers)) return jsonError("answers required");

  const response = await prisma.surveyResponse.upsert({
    where: { surveyId_userId: { surveyId, userId } },
    create: { surveyId, userId, answers: answers as any },
    update: { answers: answers as any },
  });

  return jsonSuccess(response);
}
