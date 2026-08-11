import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionOrFail, getOrgId, jsonError, jsonSuccess, isManager } from "@/lib/api-helpers";
import { KPI_ORDER } from "@/lib/alignment";

// GET: the full role-definition bundle — the Block-B view of a role.
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;
  const { id } = await params;
  const orgId = getOrgId(session);

  const role = await prisma.role.findFirst({
    where: { id, organizationId: orgId },
    include: {
      department: { select: { id: true, name: true } },
      kraTemplates: {
        include: {
          kpis: {
            select: {
              id: true, name: true, description: true, unit: true, frequency: true,
              type: true, ownership: true, formula: true, direction: true, isNorthStar: true,
              baselineValue: true, baselineLabel: true, targetValue: true, targetLabel: true, lowerIsBetter: true,
            },
            // North-star gauge first, then alphabetical.
            orderBy: KPI_ORDER,
          },
          sops: { select: { id: true, title: true, status: true } },
          _count: { select: { assignments: true } },
        },
        orderBy: { name: "asc" },
      },
      ownedAreas: { select: { id: true, name: true, description: true } },
      boundaries: {
        include: { area: { include: { ownerRole: { select: { id: true, title: true } } } } },
      },
      thresholds: { orderBy: { createdAt: "asc" } },
      instances: {
        include: {
          scope: { select: { id: true, name: true, dimension: true } },
          user: { select: { id: true, firstName: true, lastName: true, email: true, avatar: true } },
        },
        orderBy: { createdAt: "asc" },
      },
      users: { select: { id: true, firstName: true, lastName: true, email: true, avatar: true } },
    },
  });
  if (!role) return jsonError("Role not found", 404);

  // All ownership areas in the org, so the boundary editor can pick any.
  const allAreas = await prisma.ownershipArea.findMany({
    where: { organizationId: orgId },
    include: { ownerRole: { select: { id: true, title: true } } },
    orderBy: { name: "asc" },
  });

  return jsonSuccess({ role, allAreas });
}

// PUT: Edit role
export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;
  if (!isManager(session)) return jsonError("Forbidden", 403);

  const { id } = await params;
  const orgId = getOrgId(session);

  const role = await prisma.role.findFirst({
    where: { id, organizationId: orgId },
  });
  if (!role) return jsonError("Role not found", 404);

  const body = await req.json();
  const { title, description, level, departmentId } = body;

  const updated = await prisma.role.update({
    where: { id },
    data: {
      title: title ?? undefined,
      description: description !== undefined ? description : undefined,
      level: level ?? undefined,
      departmentId: departmentId !== undefined ? departmentId : undefined,
    },
  });

  return jsonSuccess(updated);
}

// DELETE: Delete role (only if no users)
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;
  if (!isManager(session)) return jsonError("Forbidden", 403);

  const { id } = await params;
  const orgId = getOrgId(session);

  const role = await prisma.role.findFirst({
    where: { id, organizationId: orgId },
    include: { _count: { select: { users: true } } },
  });
  if (!role) return jsonError("Role not found", 404);

  if (role._count.users > 0) {
    return jsonError(
      `Cannot delete: ${role._count.users} people are assigned to this role. Reassign them first.`
    );
  }

  await prisma.role.delete({ where: { id } });

  return jsonSuccess({ message: "Role deleted" });
}
