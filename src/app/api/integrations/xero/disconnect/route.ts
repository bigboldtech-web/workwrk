import { prisma } from "@/lib/prisma";
import { getSessionOrFail, getOrgId, isManager, jsonError, jsonSuccess } from "@/lib/api-helpers";

export async function POST() {
  const { error, session } = await getSessionOrFail();
  if (error) return error;
  if (!isManager(session)) return jsonError("Forbidden", 403);
  const orgId = getOrgId(session);

  await prisma.integration.updateMany({
    where: { type: "XERO", organizationId: orgId },
    data: { status: "INACTIVE", config: {} },
  });

  return jsonSuccess({ disconnected: true });
}
