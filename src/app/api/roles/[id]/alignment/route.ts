// GET /api/roles/[id]/alignment — the role's PERMANENT alignment template.
//
// KRAs are containers attached to the ROLE (no number, no deadline) with
// their KPI gauges nested under them, north-star first. This is the
// definitional view — no person's readings appear here, because a gauge is
// read per-person (every holder of the role inherits the same template and
// records their own numbers). OKRs never appear here either: an OKR
// belongs to a person, never to a role.

import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionOrFail, getOrgId, jsonError, jsonSuccess } from "@/lib/api-helpers";
import { kpiDirection, KPI_ORDER } from "@/lib/alignment";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;
  const { id } = await params;
  const orgId = getOrgId(session);

  const role = await prisma.role.findFirst({
    where: { id, organizationId: orgId },
    select: {
      id: true,
      title: true,
      description: true,
      level: true,
      department: { select: { id: true, name: true } },
      kraTemplates: {
        select: {
          id: true,
          name: true,
          description: true,
          category: true,
          kpis: {
            select: {
              id: true, name: true, description: true, unit: true, type: true,
              frequency: true, targetValue: true, targetLabel: true,
              lowerIsBetter: true, direction: true, ownership: true,
              isNorthStar: true, formula: true, baselineValue: true, baselineLabel: true,
            },
            orderBy: KPI_ORDER,
          },
          _count: { select: { assignments: true } },
        },
        orderBy: { name: "asc" },
      },
      _count: { select: { users: true, instances: true } },
    },
  });
  if (!role) return jsonError("Role not found", 404);

  return jsonSuccess({
    role: {
      id: role.id,
      title: role.title,
      description: role.description,
      level: role.level,
      department: role.department,
    },
    // How many people hold this role today (direct assignment + scoped
    // role instances). Each of them inherits this same template.
    holders: { users: role._count.users, instances: role._count.instances },
    kras: role.kraTemplates.map((kra) => ({
      id: kra.id,
      name: kra.name,
      description: kra.description,
      category: kra.category,
      // People currently assigned this KRA (across all holders).
      assignmentCount: kra._count.assignments,
      kpis: kra.kpis.map((kpi) => ({
        ...kpi,
        // Resolved direction — the enum when set, else the legacy boolean.
        direction: kpiDirection(kpi),
      })),
    })),
  });
}
