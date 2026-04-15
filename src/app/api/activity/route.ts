import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionOrFail, getOrgId, getUserId, isManager, jsonError, jsonSuccess } from "@/lib/api-helpers";
import { parsePaginationParams, paginatedResult, skipTake } from "@/lib/pagination";

export async function GET(req: NextRequest) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;

  const orgId = getOrgId(session);
  const userId = getUserId(session);
  const { searchParams } = new URL(req.url);
  const pagination = parsePaginationParams(req);

  const type = searchParams.get("type");
  const actorId = searchParams.get("actorId");
  const actorIds = searchParams.get("actorIds"); // comma-separated
  const scope = searchParams.get("scope") || "team";

  const where: any = { organizationId: orgId };
  const userIsManager = isManager(session);

  if (scope === "my" || !userIsManager) {
    where.actorId = userId;
  } else if (scope === "team") {
    // Recursive team — self + all direct/indirect reports
    const allUsers = await prisma.user.findMany({
      where: { organizationId: orgId, deletedAt: null },
      select: { id: true, managerId: true },
    });
    const childrenMap = new Map<string, string[]>();
    for (const u of allUsers) {
      if (u.managerId) {
        if (!childrenMap.has(u.managerId)) childrenMap.set(u.managerId, []);
        childrenMap.get(u.managerId)!.push(u.id);
      }
    }
    const teamIds = new Set<string>([userId]);
    const queue: string[] = [userId];
    while (queue.length > 0) {
      const id = queue.shift()!;
      for (const c of childrenMap.get(id) || []) {
        if (!teamIds.has(c)) { teamIds.add(c); queue.push(c); }
      }
    }
    where.actorId = { in: Array.from(teamIds) };
  }
  // scope === "all" and caller is manager → no actor filter (org-wide)

  if (type) where.type = type;

  // Per-user filter (single or multiple)
  if (actorIds && userIsManager) {
    const ids = actorIds.split(",").map((s) => s.trim()).filter(Boolean);
    if (ids.length > 0) where.actorId = { in: ids };
  } else if (actorId && userIsManager) {
    where.actorId = actorId;
  }

  const [activities, total] = await Promise.all([
    prisma.activityLog.findMany({
      where,
      include: {
        actor: {
          select: { id: true, firstName: true, lastName: true, avatar: true },
        },
      },
      orderBy: { createdAt: "desc" },
      ...skipTake(pagination),
    }),
    prisma.activityLog.count({ where }),
  ]);

  return jsonSuccess({
    data: activities,
    pagination: {
      page: pagination.page,
      limit: pagination.limit,
      total,
      totalPages: Math.ceil(total / pagination.limit),
      hasMore: pagination.page < Math.ceil(total / pagination.limit),
    },
  });
}
