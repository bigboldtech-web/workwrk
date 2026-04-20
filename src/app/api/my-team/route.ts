import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionOrFail, getOrgId, getUserId } from "@/lib/api-helpers";
import { getTeamUserIds } from "@/lib/team";

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

  // Resolve the team IDs via recursive CTE (DB-side walk), then fetch only
  // those users' details — avoids pulling the whole org just to filter.
  const teamIds = await getTeamUserIds(orgId, userId);

  const teamMembers = teamIds.length > 0
    ? await prisma.user.findMany({
        where: { id: { in: teamIds } },
        select: {
          id: true, firstName: true, lastName: true, email: true, avatar: true,
          accessLevel: true, managerId: true,
          department: { select: { id: true, name: true } },
          role: { select: { id: true, title: true } },
        },
      })
    : [];

  const members = teamMembers.sort((a, b) => {
    if (a.id === userId) return -1;  // self first
    if (b.id === userId) return 1;
    return `${a.firstName} ${a.lastName}`.localeCompare(`${b.firstName} ${b.lastName}`);
  });

  const self = members.find((m) => m.id === userId);
  const directReportIds = members
    .filter((m) => m.managerId === userId)
    .map((m) => m.id);

  return NextResponse.json({
    self,
    directReportIds,
    teamIds,
    members,
  }, {
    headers: { "Cache-Control": "private, max-age=30, stale-while-revalidate=60" },
  });
}
