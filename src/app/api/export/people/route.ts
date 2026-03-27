import { prisma } from "@/lib/prisma";
import { getSessionOrFail, getOrgId, isManager, jsonError } from "@/lib/api-helpers";

export async function GET() {
  const { error, session } = await getSessionOrFail();
  if (error) return error;
  if (!isManager(session)) return jsonError("Forbidden", 403);

  const orgId = getOrgId(session);

  const users = await prisma.user.findMany({
    where: { organizationId: orgId, deletedAt: null },
    include: {
      department: { select: { name: true } },
      role: { select: { title: true } },
      kpiRecords: { select: { score: true }, orderBy: { createdAt: "desc" }, take: 5 },
    },
    orderBy: { firstName: "asc" },
  });

  const header = ["Name", "Email", "Department", "Role", "Join Date", "Status", "Avg Performance Score"];
  const rows = users.map((u) => {
    const scores = u.kpiRecords.filter((r) => r.score != null).map((r) => r.score!);
    const avg = scores.length > 0 ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : 0;
    return [
      `${u.firstName} ${u.lastName}`,
      u.email,
      u.department?.name || "",
      u.role?.title || "",
      u.joinDate.toISOString().split("T")[0],
      u.status,
      String(avg),
    ];
  });

  const csv = [header, ...rows].map((r) => r.map((c) => `"${c.replace(/"/g, '""')}"`).join(",")).join("\n");

  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv",
      "Content-Disposition": `attachment; filename="people-export-${new Date().toISOString().split("T")[0]}.csv"`,
    },
  });
}
