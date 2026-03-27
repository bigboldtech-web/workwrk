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
  const scope = searchParams.get("scope") || "team";

  const where: any = { organizationId: orgId };

  if (scope === "my" || !isManager(session)) {
    where.actorId = userId;
  }

  if (type) where.type = type;
  if (actorId && isManager(session)) where.actorId = actorId;

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
