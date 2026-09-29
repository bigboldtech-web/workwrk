// GET /api/kudos/stats (spec-teams-performance /kudos Data): the numbers the
// page prints, computed on the server over the whole organization, never
// over the loaded page: { total, thisWeek, reactions, topReceiver } plus the
// viewer's own received and given totals. topReceiver covers the last 30
// days (null when nobody was thanked in that window). Guests never read it.

import { prisma } from "@/lib/prisma";
import { getSessionOrFail, getOrgId, getUserId, jsonError, jsonSuccess } from "@/lib/api-helpers";
import { viewerFromSession } from "@/lib/access/viewer";

export async function GET() {
  const { error, session } = await getSessionOrFail();
  if (error) return error;
  const orgId = getOrgId(session);
  const userId = getUserId(session);
  const viewer = await viewerFromSession();
  if (viewer?.orgRole === "GUEST") return jsonError("Not found", 404);

  const now = Date.now();
  const weekAgo = new Date(now - 7 * 86_400_000);
  const monthAgo = new Date(now - 30 * 86_400_000);
  const [total, thisWeek, reactions, received, given, top] = await Promise.all([
    prisma.kudos.count({ where: { organizationId: orgId } }),
    prisma.kudos.count({ where: { organizationId: orgId, createdAt: { gte: weekAgo } } }),
    prisma.kudosReaction.count({ where: { kudos: { organizationId: orgId } } }),
    prisma.kudos.count({ where: { organizationId: orgId, receiverId: userId } }),
    prisma.kudos.count({ where: { organizationId: orgId, giverId: userId } }),
    prisma.kudos.groupBy({
      by: ["receiverId"],
      where: { organizationId: orgId, createdAt: { gte: monthAgo } },
      _count: { _all: true },
      orderBy: [{ _count: { receiverId: "desc" } }, { receiverId: "asc" }],
      take: 1,
    }),
  ]);
  let topReceiver: { id: string; name: string; count: number } | null = null;
  if (top[0]) {
    const u = await prisma.user.findUnique({ where: { id: top[0].receiverId }, select: { id: true, firstName: true, lastName: true } });
    if (u) topReceiver = { id: u.id, name: `${u.firstName ?? ""} ${u.lastName ?? ""}`.trim(), count: top[0]._count._all };
  }
  return jsonSuccess({ total, thisWeek, reactions, received, given, topReceiver });
}
