import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionOrFail, getOrgId, jsonError, jsonSuccess, isManager } from "@/lib/api-helpers";

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;
  if (!isManager(session)) return jsonError("Forbidden", 403);
  const { id } = await params;
  const scope = await prisma.scope.findFirst({ where: { id, organizationId: getOrgId(session) } });
  if (!scope) return jsonError("Scope not found", 404);

  const body = await req.json().catch(() => ({}));
  const updated = await prisma.scope.update({
    where: { id },
    data: {
      name: typeof body.name === "string" ? body.name.trim() : undefined,
      dimension: typeof body.dimension === "string" ? body.dimension.trim() : undefined,
      description: body.description !== undefined ? body.description : undefined,
      parentId: body.parentId !== undefined ? body.parentId : undefined,
    },
  });
  return jsonSuccess(updated);
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;
  if (!isManager(session)) return jsonError("Forbidden", 403);
  const { id } = await params;
  const scope = await prisma.scope.findFirst({ where: { id, organizationId: getOrgId(session) } });
  if (!scope) return jsonError("Scope not found", 404);
  await prisma.scope.delete({ where: { id } });
  return jsonSuccess({ message: "Scope deleted" });
}
