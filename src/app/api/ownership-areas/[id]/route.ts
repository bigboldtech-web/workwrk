import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionOrFail, getOrgId, jsonError, jsonSuccess, isManager } from "@/lib/api-helpers";
import { allOwned, idOrNull } from "@/lib/access/company-wall";

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;
  if (!isManager(session)) return jsonError("Forbidden", 403);
  const { id } = await params;
  const area = await prisma.ownershipArea.findFirst({ where: { id, organizationId: getOrgId(session) } });
  if (!area) return jsonError("Area not found", 404);

  const body = await req.json().catch(() => ({}));
  // The company wall (pen test 2026-11-28, V-04).
  const ownerRoleId = body.ownerRoleId !== undefined ? idOrNull(body.ownerRoleId) : undefined;
  if (ownerRoleId === "invalid") return jsonError("Invalid job title");
  if (!(await allOwned("role", [ownerRoleId], getOrgId(session)))) return jsonError("Job title not found", 404);
  const updated = await prisma.ownershipArea.update({
    where: { id },
    data: {
      name: typeof body.name === "string" ? body.name.trim() : undefined,
      description: body.description !== undefined ? body.description : undefined,
      // ownerRoleId can be set to null to clear ownership.
      ownerRoleId,
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
