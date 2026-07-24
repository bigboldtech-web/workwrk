import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionOrFail, getOrgId, jsonError, jsonSuccess, isManager } from "@/lib/api-helpers";

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;
  if (!isManager(session)) return jsonError("Forbidden", 403);
  const { id } = await params;
  const area = await prisma.ownershipArea.findFirst({ where: { id, organizationId: getOrgId(session) } });
  if (!area) return jsonError("Area not found", 404);

  const body = await req.json().catch(() => ({}));
  const updated = await prisma.ownershipArea.update({
    where: { id },
    data: {
      name: typeof body.name === "string" ? body.name.trim() : undefined,
      description: body.description !== undefined ? body.description : undefined,
      // ownerRoleId can be set to null to clear ownership.
      ownerRoleId: body.ownerRoleId !== undefined ? body.ownerRoleId : undefined,
    },
    include: { ownerRole: { select: { id: true, title: true } } },
  });
  return jsonSuccess(updated);
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;
  if (!isManager(session)) return jsonError("Forbidden", 403);
  const { id } = await params;
  const area = await prisma.ownershipArea.findFirst({ where: { id, organizationId: getOrgId(session) } });
  if (!area) return jsonError("Area not found", 404);
  await prisma.ownershipArea.delete({ where: { id } });
  return jsonSuccess({ message: "Area deleted" });
}
