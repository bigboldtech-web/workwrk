import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionOrFail, getOrgId, jsonError, jsonSuccess, isManager } from "@/lib/api-helpers";

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
