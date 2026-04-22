import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionOrFail, getOrgId, isManager, jsonError } from "@/lib/api-helpers";

/**
 * CSV export of all responses to a single pulse survey.
 *
 * Layout — one row per respondent, one column per question plus
 * `submitted_at` and (if the survey is non-anonymous) respondent/office/
 * department columns. Commas and quotes in answers are escaped per RFC
 * 4180 so Excel / Sheets ingest it cleanly.
 *
 * Same privacy contract as the aggregate endpoint: attribution columns
 * only appear when `survey.anonymous === false`. Accepts `officeId` and
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
  const s = val === null || val === undefined ? "" : String(val);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

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
    select: { id: true, title: true, questions: true, anonymous: true },
  });
  if (!survey) return jsonError("Survey not found", 404);

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
      createdAt: true,
      answers: true,
      ...(includeUser
        ? {
            user: {
              select: {
                firstName: true, lastName: true, email: true,
                office: { select: { name: true } },
                department: { select: { name: true } },
              },
            },
          }
        : {}),
    },
    orderBy: { createdAt: "asc" },
  });

  const questions: Question[] = Array.isArray(survey.questions) ? (survey.questions as any as Question[]) : [];

  // Build header row.
  const header: string[] = ["submitted_at"];
  if (includeUser) header.push("respondent", "email", "office", "department");
  for (const q of questions) header.push(q.text);

  const lines: string[] = [header.map(csvEscape).join(",")];

  for (const r of responses) {
    const row: (string | number)[] = [r.createdAt.toISOString()];
    if (includeUser) {
      const u: any = (r as any).user;
      row.push(
        u ? `${u.firstName} ${u.lastName}` : "",
        u?.email ?? "",
        u?.office?.name ?? "",
        u?.department?.name ?? "",
      );
    }
    const answers = Array.isArray(r.answers) ? (r.answers as any as Answer[]) : [];
    for (const q of questions) {
      const match = answers.find((a) => a.questionId === q.id);
      row.push(flattenValue(match?.value));
    }
    lines.push(row.map(csvEscape).join(","));
  }

  const filename = `${survey.title.replace(/[^a-z0-9]+/gi, "_").slice(0, 50) || "survey"}-responses.csv`;

  return new Response(lines.join("\r\n"), {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}
