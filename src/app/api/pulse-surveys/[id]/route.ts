// /api/pulse-surveys/[id]: one survey (spec-teams-performance /surveys/[id]).
//
// GET     the survey and the viewer's own answers, with the facts the page
//         renders from (never inferred from a role on the client):
//         canSeeResults, canManage, inAudience, hasResponded, anonymous,
//         questionsLocked. Counts and the audience ids go to runners only.
//         Not in the audience and not a runner: 404 (a survey is never
//         confirmed to someone it was not sent to).
// PATCH   runners only (the creator, the People team, Admin):
//           Draft   title, questions, audience, anonymity, repeat, close date
//           Open    title and the close date (Change close date), never the
//                   questions or anonymity once anyone has answered
//           status  Draft to Open (launch, notifies), Open to Closed,
//                   Closed to Open (reopen: the close date must be ahead)
// DELETE  a survey nobody has answered (a Draft, in practice), never by an
//         Agent. Answers are user data and are never deleted from here:
//         close the survey instead.

import { NextRequest } from "next/server";
import { Prisma } from "@/generated/prisma";
import { prisma } from "@/lib/prisma";
import { getSessionOrFail, getOrgId, jsonError, jsonSuccess } from "@/lib/api-helpers";
import { surveyQuestionsLocked } from "@/lib/people/survey-audience";
import { audienceLabel, audienceUserWhere, notifySurveyAudience, surveyCtx, surveyFaces } from "@/lib/performance/survey.server";
import { cleanSurveyQuestions, surveyTransitionBlocked } from "@/lib/performance/survey";
import { logActivity } from "@/lib/activity";

