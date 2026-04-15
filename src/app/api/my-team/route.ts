import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionOrFail, getOrgId, getUserId } from "@/lib/api-helpers";

/**
 * GET /api/my-team
 * Returns the current user and ALL their direct + indirect reports
 * (recursive downward hierarchy). Used to power team task/activity filtering.
 *
 * Response: { self, directReportIds, teamIds, members[] }
 */
export async function GET() {
  const { error, session } = await getSessionOrFail();
  if (error) return error;

  const userId = getUserId(session);
  const orgId = getOrgId(session);

  // Pull all active users in org with managerId so we can walk the tree in memory
  const allUsers = await prisma.user.findMany({
    where: { organizationId: orgId, deletedAt: null },
    select: {
      id: true, firstName: true, lastName: true, email: true, avatar: true,
      accessLevel: true, managerId: true,
      department: { select: { id: true, name: true } },
      role: { select: { id: true, title: true } },
    },
  });

  // Build manager → [directReportIds] map
  const childrenMap = new Map<string, string[]>();
  for (const u of allUsers) {
    if (u.managerId) {
      if (!childrenMap.has(u.managerId)) childrenMap.set(u.managerId, []);
      childrenMap.get(u.managerId)!.push(u.id);
    }
  }

  // BFS from current user, collecting all descendants
  const teamIds = new Set<string>([userId]);
  const queue: string[] = [userId];
  while (queue.length > 0) {
    const id = queue.shift()!;
    const children = childrenMap.get(id) || [];
    for (const c of children) {
      if (!teamIds.has(c)) {
        teamIds.add(c);
        queue.push(c);
      }
    }
  }

  const members = allUsers
    .filter((u) => teamIds.has(u.id))
    .sort((a, b) => {
      if (a.id === userId) return -1;  // self first
      if (b.id === userId) return 1;
      return `${a.firstName} ${a.lastName}`.localeCompare(`${b.firstName} ${b.lastName}`);
    });

  const self = members.find((m) => m.id === userId);
  const directReportIds = childrenMap.get(userId) || [];

  return NextResponse.json({
    self,
    directReportIds,
    teamIds: Array.from(teamIds),
    members,
  }, {
    headers: { "Cache-Control": "private, max-age=30, stale-while-revalidate=60" },
  });
}
