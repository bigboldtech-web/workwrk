import { getSessionOrFail, getOrgId, jsonError, jsonSuccess } from "@/lib/api-helpers";
import { prisma } from "@/lib/prisma";
import { sessionIsWorkspaceAdmin } from "@/lib/access/workspace-admin";

// GET /api/audit/types: every event type this workspace's audit log holds,
// with its count, for the Type filter (the whole set, not only the types
// that happened to land on the first page). Owner and Admin, like the page.
export async function GET() {
  const { error, session } = await getSessionOrFail();
  if (error) return error;
  if (!sessionIsWorkspaceAdmin(session)) return jsonError("Only workspace Owners and Admins can read the audit log", 403);
  const rows = await prisma.activityLog.groupBy({
    by: ["type"],
    where: { organizationId: getOrgId(session) },
    _count: { _all: true },
    orderBy: { type: "asc" },
    take: 1000,
  });
  return jsonSuccess({ types: rows.map((r) => ({ type: r.type, count: r._count._all })) });
}
