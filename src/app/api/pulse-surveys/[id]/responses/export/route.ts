import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import type { Prisma } from "@/generated/prisma";
import { getSessionOrFail, getOrgId, isManager, jsonError, getUserId } from "@/lib/api-helpers";
import { cultureOrganiserFromSession } from "@/lib/people/culture-gate";
import { isPeopleTeamOrAdmin } from "@/lib/people/review-cycle-access";
import { canManageSurvey } from "@/lib/people/survey-audience";
import { ANONYMITY_FLOOR, meetsAnonymityFloor, shuffled } from "@/lib/people/anonymity";
import { csvFormulaSafe } from "@/lib/csv";

/**
 * CSV export of all responses to a single pulse survey.
 *
 * Layout, one row per respondent, one column per question plus
 * `submitted_at` and (if the survey is non-anonymous) respondent/office/
 * department columns. Commas and quotes in answers are escaped per RFC
 * 4180 so Excel / Sheets ingest it cleanly.
 *
 * Same privacy contract as the aggregate endpoint: attribution columns
 * only appear when `survey.anonymous === false`. An anonymous survey
 * exports nothing below the four-answer floor (409). Above it, it is NOT
 * one row per person: that would link each person's answers across
 * questions (cross-tab on "Which team are you on?" and the segment filter
 * this route refuses is back). It is one row per answer, question then
 * answer, each question's answers shuffled on their own, and a question
 * answered by fewer than four people is exported as a single "Hidden" row,
 * the same per-question floor the results page applies. Accepts `officeId` and
 * `departmentId` query params so the export matches what the manager
 * sees in the filtered view.
 */

interface Question {
  id: string;
  text: string;
  type?: string;
}

interface Answer {
  questionId: string;
  value: string | number | string[];
}

// Flatten an answer value into a single CSV cell. Arrays (multi_choice
// selections) render as semicolon-joined so spreadsheet users can still
// split or count them.
function flattenValue(v: Answer["value"] | undefined | null): string {
  if (v === undefined || v === null) return "";
  if (Array.isArray(v)) return v.map(String).join("; ");
  return String(v);
}

function csvEscape(val: unknown): string {
  // csvFormulaSafe: answers are text other people typed (CSV injection).
  const s = csvFormulaSafe(val === null || val === undefined ? "" : String(val));
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;
  if (!(await cultureOrganiserFromSession(session))) return jsonError("Forbidden", 403);

  const { id } = await params;
  const orgId = getOrgId(session);
  const url = new URL(req.url);
  const officeId = url.searchParams.get("officeId");
  const departmentId = url.searchParams.get("departmentId");

  const survey = await prisma.pulseSurvey.findFirst({
    where: { id, organizationId: orgId },
    select: { id: true, title: true, questions: true, anonymous: true, createdById: true },
  });
  if (!survey) return jsonError("Survey not found", 404);
  // Results belong to the creator, the People team and Admin (the same rule
  // as the responses route).
  if (!canManageSurvey({
    callerId: getUserId(session),
    createdById: survey.createdById,
    peopleTeamOrAdmin: await isPeopleTeamOrAdmin(session),
    legacyManagerTier: isManager(session),
  })) return jsonError("Forbidden", 403);

  // Anonymity guard (mirrors the responses route): segment filters are a
  // de-anonymization vector, so they are honored only on non-anonymous
  // surveys and ignored entirely on anonymous ones.
  const includeUser = survey.anonymous === false;
  // SurveyResponse carries userId with no relation, so the person columns
  // (and the office or department filter) are read from User separately.
  // (The old select of a `user` relation that does not exist failed every
  // attributed export.)
  const responseWhere: Prisma.SurveyResponseWhereInput = { surveyId: id };
  if (includeUser && (officeId || departmentId)) {
    const userFilter: Prisma.UserWhereInput = { organizationId: orgId, deletedAt: null };
    if (officeId) userFilter.officeId = officeId;
    if (departmentId) userFilter.departmentId = departmentId;
    const inSegment = await prisma.user.findMany({ where: userFilter, select: { id: true } });
    responseWhere.userId = { in: inSegment.map((u) => u.id) };
  }
  const rawResponses = await prisma.surveyResponse.findMany({
    where: responseWhere,
    select: { createdAt: true, answers: true, userId: true },
    orderBy: { createdAt: "asc" },
  });
  type PersonCols = { firstName: string; lastName: string; email: string; office: { name: string } | null; department: { name: string } | null };
  const people = includeUser && rawResponses.length
    ? new Map((await prisma.user.findMany({
        where: { id: { in: rawResponses.map((r) => r.userId) }, organizationId: orgId },
        select: { id: true, firstName: true, lastName: true, email: true, office: { select: { name: true } }, department: { select: { name: true } } },
      })).map((u) => [u.id, u as PersonCols] as const))
    : new Map<string, PersonCols>();
  // An anonymous survey's rows never carry who answered past this point.
  const responses = rawResponses.map((r) => ({ createdAt: r.createdAt, answers: r.answers, user: includeUser ? people.get(r.userId) ?? null : null }));

  const questions: Question[] = Array.isArray(survey.questions) ? (survey.questions as unknown as Question[]) : [];

  if (!includeUser && !meetsAnonymityFloor(responses.length)) {
    return jsonError(`Results open once ${ANONYMITY_FLOOR} people have answered, to protect who answered.`, 409);
  }
  const filename = `${survey.title.replace(/[^a-z0-9]+/gi, "_").slice(0, 50) || "survey"}-responses.csv`;
  const csvResponse = (lines: string[]) => new Response(lines.join("\r\n"), {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
  const answersOf = (r: { answers: unknown }) => (Array.isArray(r.answers) ? (r.answers as unknown as Answer[]) : []);

  if (!includeUser) {
    const lines: string[] = [["question", "answer"].map(csvEscape).join(",")];
    for (const q of questions) {
      const values = responses
        .map((r) => answersOf(r).find((a) => a.questionId === q.id)?.value)
        .map((v) => flattenValue(v))
        .filter((v) => v !== "");
      if (!meetsAnonymityFloor(values.length)) {
        lines.push([q.text, `Hidden: fewer than ${ANONYMITY_FLOOR} people answered this question`].map(csvEscape).join(","));
        continue;
      }
      for (const v of shuffled(values)) lines.push([q.text, v].map(csvEscape).join(","));
    }
    return csvResponse(lines);
  }
  const rows = responses;

  // Build header row.
  const header: string[] = ["submitted_at", "respondent", "email", "office", "department"];
  for (const q of questions) header.push(q.text);

  const lines: string[] = [header.map(csvEscape).join(",")];

  for (const r of rows) {
    const row: (string | number)[] = [r.createdAt.toISOString()];
    const u = r.user;
    row.push(
      u ? `${u.firstName} ${u.lastName}` : "",
      u?.email ?? "",
      u?.office?.name ?? "",
      u?.department?.name ?? "",
    );
    const answers = answersOf(r);
    for (const q of questions) {
      const match = answers.find((a) => a.questionId === q.id);
      row.push(flattenValue(match?.value));
    }
    lines.push(row.map(csvEscape).join(","));
  }
  return csvResponse(lines);
}
