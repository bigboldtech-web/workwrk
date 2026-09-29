// POST /api/pulse-surveys/[id]/reminders -> { notified }
// Send a reminder: an Inbox row and an email to the people in an Open
// survey's audience who have not answered, never anyone reminded in the last
// 12 hours. Runners only.

import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionOrFail, getOrgId, jsonError, jsonSuccess } from "@/lib/api-helpers";
import { notifySurveyAudience, surveyCtx, surveyFaces } from "@/lib/performance/survey.server";

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
  if (s.status !== "ACTIVE") return jsonError("Only an open survey sends reminders", 409);
  const notified = await notifySurveyAudience(s, orgId, { onlyUnanswered: true });
  return jsonSuccess({ notified });
}
