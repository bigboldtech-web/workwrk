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
  type?: "rating" | "nps" | "text" | "single_choice" | "multi_choice" | "yes_no" | string;
  options?: string[];
}

interface Answer {
  questionId: string;
  value: string | number | string[];
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
    const valuesWithMeta: { value: string | number | string[]; createdAt: Date; user: any | null }[] = [];
    for (const r of responses) {
      const answers = Array.isArray(r.answers) ? (r.answers as any as Answer[]) : [];
      const match = answers.find((a) => a.questionId === q.id);
      const isEmpty =
        match === undefined ||
        match.value === undefined ||
        match.value === null ||
        match.value === "" ||
        (Array.isArray(match.value) && match.value.length === 0);
      if (!isEmpty) {
        valuesWithMeta.push({
          value: match!.value,
          createdAt: r.createdAt,
          user: (r as any).user ?? null,
        });
      }
    }

    if (q.type === "rating") return ratingSummary(q, valuesWithMeta as any, 1, 5);
    if (q.type === "nps") return ratingSummary(q, valuesWithMeta as any, 0, 10);
    if (q.type === "single_choice") return choiceSummary(q, valuesWithMeta, "single_choice", q.options || []);
    if (q.type === "multi_choice") return choiceSummary(q, valuesWithMeta, "multi_choice", q.options || []);
    if (q.type === "yes_no") return choiceSummary(q, valuesWithMeta, "yes_no", ["Yes", "No"]);

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

  // Top-line summary the UI can render without re-computing. npsScore is
  // standard: % promoters (9-10) minus % detractors (0-6), computed over
  // the first NPS question if the survey has one.
  const firstNps = perQuestion.find((p: any) => p.kind === "nps");
  const npsScore = firstNps && (firstNps as any).distribution
    ? computeNps((firstNps as any).distribution, (firstNps as any).totalAnswered)
    : null;

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
    summary: {
      npsScore,           // -100..+100, or null if no NPS question
      firstResponseAt: responses.length > 0 ? responses[responses.length - 1].createdAt : null,
      lastResponseAt: responses.length > 0 ? responses[0].createdAt : null,
    },
    filters: { officeId: officeId || null, departmentId: departmentId || null },
    questions: perQuestion,
  });
}

function computeNps(distribution: { value: number; count: number }[], total: number): number | null {
  if (!total) return null;
  let promoters = 0;
  let detractors = 0;
  for (const { value, count } of distribution) {
    if (value >= 9) promoters += count;
    else if (value <= 6) detractors += count;
  }
  return Math.round(((promoters - detractors) / total) * 100);
}

function choiceSummary(
  q: Question,
  valuesWithMeta: { value: string | number | string[]; createdAt: Date }[],
  kind: "single_choice" | "multi_choice" | "yes_no",
  declaredOptions: string[],
) {
  // Flatten every selected label from every respondent. multi_choice rows
  // carry an array; single_choice/yes_no carry a string.
  const picks: string[] = [];
  for (const { value } of valuesWithMeta) {
    if (Array.isArray(value)) picks.push(...value.map(String));
    else picks.push(String(value));
  }

  // Seed counts with declared options so options that got zero votes still
  // appear in the chart, then pick up any stray values respondents sent
  // that didn't match a declared option (rare, defensive).
  const counts = new Map<string, number>();
  for (const opt of declaredOptions) counts.set(opt, 0);
  for (const p of picks) counts.set(p, (counts.get(p) ?? 0) + 1);

  const options = Array.from(counts.entries()).map(([value, count]) => ({ value, count }));

  return {
    questionId: q.id,
    text: q.text,
    kind,
    totalAnswered: valuesWithMeta.length,
    options,
  };
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
