// GET /api/kras/orphans — KRAs that belong to no job title (roleId null).
//
// The role-first spine says a KRA exists only inside a Role; POST
// /api/kras now enforces that for new KRAs. Legacy orphans are NEVER
// deleted or silently reassigned — this endpoint SURFACES them so an
// admin can attach each one to a job title (PATCH /api/kras {id, roleId}).
// For every orphan we return its active assignees and, when ALL of them
// hold exactly one distinct job title, that role as `suggestedRole` —
// a proposal only, never auto-applied. Ambiguous or unassigned orphans
// ship with `suggestedRole: null` for the admin to decide.

import { prisma } from "@/lib/prisma";
import { getSessionOrFail, getOrgId, jsonSuccess, requirePermission } from "@/lib/api-helpers";

export async function GET() {
  const { error, session } = await getSessionOrFail();
  if (error) return error;
  // Fixing an orphan is a KRA edit — same permission gates the report.
  const denied = await requirePermission(session, "kras", "edit");
  if (denied) return denied;

  const orphans = await prisma.kRA.findMany({
    where: { organizationId: getOrgId(session), roleId: null },
    include: {
      kpis: {
        select: { id: true, name: true, unit: true, targetValue: true, isNorthStar: true },
        orderBy: [{ isNorthStar: "desc" }, { name: "asc" }],
      },
      assignments: {
        where: { status: "ACTIVE" },
        select: {
          id: true,
          user: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              role: { select: { id: true, title: true } },
            },
          },
        },
      },
      _count: { select: { assignments: true } },
    },
    orderBy: { name: "asc" },
  });

  const rows = orphans.map((kra) => {
    // Distinct job titles held by the active assignees — the best guess.
    const roleById = new Map<string, { id: string; title: string }>();
    for (const a of kra.assignments) {
      if (a.user.role) roleById.set(a.user.role.id, a.user.role);
    }
    const distinctRoles = Array.from(roleById.values());
    return {
      id: kra.id,
      name: kra.name,
      description: kra.description,
      category: kra.category,
      kpis: kra.kpis,
      activeAssignees: kra.assignments.map((a) => ({
        id: a.user.id,
        firstName: a.user.firstName,
        lastName: a.user.lastName,
        role: a.user.role,
      })),
      totalAssignments: kra._count.assignments,
      assigneeRoles: distinctRoles,
      // Exactly one distinct role across all active holders → propose it.
      suggestedRole: distinctRoles.length === 1 ? distinctRoles[0] : null,
    };
  });

  return jsonSuccess({ orphans: rows, total: rows.length });
}
