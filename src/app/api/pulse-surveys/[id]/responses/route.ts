import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionOrFail, getOrgId, isManager, jsonError, jsonSuccess } from "@/lib/api-helpers";

/**
 * Manager-only aggregate view of a pulse survey's responses.
 *
 * Query params:
 *   officeId        — narrow to respondents in this office
 *   departmentId    — narrow to respondents in this department
 *
 * Returned shape:
 *   - `survey` — metadata including `anonymous`.
 *   - `totalResponses` — count after filters.
 *   - `questions[]` — one entry per question:
 *       · rating/nps → distribution, average, total answered, daily trend
 *       · text       → list of responses (each with respondent info when
 *         survey.anonymous === false; otherwise just the text).
 *
 * Privacy contract:
 *   Attribution is returned only when `survey.anonymous === false`. The
 *   creator of the survey explicitly opts into attribution at create/edit
 *   time — we never back-door it.
 */

interface Question {
  id: string;
  text: string;
  type?: "rating" | "nps" | "text" | string;
}

interface Answer {
  questionId: string;
  value: string | number;
}

const DAY_MS = 24 * 60 * 60 * 1000;

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;
  if (!isManager(session)) return jsonError("Forbidden", 403);

  const { id } = await params;
  const orgId = getOrgId(session);
  const url = new URL(req.url);
  const officeId = url.searchParams.get("officeId");
  const departmentId = url.searchParams.get("departmentId");

  const survey = await prisma.pulseSurvey.findFirst({
    where: { id, organizationId: orgId },
    select: {
      id: true, title: true, questions: true, status: true,
      createdAt: true, closedAt: true, anonymous: true,
    },
  });
  if (!survey) return jsonError("Survey not found", 404);

  // Build the response filter. We need to join SurveyResponse → User so
  // we can scope by office/department.
  const responseWhere: any = { surveyId: id };
  if (officeId || departmentId) {
    const userFilter: any = { organizationId: orgId, deletedAt: null };
    if (officeId) userFilter.officeId = officeId;
    if (departmentId) userFilter.departmentId = departmentId;
    responseWhere.user = userFilter;
  }

  const includeUser = survey.anonymous === false;
  const responses = await prisma.surveyResponse.findMany({
    where: responseWhere,
    select: {
      answers: true,
      createdAt: true,
      ...(includeUser
        ? {
            user: {
              select: {
                id: true, firstName: true, lastName: true,
                office: { select: { id: true, name: true } },
                department: { select: { id: true, name: true } },
              },
            },
          }
        : {}),
    },
    orderBy: { createdAt: "desc" },
  });

  const questions: Question[] = Array.isArray(survey.questions) ? (survey.questions as any as Question[]) : [];

  const perQuestion = questions.map((q) => {
    const valuesWithMeta: { value: string | number; createdAt: Date; user: any | null }[] = [];
    for (const r of responses) {
      const answers = Array.isArray(r.answers) ? (r.answers as any as Answer[]) : [];
      const match = answers.find((a) => a.questionId === q.id);
      if (match && match.value !== undefined && match.value !== null && match.value !== "") {
        valuesWithMeta.push({
          value: match.value,
          createdAt: r.createdAt,
          user: (r as any).user ?? null,
        });
      }
    }

    if (q.type === "rating") return ratingSummary(q, valuesWithMeta, 1, 5);
    if (q.type === "nps") return ratingSummary(q, valuesWithMeta, 0, 10);

    return {
      questionId: q.id,
      text: q.text,
      kind: "text" as const,
      totalAnswered: valuesWithMeta.length,
      responses: valuesWithMeta.map((v) => ({
        value: String(v.value),
        createdAt: v.createdAt,
        respondent: includeUser && v.user
          ? { id: v.user.id, name: `${v.user.firstName} ${v.user.lastName}`, office: v.user.office, department: v.user.department }
          : null,
      })),
    };
  });

  return jsonSuccess({
    survey: {
      id: survey.id,
      title: survey.title,
      status: survey.status,
      createdAt: survey.createdAt,
      closedAt: survey.closedAt,
      anonymous: survey.anonymous,
    },
    totalResponses: responses.length,
    filters: { officeId: officeId || null, departmentId: departmentId || null },
    questions: perQuestion,
  });
}

function ratingSummary(
  q: Question,
  valuesWithMeta: { value: string | number; createdAt: Date }[],
  min: number,
  max: number,
) {
  const numbers = valuesWithMeta
    .map((v) => ({ n: typeof v.value === "number" ? v.value : parseFloat(String(v.value)), at: v.createdAt }))
    .filter(({ n }) => !isNaN(n) && n >= min && n <= max);

  const distribution: { value: number; count: number }[] = [];
  for (let v = min; v <= max; v++) {
    distribution.push({ value: v, count: numbers.filter(({ n }) => Math.round(n) === v).length });
  }

  const average = numbers.length > 0
    ? Math.round((numbers.reduce((s, { n }) => s + n, 0) / numbers.length) * 10) / 10
    : null;

  // Daily trend — one bucket per calendar day that had ≥1 response. Keeps
  // output small even for long-running surveys.
  const dayKey = (d: Date) => d.toISOString().slice(0, 10);
  const byDay = new Map<string, number[]>();
  for (const { n, at } of numbers) {
    const k = dayKey(at);
    const list = byDay.get(k) ?? [];
    list.push(n);
    byDay.set(k, list);
  }
  const trend = Array.from(byDay.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, vals]) => ({
      date,
      average: Math.round((vals.reduce((s, n) => s + n, 0) / vals.length) * 10) / 10,
      count: vals.length,
    }));

  return {
    questionId: q.id,
    text: q.text,
    kind: q.type as "rating" | "nps",
    totalAnswered: numbers.length,
    min,
    max,
    average,
    distribution,
    trend,
  };
}
