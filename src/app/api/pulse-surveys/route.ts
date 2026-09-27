// /api/pulse-surveys: surveys (spec-teams-performance /surveys).
//
// GET ?view=answer (default) | all | closed  &page=&limit=
//      answer  the Open surveys the viewer is in the audience of, with
//              hasResponded. NO response counts or rates: an employee's
//              surveys page holds only surveys and the word Answer.
//      all     Draft and Open surveys the viewer runs (the People team and
//              Admin: every survey), with audience size, responses and rate
//      closed  the same for Closed surveys
//      Asking for all or closed without running surveys returns the answer
//      view flagged `downgraded`, so the page can say why.
// POST { title, questions, status: "DRAFT" | "ACTIVE", audienceType, ids,
//      anonymous, frequency, closesAt }: Save as draft, or Publish (which
//      notifies the audience with a link to the survey itself).

import { NextRequest } from "next/server";
import type { Prisma } from "@/generated/prisma";
import { prisma } from "@/lib/prisma";
import { getSessionOrFail, getOrgId, getUserId, jsonError, jsonSuccess } from "@/lib/api-helpers";
import { cultureOrganiserFromSession } from "@/lib/people/culture-gate";
import { audienceLabel, audienceUserWhere, notifySurveyAudience, surveyCtx, surveyFaces } from "@/lib/performance/survey.server";
import { cleanSurveyQuestions } from "@/lib/performance/survey";
import { surveyOpenNow } from "@/lib/people/survey-audience";

const AUDIENCE_TYPES = new Set(["ALL", "OFFICES", "DEPARTMENTS", "USERS", "TAGS"]);
const VALID_FREQUENCIES = new Set(["WEEKLY", "BIWEEKLY", "MONTHLY", "QUARTERLY"]);

export async function GET(req: NextRequest) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;
  const ctx = await surveyCtx(session);
  if (!ctx) return jsonError("Not found", 404);
  const orgId = getOrgId(session);
  const sp = new URL(req.url).searchParams;
  const runs = await cultureOrganiserFromSession(session);
  const asked = sp.get("view");
  const downgraded = (asked === "all" || asked === "closed") && !runs;
  const view = downgraded ? "answer" : asked === "all" || asked === "closed" ? asked : "answer";
  const page = Math.max(1, Number(sp.get("page") ?? "1") || 1);
  const limit = Math.min(100, Math.max(1, Number(sp.get("limit") ?? "40") || 40));

  const where: Prisma.PulseSurveyWhereInput = {
    organizationId: orgId,
    status: view === "answer" ? "ACTIVE" : view === "closed" ? "CLOSED" : { in: ["DRAFT", "ACTIVE"] },
  };
  const all = await prisma.pulseSurvey.findMany({
    where,
    include: { responses: { where: { userId: ctx.userId }, select: { id: true } }, _count: { select: { responses: true } } },
    orderBy: view === "closed" ? { closedAt: "desc" } : { createdAt: "desc" },
  });
  const now = new Date();
  const mine = all.filter((s) => {
    const f = surveyFaces(ctx, s, s.responses.length > 0);
    return view === "answer" ? f.inAudience && surveyOpenNow(s, now) : f.canManage;
  });
  const total = mine.length;
  const pageRows = mine.slice((page - 1) * limit, page * limit);

  const data = await Promise.all(pageRows.map(async (s) => {
    const base = {
      id: s.id,
      title: s.title,
      status: s.status,
      anonymous: s.anonymous,
      questionCount: Array.isArray(s.questions) ? s.questions.length : 0,
      closesAt: s.closesAt,
      closedAt: s.closedAt,
      createdAt: s.createdAt,
      frequency: s.frequency,
      hasResponded: s.responses.length > 0,
    };
    if (view === "answer") return base;
    const size = await prisma.user.count({ where: await audienceUserWhere(orgId, s) });
    return {
      ...base,
      audienceType: s.audienceType,
      audience: await audienceLabel(orgId, s),
      audienceSize: size,
      totalResponses: s._count.responses,
      responseRate: size > 0 ? Math.round((s._count.responses / size) * 100) : 0,
    };
  }));

  return jsonSuccess({ data, view, downgraded, canRun: runs, pagination: { total, page, limit, hasMore: page * limit < total } });
}

