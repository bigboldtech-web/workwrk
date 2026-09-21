import { NextRequest } from "next/server";
import { getSessionOrFail, getOrgId, jsonError } from "@/lib/api-helpers";
import { personScope } from "@/lib/process-scope";
import { buildPolicyCompliance, csvEscape } from "@/lib/policy-compliance";
import { parsePeriod } from "@/lib/policy-compliance-view";

/** GET: the Open gaps of the Policy compliance dashboard as CSV (the `export` action; never Agents). */
export async function GET(req: NextRequest) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;
  const level = (session.user as { accessLevel?: string }).accessLevel ?? "";
  if (level === "AGENT") return jsonError("Forbidden", 403);
  const scope = await personScope(session);
  if (!scope.canView) return jsonError("Forbidden", 403);
  const sp = new URL(req.url).searchParams;
  const data = await buildPolicyCompliance(getOrgId(session), scope.orgWide ? null : scope.userIds, {
    q: sp.get("q"), departmentId: sp.get("departmentId"), policyId: sp.get("policyId"), period: parsePeriod(sp.get("period")),
  });
  const view = sp.get("view");
  const lines: string[] = [];
  if (view === "people") {
    lines.push(["person", "department", "required", "acknowledged", "pending", "overdue", "rate"].join(","));
    for (const r of data.personCompliance) lines.push([r.name, r.department, r.required, r.acked, r.pending, r.overdue, `${r.rate}%`].map(csvEscape).join(","));
  } else if (view === "policies") {
    lines.push(["policy", "category", "required", "acknowledged", "overdue", "rate"].join(","));
    for (const r of data.policyCompliance) lines.push([r.title, r.category ?? "", r.total, r.acked, r.overdue, `${r.rate}%`].map(csvEscape).join(","));
  } else {
    lines.push(["person", "department", "policy", "status", "due_date", "days_overdue", "last_acked_version"].join(","));
    for (const r of data.pendingList) lines.push([r.userName, r.department, r.policyTitle, r.status, r.dueDate ?? "", r.daysOverdue || "", r.lastAckedVersion ?? ""].map(csvEscape).join(","));
  }
  return new Response(lines.join("\r\n"), {
    status: 200,
    headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="policy-compliance-${view ?? "gaps"}.csv"` },
  });
}
