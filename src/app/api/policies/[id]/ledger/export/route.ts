import { NextRequest } from "next/server";
import { getSessionOrFail, getOrgId, jsonError, isManager } from "@/lib/api-helpers";
import { buildPolicyLedger } from "@/lib/policy-ledger";

// GET: CSV evidence export of a policy's audit ledger — the artifact to hand a
// lawyer/auditor. One row per expected person with full acknowledgement detail.
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;
  if (!isManager(session)) return jsonError("Forbidden", 403);

  const { id } = await params;
  const ledger = await buildPolicyLedger(id, getOrgId(session));
  if (!ledger) return jsonError("Policy not found", 404);

  const esc = (v: unknown) => {
    const s = v === null || v === undefined ? "" : String(v);
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const header = ["name", "email", "department", "required", "status", "version_acked", "acknowledged_at", "ip_address", "user_agent", "attestation", "content_hash", "due_date", "days_overdue"];
  const lines = [header.join(",")];
  for (const r of ledger.rows) {
    lines.push([
      r.name, r.email, r.department, r.required ? "yes" : "no", r.status,
      r.versionAcked ?? "", r.acknowledgedAt ?? "", r.ipAddress ?? "", r.userAgent ?? "",
      r.attestation ?? "", r.contentHash ?? "", r.dueDate ?? "", r.daysOverdue || "",
    ].map(esc).join(","));
  }
  const csv = lines.join("\r\n");

  const slug = (ledger.policy.title || "policy").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60) || "policy";
  return new Response(csv, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${slug}-ack-ledger-v${ledger.policy.ackVersion}.csv"`,
    },
  });
}
