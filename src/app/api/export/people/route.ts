import { prisma } from "@/lib/prisma";
import { getSessionOrFail, getOrgId, getUserId, jsonError } from "@/lib/api-helpers";
import { logActivity } from "@/lib/activity";
import { settingsWriteGate } from "@/lib/access/settings-write";

// A cell a spreadsheet would run as a formula (= + - @, tab, CR) is prefixed
// with a quote, so a name like "=HYPERLINK(...)" stays text in Excel.
function cell(v: string): string {
  const s = /^[=+\-@\t\r]/.test(v) ? `'${v}` : v;
  return `"${s.replace(/"/g, '""')}"`;
}

export async function GET() {
  const { error, session } = await getSessionOrFail();
  if (error) return error;
  const writeGate = await settingsWriteGate(session, "data");
  if (!writeGate.ok) return writeGate.response;
  const orgId = getOrgId(session);

  const users = await prisma.user.findMany({
    where: { organizationId: orgId, deletedAt: null },
    include: {
      department: { select: { name: true } },
      role: { select: { title: true } },
      manager: { select: { firstName: true, lastName: true } },
      office: { select: { name: true } },
      kpiRecords: { select: { score: true }, orderBy: { createdAt: "desc" }, take: 5 },
    },
    orderBy: { firstName: "asc" },
  });

  const header = ["Name", "Email", "Department", "Job title", "Reports to", "Office", "Join Date", "Status", "Avg Performance Score"];
  const rows = users.map((u) => {
    const scores = u.kpiRecords.filter((r) => r.score != null).map((r) => r.score!);
    const avg = scores.length > 0 ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : 0;
    return [
      `${u.firstName} ${u.lastName}`,
      u.email,
      u.department?.name || "",
      u.role?.title || "",
      u.manager ? `${u.manager.firstName} ${u.manager.lastName}`.trim() : "",
      u.office?.name || "",
      u.joinDate.toISOString().split("T")[0],
      u.status,
      String(avg),
    ];
  });

  const csv = [header, ...rows].map((r) => r.map(cell).join(",")).join("\n");

  logActivity({
    type: "data.exported",
    actorId: getUserId(session),
    organizationId: orgId,
    description: `Exported the people CSV (${rows.length} people)`,
    targetType: "export",
    severity: "warning",
    metadata: { kind: "people", rows: rows.length },
  });

  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv",
      "Content-Disposition": `attachment; filename="people-export-${new Date().toISOString().split("T")[0]}.csv"`,
    },
  });
}
