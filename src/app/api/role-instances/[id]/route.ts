import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionOrFail, getOrgId, jsonError, jsonSuccess, isManager } from "@/lib/api-helpers";

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;
  if (!isManager(session)) return jsonError("Forbidden", 403);
  const { id } = await params;
  const row = await prisma.roleInstance.findFirst({ where: { id, organizationId: getOrgId(session) } });
  if (!row) return jsonError("Instance not found", 404);

  const body = await req.json().catch(() => ({}));
  const updated = await prisma.roleInstance.update({
    where: { id },
    data: {
      scopeId: body.scopeId !== undefined ? body.scopeId : undefined,
      userId: body.userId !== undefined ? body.userId : undefined,
      name: body.name !== undefined ? body.name : undefined,
      status: typeof body.status === "string" ? body.status : undefined,
    },
    include: {
      scope: { select: { id: true, name: true, dimension: true } },
      user: { select: { id: true, firstName: true, lastName: true, email: true, avatar: true } },
    },
  });
  return jsonSuccess(updated);
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;
  if (!isManager(session)) return jsonError("Forbidden", 403);
  const { id } = await params;
  const row = await prisma.roleInstance.findFirst({ where: { id, organizationId: getOrgId(session) } });
  if (!row) return jsonError("Instance not found", 404);
  await prisma.roleInstance.delete({ where: { id } });
  return jsonSuccess({ message: "Instance deleted" });
}
