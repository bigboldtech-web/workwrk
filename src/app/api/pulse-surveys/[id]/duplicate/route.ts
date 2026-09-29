// POST /api/pulse-surveys/[id]/duplicate -> the new survey
// Duplicate: the same questions, audience, anonymity and repeat as a new
// Draft owned by the person who duplicated it, with no answers and no close
// date. Runners of the original only.

import { NextRequest } from "next/server";
import type { Prisma } from "@/generated/prisma";
import { prisma } from "@/lib/prisma";
import { getSessionOrFail, getOrgId, jsonError, jsonSuccess } from "@/lib/api-helpers";
import { surveyCtx, surveyFaces } from "@/lib/performance/survey.server";

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;
  const ctx = await surveyCtx(session);
  if (!ctx) return jsonError("Not found", 404);
  const orgId = getOrgId(session);
  const { id } = await params;
  const s = await prisma.pulseSurvey.findFirst({ where: { id, organizationId: orgId } });
  if (!s) return jsonError("Not found", 404);
  const faces = surveyFaces(ctx, s, false);
  if (!faces.canManage) return jsonError(faces.visible ? "Forbidden" : "Not found", faces.visible ? 403 : 404);
  const copy = await prisma.pulseSurvey.create({
    data: {
      title: `${s.title} (copy)`.slice(0, 200),
      questions: s.questions as Prisma.InputJsonValue,
      frequency: s.frequency,
      status: "DRAFT",
      audienceType: s.audienceType,
      officeIds: s.officeIds,
      departmentIds: s.departmentIds,
      userIds: s.userIds,
      tagIds: s.tagIds,
      anonymous: s.anonymous,
      organizationId: orgId,
      createdById: ctx.userId,
    },
  });
  return jsonSuccess(copy, 201);
}
