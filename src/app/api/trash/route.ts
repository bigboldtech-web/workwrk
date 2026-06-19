import { prisma } from "@/lib/prisma";
import { getSessionOrFail, getOrgId, isManager, jsonError, jsonSuccess } from "@/lib/api-helpers";
import { purgeExpiredTrash } from "@/lib/trash";

// GET: the org recycle bin (manager-gated). Purges items older than 60 days first.
export async function GET() {
  const { error, session } = await getSessionOrFail();
  if (error) return error;
  if (!isManager(session)) return jsonError("Forbidden", 403);

  const orgId = getOrgId(session);
  await purgeExpiredTrash(orgId);

  const items = await prisma.trashItem.findMany({
    where: { organizationId: orgId },
    orderBy: { deletedAt: "desc" },
    select: { id: true, entityType: true, entityId: true, label: true, deletedByName: true, deletedAt: true },
  });

  return jsonSuccess({ items });
}
