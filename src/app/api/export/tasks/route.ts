import { prisma } from "@/lib/prisma";
import { getSessionOrFail, getOrgId, jsonError } from "@/lib/api-helpers";

export async function GET() {
  const { error, session } = await getSessionOrFail();
  if (error) return error;

  const orgId = getOrgId(session);

  const tasks = await prisma.task.findMany({
    where: { organizationId: orgId },
    include: {
      assignee: { select: { firstName: true, lastName: true } },
      creator: { select: { firstName: true, lastName: true } },
    },
    orderBy: [{ priority: "asc" }, { createdAt: "desc" }],
  });

  const header = ["Title", "Assignee", "Status", "Priority", "Due Date", "Created Date", "Completed Date", "Creator"];
  const rows = tasks.map((t) => [
    t.title,
    t.assignee ? `${t.assignee.firstName} ${t.assignee.lastName}` : "Unassigned",
    t.status.replace(/_/g, " "),
    t.priority,
    t.deadline ? t.deadline.toISOString().split("T")[0] : "",
    t.createdAt.toISOString().split("T")[0],
    t.completedAt ? t.completedAt.toISOString().split("T")[0] : "",
    t.creator ? `${t.creator.firstName} ${t.creator.lastName}` : "",
  ]);

  const csv = [header, ...rows].map((r) => r.map((c) => `"${c.replace(/"/g, '""')}"`).join(",")).join("\n");

  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv",
      "Content-Disposition": `attachment; filename="tasks-export-${new Date().toISOString().split("T")[0]}.csv"`,
    },
  });
}
