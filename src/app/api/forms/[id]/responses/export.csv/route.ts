// GET /api/forms/[id]/responses/export.csv?q=&dir=   -> text/csv
//
// "Export responses as CSV" (the one form row menu, spec-tables-forms section
// 2 /forms; the builder's Responses tab "..." uses it too). One row per
// response, newest first: when it was sent, who sent it (a person's name, or
// "Anonymous"), then one column per form field in the form's order, the
// field's label as the header. Answers to fields the form no longer has are
// not exported (they are still stored and shown on the Responses tab).
//
// Gate: exactly GET /api/forms/[id]/responses's reach (reading responses is an
// editor's right), and never an Agent (cap.agent.export).

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionOrFail, getOrgId, jsonError } from "@/lib/api-helpers";
import { viewerFromSession } from "@/lib/access/viewer";
import { FORM_SELECT } from "@/lib/forms/form-select";
import { optionalResponderViewer } from "@/lib/forms/session-viewer";
import { answerText, isQuestion, readFormFields, readWentTo } from "@/lib/forms/fields";
import { canReadResponses, peopleForResponses, responsesWhere } from "@/lib/forms/responses-server";
import { csvFormulaSafe, toCsvMatrix } from "@/lib/csv";

const MAX_EXPORT = 50_000;

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;
  const orgId = getOrgId(session);
  const { id } = await params;

  const viewer = await viewerFromSession().catch(() => null);
  if (viewer?.isAgent) return jsonError("Agents cannot export", 403);

  const form = await prisma.formDefinition.findFirst({ where: { id, organizationId: orgId }, select: FORM_SELECT });
  if (!form) return jsonError("not found", 404);
  const reader = await optionalResponderViewer();
  if (!(await canReadResponses(form, reader))) return jsonError("not found", 404);

  const fields = readFormFields(form.fields).filter(isQuestion);
  // The Responses tab's active Filter and sort, so the file is what was on screen.
  const sp = new URL(req.url).searchParams;
  const dir = sp.get("dir") === "asc" ? "asc" : "desc";
  const rows = await prisma.formSubmission.findMany({
    where: await responsesWhere(orgId, id, sp.get("q")),
    orderBy: [{ submittedAt: dir }, { id: dir }],
    take: MAX_EXPORT,
    select: { id: true, data: true, submittedById: true, submittedAt: true },
  });
  const people = await peopleForResponses(orgId, rows, fields.filter((f) => f.type === "people").map((f) => f.id));
  const nameOf = (uid: string) => people[uid]?.name ?? null;

  const header = ["Submitted at", "Responder", "Responder email", ...fields.map((f, i) => csvFormulaSafe(f.label?.trim() || `Field ${i + 1}`)), "Went to"];
  const body = rows.map((r) => {
    const data = (r.data && typeof r.data === "object" && !Array.isArray(r.data) ? r.data : {}) as Record<string, unknown>;
    const who = r.submittedById ? people[r.submittedById] : undefined;
    const went = readWentTo(data);
    const wentText = [went.list ? ("itemId" in went.list ? "List task" : `Not sent to the List (${went.list.error})`) : null,
      went.table ? ("rowId" in went.table ? "Table row" : `Not sent to the table (${went.table.error})`) : null].filter(Boolean).join("; ");
    return [
      r.submittedAt.toISOString(),
      csvFormulaSafe(r.submittedById ? who?.name ?? "Member" : "Anonymous"),
      who?.email ?? "",
      // Answers are text other people typed: never a live formula in Excel.
      // A number answer stays a number (a negative one is not a formula).
      ...fields.map((f) => {
        const t = answerText(f, data[f.id], nameOf);
        return f.type === "number" && typeof data[f.id] === "number" ? t : csvFormulaSafe(t);
      }),
      wentText,
    ];
  });
  const base = (form.name || "form").replace(/[^\w\- ]+/g, "").trim().replace(/\s+/g, "-").slice(0, 80) || "form";
  return new NextResponse(toCsvMatrix([header, ...body]), {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${base}-responses.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