export async function POST(req: NextRequest) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;
  if (!(await cultureOrganiserFromSession(session))) return jsonError("Forbidden", 403);

  const orgId = getOrgId(session);
  const body = ((await req.json().catch(() => null)) ?? {}) as Record<string, unknown>;
  const title = typeof body.title === "string" ? body.title.trim().slice(0, 200) : "";
  if (!title) return jsonError("Give the survey a title");
  const cleaned = cleanSurveyQuestions(body.questions);
  if (!cleaned.ok) return jsonError(cleaned.error);
  const status = body.status === "DRAFT" ? "DRAFT" : "ACTIVE";

  let resolvedClosesAt: Date | null = null;
  if (body.closesAt) {
    const d = new Date(String(body.closesAt));
    if (isNaN(d.getTime())) return jsonError("Invalid close date");
    if (d.getTime() <= Date.now()) return jsonError("Close date must be in the future");
    resolvedClosesAt = d;
  }
  const resolvedFrequency = typeof body.frequency === "string" && VALID_FREQUENCIES.has(body.frequency) ? body.frequency : null;
  if (resolvedFrequency && !resolvedClosesAt) return jsonError("A repeating survey needs a close date so we know when to start the next one");

  const audienceType = typeof body.audienceType === "string" && AUDIENCE_TYPES.has(body.audienceType) ? body.audienceType : "ALL";
  const list = (v: unknown) => (Array.isArray(v) ? [...new Set(v.filter((x): x is string => typeof x === "string" && x.length > 0))] : []);
  const officeIds = audienceType === "OFFICES" ? list(body.officeIds) : [];
  const departmentIds = audienceType === "DEPARTMENTS" ? list(body.departmentIds) : [];
  const userIds = audienceType === "USERS" ? list(body.userIds) : [];
  const tagIds = audienceType === "TAGS" ? list(body.tagIds) : [];
  if (audienceType === "OFFICES" && !officeIds.length) return jsonError("Pick at least one office");
  if (audienceType === "DEPARTMENTS" && !departmentIds.length) return jsonError("Pick at least one department");
  if (audienceType === "USERS" && !userIds.length) return jsonError("Pick at least one person");
  if (audienceType === "TAGS" && !tagIds.length) return jsonError("Pick at least one tag");
  if (officeIds.length && (await prisma.office.count({ where: { id: { in: officeIds }, organizationId: orgId } })) !== officeIds.length) return jsonError("One or more offices invalid", 400);
  if (departmentIds.length && (await prisma.department.count({ where: { id: { in: departmentIds }, organizationId: orgId } })) !== departmentIds.length) return jsonError("One or more departments invalid", 400);
  if (userIds.length && (await prisma.user.count({ where: { id: { in: userIds }, organizationId: orgId, deletedAt: null } })) !== userIds.length) return jsonError("One or more people invalid", 400);
  if (tagIds.length && (await prisma.tag.count({ where: { id: { in: tagIds }, organizationId: orgId, archived: false } })) !== tagIds.length) return jsonError("One or more tags invalid", 400);

  const survey = await prisma.pulseSurvey.create({
    data: {
      title,
      questions: cleaned.questions as unknown as Prisma.InputJsonValue,
      frequency: resolvedFrequency,
      status,
      audienceType,
      officeIds,
      departmentIds,
      userIds,
      tagIds,
      anonymous: body.anonymous === false ? false : true,
      closesAt: resolvedClosesAt,
      organizationId: orgId,
      createdById: getUserId(session),
    },
  });

  if (status === "ACTIVE") {
    notifySurveyAudience(survey, orgId).catch((e) => console.error("[Survey] notify failed:", e));
  }
  return jsonSuccess(survey, 201);
}
