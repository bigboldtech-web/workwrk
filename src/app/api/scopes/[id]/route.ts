import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionOrFail, getOrgId, jsonError, jsonSuccess, isManager } from "@/lib/api-helpers";
import { allOwned, idOrNull } from "@/lib/access/company-wall";

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;
  if (!isManager(session)) return jsonError("Forbidden", 403);
  const { id } = await params;
  const scope = await prisma.scope.findFirst({ where: { id, organizationId: getOrgId(session) } });
  if (!scope) return jsonError("Scope not found", 404);

  const body = await req.json().catch(() => ({}));
  // The company wall (pen test 2026-11-28, V-02): a parent from another
  // workspace is refused, and a scope is never its own parent.
  const parentId = body.parentId !== undefined ? idOrNull(body.parentId) : undefined;
  if (parentId === "invalid" || parentId === id) return jsonError("Invalid parent scope");
  if (!(await allOwned("scope", [parentId], getOrgId(session)))) return jsonError("Parent scope not found", 404);
  const updated = await prisma.scope.update({
    where: { id },
    data: {
      name: typeof body.name === "string" ? body.name.trim() : undefined,
      dimension: typeof body.dimension === "string" ? body.dimension.trim() : undefined,
      description: body.description !== undefined ? body.description : undefined,
      parentId,
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
