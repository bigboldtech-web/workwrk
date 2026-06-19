import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionOrFail, getOrgId, isManager, jsonError, jsonSuccess } from "@/lib/api-helpers";

// DELETE: permanently delete a trashed item (manager-gated).
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;
  if (!isManager(session)) return jsonError("Forbidden", 403);

  const { id } = await params;
  const item = await prisma.trashItem.findFirst({ where: { id, organizationId: getOrgId(session) }, select: { id: true } });
  if (!item) return jsonError("Not found", 404);

  await prisma.trashItem.delete({ where: { id } });
  return jsonSuccess({ deleted: true });
}
