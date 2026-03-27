import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionOrFail, getOrgId, isManager, jsonError, jsonSuccess } from "@/lib/api-helpers";

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;

  if (!isManager(session)) {
    return jsonError("Insufficient permissions", 403);
  }

  const { id } = await params;
  const orgId = getOrgId(session);
  const body = await req.json();

  const integration = await prisma.integration.findFirst({
    where: { id, organizationId: orgId },
  });

  if (!integration) {
    return jsonError("Integration not found", 404);
  }

  const updated = await prisma.integration.update({
    where: { id },
    data: {
      ...(body.name && { name: body.name }),
      ...(body.config && { config: body.config }),
      ...(body.status && { status: body.status }),
      ...(body.syncFrequency && { syncFrequency: body.syncFrequency }),
    },
  });

  return jsonSuccess(updated);
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;

  if (!isManager(session)) {
    return jsonError("Insufficient permissions", 403);
  }

  const { id } = await params;
  const orgId = getOrgId(session);

  const integration = await prisma.integration.findFirst({
    where: { id, organizationId: orgId },
  });

  if (!integration) {
    return jsonError("Integration not found", 404);
  }

  await prisma.integration.delete({ where: { id } });

  return jsonSuccess({ message: "Integration removed" });
}
