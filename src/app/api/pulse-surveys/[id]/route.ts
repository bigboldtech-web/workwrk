import { NextRequest } from "next/server";
import { Prisma } from "@/generated/prisma";
import { prisma } from "@/lib/prisma";
import { getSessionOrFail, getOrgId, getUserId, isManager, jsonError, jsonSuccess } from "@/lib/api-helpers";

const AUDIENCE_TYPES = new Set(["ALL", "OFFICES", "DEPARTMENTS", "USERS"]);
const STATUSES = new Set(["DRAFT", "ACTIVE", "CLOSED"]);
const VALID_FREQUENCIES = new Set(["WEEKLY", "BIWEEKLY", "MONTHLY", "QUARTERLY"]);

/**
 * Single-survey load for the respond / results detail page.
 *
 * Org-scoped (organizationId filter — no cross-org id resolution) and
 * authorized: only a member in the survey's audience, or a manager, may
 * read it. Returns the questions + the caller's OWN prior answers (for
 * editing) — never anyone else's response and never a respondent roster,
 * so the anonymity promise on an anonymous survey holds here too.
 */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;

  const orgId = getOrgId(session);
  const userId = getUserId(session);
  const { id } = await params;

  const survey = await prisma.pulseSurvey.findFirst({
    where: { id, organizationId: orgId },
  });
  if (!survey) return jsonError("Survey not found", 404);

  const viewer = await prisma.user.findUnique({
    where: { id: userId },
    select: { officeId: true, departmentId: true },
  });
  const manager = isManager(session);

  const inAudience =
    survey.audienceType === "ALL" ? true :
    survey.audienceType === "OFFICES" ? (!!viewer?.officeId && survey.officeIds.includes(viewer.officeId)) :
    survey.audienceType === "DEPARTMENTS" ? (!!viewer?.departmentId && survey.departmentIds.includes(viewer.departmentId)) :
    survey.audienceType === "USERS" ? survey.userIds.includes(userId) :
    false;

  // Only the audience or a manager may see a survey's contents.
  if (!inAudience && !manager) return jsonError("You don't have access to this survey", 403);

  let audienceSize: number;
  if (survey.audienceType === "ALL") {
    audienceSize = await prisma.user.count({ where: { organizationId: orgId, deletedAt: null } });
  } else {
    const where: Prisma.UserWhereInput = { organizationId: orgId, deletedAt: null };
    if (survey.audienceType === "OFFICES") where.officeId = { in: survey.officeIds };
    if (survey.audienceType === "DEPARTMENTS") where.departmentId = { in: survey.departmentIds };
    if (survey.audienceType === "USERS") where.id = { in: survey.userIds };
    audienceSize = await prisma.user.count({ where });
  }

  const totalResponses = await prisma.surveyResponse.count({ where: { surveyId: id } });
  const myResponse = await prisma.surveyResponse.findUnique({
    where: { surveyId_userId: { surveyId: id, userId } },
    select: { answers: true },
  });

  return jsonSuccess({
    survey: {
      id: survey.id,
      title: survey.title,
      questions: survey.questions,
      status: survey.status,
      anonymous: survey.anonymous,
      audienceType: survey.audienceType,
      // Audience-target ids are only needed by the manager-only editor;
      // don't hand org-targeting metadata to rank-and-file respondents.
      officeIds: manager ? survey.officeIds : undefined,
      departmentIds: manager ? survey.departmentIds : undefined,
      frequency: survey.frequency,
      closesAt: survey.closesAt,
      closedAt: survey.closedAt,
      createdAt: survey.createdAt,
    },
    viewer: { inAudience, isManager: manager, hasResponded: !!myResponse },
    myAnswers: myResponse ? myResponse.answers : null,
    stats: {
      audienceSize,
      totalResponses,
      responseRate: audienceSize > 0 ? Math.round((totalResponses / audienceSize) * 100) : 0,
    },
  });
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;
  if (!isManager(session)) return jsonError("Forbidden", 403);

  const orgId = getOrgId(session);
  const { id } = await params;

  const existing = await prisma.pulseSurvey.findFirst({
    where: { id, organizationId: orgId },
    select: { id: true },
  });
  if (!existing) return jsonError("Survey not found", 404);

  const body = await req.json();
  const data: Prisma.PulseSurveyUpdateInput = {};

  if (typeof body.title === "string" && body.title.trim()) data.title = body.title.trim();

  if (Array.isArray(body.questions)) {
    const cleaned = (body.questions as unknown[]).filter((q) => {
      if (!q || typeof q !== "object") return false;
      const text = (q as { text?: unknown }).text;
      return typeof text === "string" && text.trim().length > 0;
    });
    if (cleaned.length === 0) return jsonError("At least one question is required");
    data.questions = cleaned as Prisma.InputJsonValue;
  }

  if (typeof body.frequency === "string" || body.frequency === null) {
    const next = typeof body.frequency === "string" && VALID_FREQUENCIES.has(body.frequency) ? body.frequency : null;
    data.frequency = next;
  }

  if (typeof body.anonymous === "boolean") {
    data.anonymous = body.anonymous;
  }

  if (body.closesAt !== undefined) {
    if (body.closesAt === null || body.closesAt === "") {
      data.closesAt = null;
      // Clearing the close date also clears any reminder-sent bookmark
      // so the next run with a new close date gets its own reminder.
      data.reminderSentAt = null;
    } else {
      const d = new Date(body.closesAt);
      if (isNaN(d.getTime())) return jsonError("Invalid close date");
      if (d.getTime() <= Date.now()) return jsonError("Close date must be in the future");
      data.closesAt = d;
      data.reminderSentAt = null;
    }
  }

  if (typeof body.status === "string") {
    if (!STATUSES.has(body.status)) return jsonError("Invalid status");
    data.status = body.status;
    data.closedAt = body.status === "CLOSED" ? new Date() : null;
  }

  if (typeof body.audienceType === "string") {
    if (!AUDIENCE_TYPES.has(body.audienceType)) return jsonError("Invalid audienceType");
    data.audienceType = body.audienceType;

    const officeIds = body.audienceType === "OFFICES" && Array.isArray(body.officeIds)
      ? body.officeIds.filter((x: unknown) => typeof x === "string") : [];
    const departmentIds = body.audienceType === "DEPARTMENTS" && Array.isArray(body.departmentIds)
      ? body.departmentIds.filter((x: unknown) => typeof x === "string") : [];
    const userIds = body.audienceType === "USERS" && Array.isArray(body.userIds)
      ? body.userIds.filter((x: unknown) => typeof x === "string") : [];

    if (body.audienceType === "OFFICES" && officeIds.length === 0) return jsonError("Pick at least one office");
    if (body.audienceType === "DEPARTMENTS" && departmentIds.length === 0) return jsonError("Pick at least one department");
    if (body.audienceType === "USERS" && userIds.length === 0) return jsonError("Pick at least one user");

    if (officeIds.length > 0) {
      const valid = await prisma.office.findMany({ where: { id: { in: officeIds }, organizationId: orgId }, select: { id: true } });
      if (valid.length !== officeIds.length) return jsonError("One or more offices invalid");
    }
    if (departmentIds.length > 0) {
      const valid = await prisma.department.findMany({ where: { id: { in: departmentIds }, organizationId: orgId }, select: { id: true } });
      if (valid.length !== departmentIds.length) return jsonError("One or more departments invalid");
    }
    if (userIds.length > 0) {
      const valid = await prisma.user.findMany({ where: { id: { in: userIds }, organizationId: orgId, deletedAt: null }, select: { id: true } });
      if (valid.length !== userIds.length) return jsonError("One or more users invalid");
    }

    data.officeIds = officeIds;
    data.departmentIds = departmentIds;
    data.userIds = userIds;
  }

  const updated = await prisma.pulseSurvey.update({ where: { id }, data });
  return jsonSuccess(updated);
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;
  if (!isManager(session)) return jsonError("Forbidden", 403);

  const orgId = getOrgId(session);
  const { id } = await params;

  const existing = await prisma.pulseSurvey.findFirst({
    where: { id, organizationId: orgId },
    select: { id: true },
  });
  if (!existing) return jsonError("Survey not found", 404);

  // Responses cascade via schema (onDelete: Cascade on SurveyResponse.survey)
  await prisma.pulseSurvey.delete({ where: { id } });
  return jsonSuccess({ message: "Deleted" });
}
