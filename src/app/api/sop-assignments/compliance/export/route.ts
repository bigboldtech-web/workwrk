import { NextRequest } from "next/server";
import { getSessionOrFail, jsonError } from "@/lib/api-helpers";
import { buildSopCompliance } from "@/lib/sop-compliance";
import { csvEscape } from "@/lib/policy-compliance";

/**
 * GET /api/sop-assignments/compliance/export?view=people|sops|overdue&q=&departmentId=&mandatory=1
 * (spec-process section 2 `/sops/compliance`): the table of the current view
 * as CSV, over the same scoped, filtered rows the page shows. The `export`
 * action: never Agents.
 */
export async function GET(req: NextRequest) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;
  const level = (session.user as { accessLevel?: string }).accessLevel ?? "";
  if (level === "AGENT") return jsonError("Forbidden", 403);
  const data = await buildSopCompliance(session, req);
  if (!data) return jsonError("Forbidden", 403);
  const view = new URL(req.url).searchParams.get("view");
  const lines: string[] = [];
  if (view === "sops") {
    lines.push(["sop", "kind", "assigned", "completed", "overdue", "rate"].join(","));
    for (const r of data.sopCompliance) lines.push([r.title, r.sopType, r.total, r.completed, r.overdue, `${r.rate}%`].map(csvEscape).join(","));
  } else if (view === "overdue") {
    lines.push(["person", "department", "sop", "due_date", "mandatory", "steps_completed", "steps_total"].join(","));
    for (const r of data.overdueList) lines.push([r.userName, r.department, r.sopTitle, r.dueDate ? new Date(r.dueDate).toISOString() : "", r.mandatory ? "yes" : "no", r.stepsCompleted, r.stepsTotal].map(csvEscape).join(","));
  } else {
    lines.push(["person", "department", "assigned", "completed", "overdue", "rate", "average_score"].join(","));
    for (const r of data.personScores) lines.push([r.name, r.department, r.total, r.completed, r.overdue, `${r.rate}%`, r.avgScore ?? ""].map(csvEscape).join(","));
  }
  return new Response(lines.join("\r\n"), {
    status: 200,
    headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="sop-compliance-${view ?? "people"}.csv"` },
  });
}
