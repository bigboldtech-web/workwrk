import { prisma } from "@/lib/prisma";
import { getSessionOrFail, getOrgId, isManager, jsonError, jsonSuccess } from "@/lib/api-helpers";

/**
 * Soft-disconnects QuickBooks by flipping the integration to INACTIVE
 * and clearing the stored OAuth tokens. We keep the row so historical
 * sync logs remain queryable.
 */
export async function POST() {
  const { error, session } = await getSessionOrFail();
  if (error) return error;
  if (!isManager(session)) return jsonError("Forbidden", 403);
  const orgId = getOrgId(session);

  await prisma.integration.updateMany({
    where: { type: "QUICKBOOKS", organizationId: orgId },
    data: { status: "INACTIVE", config: {} },
  });

  return jsonSuccess({ disconnected: true });
}
