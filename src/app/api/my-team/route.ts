import { NextResponse } from "next/server";
import { managersWithSeatHere, placementsHere, seatPlacementsHere } from "@/lib/access/profile-here";
import { levelsHeldIn } from "@/lib/access/acting-workspace";
import { prisma } from "@/lib/prisma";
import { getSessionOrFail, getOrgId, getUserId } from "@/lib/api-helpers";
import { getTeamUserIds } from "@/lib/team";

/**
 * GET /api/my-team
 * Returns the current user and ALL their direct + indirect reports
 * (recursive downward hierarchy). Used to power team task/activity filtering.
 *
 * Response: { self, directReportIds, teamIds, members[] }
 *
 * Each member as THIS workspace holds them (docs/plans/workspace-status.md
 * D18; the final review, security L3): their level here (the membership's
 * role for someone who works here through one, never the account's, which
 * is the workspace it is anchored to: an Admin or HR there), a manager id
 * only for a manager with a seat here, deactivated or not (kept), and a
 * department and job title only of this workspace's own (the membership's
 * for a membership person). Before, a membership member carried their
 * anchored workspace's level and a manager id naming someone of another
 * workspace.
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
          id: true, organizationId: true, firstName: true, lastName: true, email: true, avatar: true,
          accessLevel: true, managerId: true, departmentId: true, roleId: true,
        },
      })
    : [];
  // The level each holds here (kept seats: a deactivated report stays listed,
  // as the walk keeps them), the placement each holds here, and the managers
  // with a seat here.
  const [levels, held, managersHere] = await Promise.all([
    levelsHeldIn(orgId, teamMembers.map((m) => m.id), prisma, { keptSeats: true }),
    seatPlacementsHere(orgId, teamMembers),
    managersWithSeatHere(orgId, teamMembers.map((m) => m.managerId)),
  ]);
  const placed = await placementsHere(orgId, [...held.values()]);

  const members = teamMembers
    .map(({ organizationId: _o, departmentId: _d, roleId: _r, ...m }) => {
      void _o;
      void _d;
      void _r;
      const h = held.get(m.id);
      const dept = h?.departmentId ? placed.department.get(h.departmentId) : undefined;
      const role = h?.roleId ? placed.role.get(h.roleId) : undefined;
      return {
        ...m,
        accessLevel: levels.get(m.id) ?? "EMPLOYEE",
        managerId: m.managerId && managersHere.has(m.managerId) ? m.managerId : null,
        department: dept ? { id: dept.id, name: dept.name } : null,
        role: role ? { id: role.id, title: role.title } : null,
      };
    })
    .sort((a, b) => {
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