const AUDIENCE_TYPES = new Set(["ALL", "OFFICES", "DEPARTMENTS", "USERS", "TAGS"]);
const VALID_FREQUENCIES = new Set(["WEEKLY", "BIWEEKLY", "MONTHLY", "QUARTERLY"]);

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;
  const ctx = await surveyCtx(session);
  if (!ctx) return jsonError("Not found", 404);
  const orgId = getOrgId(session);
  const { id } = await params;

  const survey = await prisma.pulseSurvey.findFirst({ where: { id, organizationId: orgId } });
  if (!survey) return jsonError("Not found", 404);
  const myResponse = await prisma.surveyResponse.findUnique({ where: { surveyId_userId: { surveyId: id, userId: ctx.userId } }, select: { answers: true, createdAt: true } });
  const faces = surveyFaces(ctx, survey, !!myResponse);
  if (!faces.visible || (survey.status === "DRAFT" && !faces.canManage)) return jsonError("Not found", 404);

  const totalResponses = await prisma.surveyResponse.count({ where: { surveyId: id } });
  const audienceSize = faces.canManage ? await prisma.user.count({ where: await audienceUserWhere(orgId, survey) }) : null;

  return jsonSuccess({
    survey: {
      id: survey.id,
      title: survey.title,
      questions: survey.questions,
      status: survey.status,
      anonymous: survey.anonymous,
      audienceType: survey.audienceType,
      audience: faces.canManage ? await audienceLabel(orgId, survey) : undefined,
      officeIds: faces.canManage ? survey.officeIds : undefined,
      departmentIds: faces.canManage ? survey.departmentIds : undefined,
      userIds: faces.canManage ? survey.userIds : undefined,
      tagIds: faces.canManage ? survey.tagIds : undefined,
      frequency: survey.frequency,
      closesAt: survey.closesAt,
      closedAt: survey.closedAt,
      createdAt: survey.createdAt,
    },
    viewer: {
      inAudience: faces.inAudience,
      canRespond: faces.canRespond,
      hasResponded: faces.hasResponded,
      canManage: faces.canManage,
      canSeeResults: faces.canSeeResults,
      canDelete: faces.canManage && !ctx.isAgent && totalResponses === 0,
      canExport: faces.canSeeResults && !ctx.isAgent && totalResponses > 0,
      questionsLocked: surveyQuestionsLocked(totalResponses) || survey.status !== "DRAFT",
      // Legacy name, read by older clients.
      isManager: faces.canManage,
    },
    myAnswers: myResponse ? myResponse.answers : null,
    answeredAt: myResponse?.createdAt ?? null,
    stats: faces.canManage
      ? { audienceSize, totalResponses, responseRate: audienceSize && audienceSize > 0 ? Math.round((totalResponses / audienceSize) * 100) : 0 }
      : null,
  });
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;
  const ctx = await surveyCtx(session);
  if (!ctx) return jsonError("Not found", 404);
  const orgId = getOrgId(session);
  const { id } = await params;

  const existing = await prisma.pulseSurvey.findFirst({ where: { id, organizationId: orgId }, include: { _count: { select: { responses: true } } } });
  if (!existing) return jsonError("Not found", 404);
  const faces = surveyFaces(ctx, existing, false);
  if (!faces.canManage) return jsonError(faces.visible ? "Only the person who made this survey, the People team or an Admin can change it" : "Not found", faces.visible ? 403 : 404);

  const body = ((await req.json().catch(() => null)) ?? {}) as Record<string, unknown>;
  const data: Prisma.PulseSurveyUpdateInput = {};
  const answered = existing._count.responses > 0;
  const draft = existing.status === "DRAFT";

  if (typeof body.title === "string") {
    const t = body.title.trim().slice(0, 200);
    if (!t) return jsonError("Give the survey a title");
    data.title = t;
  }

  if (body.questions !== undefined) {
    const cleaned = cleanSurveyQuestions(body.questions);
    if (!cleaned.ok) return jsonError(cleaned.error);
    const changed = JSON.stringify(cleaned.questions) !== JSON.stringify(existing.questions);
    if (changed && (answered || !draft)) {
      return jsonError(answered ? "People have already answered this survey, so its questions can no longer change" : "An open survey's questions are fixed. Change the close date instead.", 409);
    }
    if (changed) data.questions = cleaned.questions as unknown as Prisma.InputJsonValue;
  }

  if (typeof body.anonymous === "boolean" && body.anonymous !== existing.anonymous) {
    // A promise of anonymity is never withdrawn after people answered under it.
    if (answered || !draft) return jsonError("Whether the survey is anonymous is fixed once it opens", 409);
    data.anonymous = body.anonymous;
  }

  if (body.frequency !== undefined) {
    if (!draft) return jsonError("Repeating is set before the survey opens", 409);
    data.frequency = typeof body.frequency === "string" && VALID_FREQUENCIES.has(body.frequency) ? body.frequency : null;
  }

  let closesChanged = false;
  if (body.closesAt !== undefined) {
    // A closed survey takes a new close date only as part of Reopen (status
    // ACTIVE in the same call): every survey the rotate cron closed has a
    // past close date, and Reopen sends a new one or none.
    if (existing.status === "CLOSED" && body.status !== "ACTIVE") return jsonError("Reopen the survey to change when it closes", 409);
    if (body.closesAt === null || body.closesAt === "") {
      data.closesAt = null;
      data.reminderSentAt = null;
    } else {
      const d = new Date(String(body.closesAt));
      if (isNaN(d.getTime())) return jsonError("Invalid close date");
      if (d.getTime() <= Date.now()) return jsonError("Close date must be in the future");
      data.closesAt = d;
      data.reminderSentAt = null;
    }
    closesChanged = true;
  }

  if (typeof body.audienceType === "string") {
    if (!draft) return jsonError("Who a survey goes to is fixed once it opens", 409);
    if (!AUDIENCE_TYPES.has(body.audienceType)) return jsonError("Invalid audience");
    const list = (v: unknown) => (Array.isArray(v) ? [...new Set(v.filter((x): x is string => typeof x === "string" && x.length > 0))] : []);
    const t = body.audienceType;
    const officeIds = t === "OFFICES" ? list(body.officeIds) : [];
    const departmentIds = t === "DEPARTMENTS" ? list(body.departmentIds) : [];
    const userIds = t === "USERS" ? list(body.userIds) : [];
    const tagIds = t === "TAGS" ? list(body.tagIds) : [];
    if (t === "OFFICES" && !officeIds.length) return jsonError("Pick at least one office");
    if (t === "DEPARTMENTS" && !departmentIds.length) return jsonError("Pick at least one department");
    if (t === "USERS" && !userIds.length) return jsonError("Pick at least one person");
    if (t === "TAGS" && !tagIds.length) return jsonError("Pick at least one tag");
    if (officeIds.length && (await prisma.office.count({ where: { id: { in: officeIds }, organizationId: orgId } })) !== officeIds.length) return jsonError("One or more offices invalid");
    if (departmentIds.length && (await prisma.department.count({ where: { id: { in: departmentIds }, organizationId: orgId } })) !== departmentIds.length) return jsonError("One or more departments invalid");
    if (userIds.length && (await prisma.user.count({ where: { id: { in: userIds }, organizationId: orgId, deletedAt: null } })) !== userIds.length) return jsonError("One or more people invalid");
    if (tagIds.length && (await prisma.tag.count({ where: { id: { in: tagIds }, organizationId: orgId, archived: false } })) !== tagIds.length) return jsonError("One or more tags invalid");
    Object.assign(data, { audienceType: t, officeIds, departmentIds, userIds, tagIds });
  }

  let launched = false;
  if (typeof body.status === "string" && body.status !== existing.status) {
    const blocked = surveyTransitionBlocked(existing.status, body.status);
    if (blocked) return jsonError(blocked, 409);
    if (body.status === "ACTIVE") {
      const closes = data.closesAt !== undefined ? (data.closesAt as Date | null) : existing.closesAt;
      if (closes && new Date(closes).getTime() <= Date.now()) return jsonError("Pick a close date in the future first", 409);
      data.status = "ACTIVE";
      data.closedAt = null;
      launched = existing.status === "DRAFT";
    } else if (body.status === "CLOSED") {
      data.status = "CLOSED";
      data.closedAt = new Date();
    }
  }

  const updated = await prisma.pulseSurvey.update({ where: { id }, data });
  if (launched) notifySurveyAudience(updated, orgId, { excludeUserId: undefined }).catch((e) => console.error("[Survey] notify failed:", e));
  if (closesChanged && body.remind === true && updated.status === "ACTIVE") {
    await notifySurveyAudience(updated, orgId, { onlyUnanswered: true });
  }
  if (data.status || closesChanged) {
    logActivity({
      type: "survey.update",
      actorId: ctx.userId,
      organizationId: orgId,
      description: data.status ? `${launched ? "Launched" : data.status === "CLOSED" ? "Closed" : "Reopened"} survey: ${updated.title}` : `Changed when ${updated.title} closes`,
      targetId: id,
      targetType: "survey",
      metadata: { from: existing.status, to: updated.status, closesAt: updated.closesAt?.toISOString() ?? null },
    });
  }
  return jsonSuccess(updated);
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;
  const ctx = await surveyCtx(session);
  if (!ctx) return jsonError("Not found", 404);
  const orgId = getOrgId(session);
  const { id } = await params;
  const existing = await prisma.pulseSurvey.findFirst({ where: { id, organizationId: orgId }, include: { _count: { select: { responses: true } } } });
  if (!existing) return jsonError("Not found", 404);
  const faces = surveyFaces(ctx, existing, false);
  if (!faces.canManage || ctx.isAgent) return jsonError(faces.visible ? "Forbidden" : "Not found", faces.visible ? 403 : 404);
  if (existing._count.responses > 0) return jsonError("People have answered this survey, so it cannot be deleted. Close it instead.", 409);
  await prisma.pulseSurvey.delete({ where: { id } });
  logActivity({ type: "survey.delete", actorId: ctx.userId, organizationId: orgId, description: `Deleted survey: ${existing.title}`, targetId: id, targetType: "survey" });
  return jsonSuccess({ message: "Deleted" });
}
