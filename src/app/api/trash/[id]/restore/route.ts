import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionOrFail, getOrgId, isManager, jsonError, jsonSuccess } from "@/lib/api-helpers";
import { restoreFromTrash } from "@/lib/trash";

// POST: restore a trashed item back to its live table (manager-gated).
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;
  if (!isManager(session)) return jsonError("Forbidden", 403);

  const { id } = await params;
  const orgId = getOrgId(session);

  // Archived Docs / Whiteboards: restore = unarchive in place.
  if (id.startsWith("doc:")) {
    const docId = id.slice(4);
    const found = await prisma.doc.findFirst({ where: { id: docId, organizationId: orgId }, select: { id: true } });
    if (!found) return jsonError("Not found", 404);
    await prisma.doc.update({ where: { id: docId }, data: { archivedAt: null } });
    return jsonSuccess({ restored: true });
  }
  if (id.startsWith("wb:")) {
    const wbId = id.slice(3);
    const found = await prisma.whiteboard.findFirst({ where: { id: wbId, organizationId: orgId }, select: { id: true } });
    if (!found) return jsonError("Not found", 404);
    await prisma.whiteboard.update({ where: { id: wbId }, data: { archivedAt: null } });
    return jsonSuccess({ restored: true });
  }
  if (id.startsWith("agr:")) {
    const agrId = id.slice(4);
    const found = await prisma.agreement.findFirst({ where: { id: agrId, organizationId: orgId }, select: { id: true } });
    if (!found) return jsonError("Not found", 404);
    await prisma.agreement.update({ where: { id: agrId }, data: { archivedAt: null } });
    return jsonSuccess({ restored: true });
  }

  const item = await prisma.trashItem.findFirst({
    where: { id, organizationId: orgId },
    select: { id: true, entityType: true, snapshot: true },
  });
  if (!item) return jsonError("Not found", 404);

  try {
    await restoreFromTrash(item);
  } catch (e) {
    console.error("[Trash] restore failed:", e);
    return jsonError("Couldn't restore — the original may conflict with existing data.", 409);
  }
  return jsonSuccess({ restored: true });
}
