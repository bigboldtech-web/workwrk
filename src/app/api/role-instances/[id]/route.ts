import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionOrFail, getOrgId, jsonError, jsonSuccess, isManager } from "@/lib/api-helpers";
import { allOwned, allPeopleHere, idOrNull } from "@/lib/access/company-wall";

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;
  if (!isManager(session)) return jsonError("Forbidden", 403);
  const { id } = await params;
  const orgId = getOrgId(session);
  const row = await prisma.roleInstance.findFirst({ where: { id, organizationId: orgId } });
  if (!row) return jsonError("Instance not found", 404);

  const body = await req.json().catch(() => ({}));
  // The company wall (pen test 2026-11-28, V-02): never store, or show back,
  // a person or scope from another workspace.
  const scopeId = body.scopeId !== undefined ? idOrNull(body.scopeId) : undefined;
  const userId = body.userId !== undefined ? idOrNull(body.userId) : undefined;
  if (scopeId === "invalid" || userId === "invalid") return jsonError("Invalid person or scope");
  if (!(await allPeopleHere([userId], orgId))) return jsonError("Person not found", 404);
  if (!(await allOwned("scope", [scopeId], orgId))) return jsonError("Scope not found", 404);
  const updated = await prisma.roleInstance.update({
    where: { id },
    data: {
      scopeId,
      userId,
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
