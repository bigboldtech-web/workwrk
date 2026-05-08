import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionOrFail, getOrgId, jsonError, jsonSuccess, isOrgAdmin } from "@/lib/api-helpers";

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;
  if (!isOrgAdmin(session)) return jsonError("Forbidden", 403);
  const { id } = await params;
  const orgId = getOrgId(session);
  const plan = await prisma.headcountPlan.findFirst({ where: { id, organizationId: orgId } });
  if (!plan) return jsonError("Plan not found", 404);
  await prisma.headcountPlan.delete({ where: { id } });
  return jsonSuccess({ deleted: true });
}
