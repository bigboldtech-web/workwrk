import { NextResponse } from "next/server";
import { managersWithSeatHere, placementsHere, seatPlacementsHere } from "@/lib/access/profile-here";
import { seatsHeldFor } from "@/lib/access/acting-workspace";
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
 *
 * THE LINE HERE (docs/plans/workspace-status-2.md E1, step 3): each
 * member's managerId, and so directReportIds, is the line their seat here
 * holds (acting-workspace.ts seatsHeldFor: the account's for someone
 * anchored here, the membership's otherwise), the same lines the walk that
 * found teamIds climbed. Before, it was the account's line, so Dana's My
 * team in B listed Pat under Max, her manager in A.
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
          accessLevel: true, status: true, managerId: true, departmentId: true, roleId: true,
        },
      })
    : [];
  // The seat each holds here (kept seats: a deactivated report stays
  // listed, as the walk keeps them) with its level and its line here, and
  // the placement each holds here.
  const [seats, held] = await Promise.all([
    seatsHeldFor(orgId, teamMembers),
    seatPlacementsHere(orgId, teamMembers),
  ]);
  const lineHere = (id: string) => seats.get(id)?.managerId ?? null;
  // A manager is named only while they hold a seat here (profile-here.ts).
  const [placed, managersHere] = await Promise.all([
    placementsHere(orgId, [...held.values()]),
    managersWithSeatHere(orgId, teamMembers.map((m) => lineHere(m.id))),
  ]);

  const members = teamMembers
    .map(({ organizationId: _o, departmentId: _d, roleId: _r, status: _s, managerId: _account, ...m }) => {
      void _o;
      void _d;
      void _r;
      void _s;
      void _account;
      const h = held.get(m.id);
      const dept = h?.departmentId ? placed.department.get(h.departmentId) : undefined;
      const role = h?.roleId ? placed.role.get(h.roleId) : undefined;
      const managerId = lineHere(m.id);
      return {
        ...m,
        accessLevel: seats.get(m.id)?.level ?? "EMPLOYEE",
        managerId: managerId && managersHere.has(managerId) ? managerId : null,
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
