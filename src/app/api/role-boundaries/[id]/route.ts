import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionOrFail, getOrgId, jsonError, jsonSuccess, isManager } from "@/lib/api-helpers";

const RELATIONS = new Set(["OWNS", "CAN_REQUEST", "CANNOT_TOUCH"]);

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;
  if (!isManager(session)) return jsonError("Forbidden", 403);
  const { id } = await params;
  const row = await prisma.roleBoundary.findFirst({ where: { id, organizationId: getOrgId(session) } });
  if (!row) return jsonError("Boundary not found", 404);

  const body = await req.json().catch(() => ({}));
  if (body.relation && !RELATIONS.has(body.relation)) {
    return jsonError("relation must be OWNS | CAN_REQUEST | CANNOT_TOUCH");
  }
  const updated = await prisma.roleBoundary.update({
    where: { id },
    data: { relation: body.relation ?? undefined },
  });
  return jsonSuccess(updated);
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;
  if (!isManager(session)) return jsonError("Forbidden", 403);
  const { id } = await params;
  const row = await prisma.roleBoundary.findFirst({ where: { id, organizationId: getOrgId(session) } });
  if (!row) return jsonError("Boundary not found", 404);
  await prisma.roleBoundary.delete({ where: { id } });
  return jsonSuccess({ message: "Boundary removed" });
}
