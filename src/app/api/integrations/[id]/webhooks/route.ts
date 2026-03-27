import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionOrFail, getOrgId, isManager, jsonError, jsonSuccess } from "@/lib/api-helpers";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;

  const { id } = await params;
  const orgId = getOrgId(session);

  const integration = await prisma.integration.findFirst({
    where: { id, organizationId: orgId },
  });

  if (!integration) return jsonError("Integration not found", 404);

  const logs = await prisma.webhookLog.findMany({
    where: { integrationId: id },
    orderBy: { createdAt: "desc" },
    take: 20,
    select: {
      id: true,
      direction: true,
      event: true,
      status: true,
      error: true,
      responseCode: true,
      createdAt: true,
    },
  });

  return jsonSuccess(logs);
}
