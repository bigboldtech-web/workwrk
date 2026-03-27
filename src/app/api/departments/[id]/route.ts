import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionOrFail, getOrgId, jsonError, jsonSuccess, isManager } from "@/lib/api-helpers";

// PUT: Edit department
export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;
  if (!isManager(session)) return jsonError("Forbidden", 403);

  const { id } = await params;
  const orgId = getOrgId(session);

  const dept = await prisma.department.findFirst({
    where: { id, organizationId: orgId },
  });
  if (!dept) return jsonError("Department not found", 404);

  const body = await req.json();
  const { name, description, color, parentId, headId } = body;

  const updated = await prisma.department.update({
    where: { id },
    data: {
      name: name ?? undefined,
      description: description !== undefined ? description : undefined,
      color: color !== undefined ? color : undefined,
      parentId: parentId !== undefined ? parentId : undefined,
      headId: headId !== undefined ? headId : undefined,
    },
  });

  return jsonSuccess(updated);
}

// DELETE: Delete department (only if no members)
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;
  if (!isManager(session)) return jsonError("Forbidden", 403);

  const { id } = await params;
  const orgId = getOrgId(session);

  const dept = await prisma.department.findFirst({
    where: { id, organizationId: orgId },
    include: { _count: { select: { members: true } } },
  });
  if (!dept) return jsonError("Department not found", 404);

  if (dept._count.members > 0) {
    return jsonError(
      `Cannot delete: ${dept._count.members} people are assigned to this department. Reassign them first.`
    );
  }

  await prisma.department.delete({ where: { id } });

  return jsonSuccess({ message: "Department deleted" });
}
