import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionOrFail, getOrgId, isManager, jsonError, jsonSuccess } from "@/lib/api-helpers";

// DELETE: permanently delete a trashed item (manager-gated).
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;
  if (!isManager(session)) return jsonError("Forbidden", 403);

  const { id } = await params;
  const orgId = getOrgId(session);

  // Archived Docs / Whiteboards: delete-forever = hard delete the row.
  if (id.startsWith("doc:")) {
    const docId = id.slice(4);
    const found = await prisma.doc.findFirst({ where: { id: docId, organizationId: orgId }, select: { id: true } });
    if (!found) return jsonError("Not found", 404);
    await prisma.doc.delete({ where: { id: docId } });
    return jsonSuccess({ deleted: true });
  }
  if (id.startsWith("wb:")) {
    const wbId = id.slice(3);
    const found = await prisma.whiteboard.findFirst({ where: { id: wbId, organizationId: orgId }, select: { id: true } });
    if (!found) return jsonError("Not found", 404);
    await prisma.whiteboard.delete({ where: { id: wbId } });
    return jsonSuccess({ deleted: true });
  }

  const item = await prisma.trashItem.findFirst({ where: { id, organizationId: orgId }, select: { id: true } });
  if (!item) return jsonError("Not found", 404);

  await prisma.trashItem.delete({ where: { id } });
  return jsonSuccess({ deleted: true });
}
