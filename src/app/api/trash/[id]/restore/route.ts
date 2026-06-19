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
  const item = await prisma.trashItem.findFirst({
    where: { id, organizationId: getOrgId(session) },
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
