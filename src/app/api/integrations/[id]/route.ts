import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { jsonError, jsonSuccess } from "@/lib/api-helpers";
import { isOwnerOrAdmin, requireApp } from "@/lib/app-gate";
import { staleTabRefusal } from "@/lib/access/tab-workspace-check";

/**
 * Owner or Admin only, as POST /api/integrations: a connection's config holds
 * its ingest secret, which records KPI readings, kudos and tasks in anyone's
 * name. The legacy manager tier let a Director or VP change it.
 */
async function ownerOrAdmin(): Promise<{ orgId: string } | { error: Response }> {
  const gate = await requireApp("integrations");
  if ("error" in gate) return { error: gate.error };
  if (!isOwnerOrAdmin(gate.viewer)) return { error: jsonError("Only workspace Owners and Admins can change connections.", 403) };
  const stale = await staleTabRefusal(gate.viewer.organizationId);
  if (stale) return { error: stale };
  return { orgId: gate.viewer.organizationId };
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const gate = await ownerOrAdmin();
  if ("error" in gate) return gate.error;
  const orgId = gate.orgId;
  const { id } = await params;
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
  const gate = await ownerOrAdmin();
  if ("error" in gate) return gate.error;
  const orgId = gate.orgId;
  const { id } = await params;

  const integration = await prisma.integration.findFirst({
    where: { id, organizationId: orgId },
  });

  if (!integration) {
    return jsonError("Integration not found", 404);
  }

  await prisma.integration.delete({ where: { id } });

  return jsonSuccess({ message: "Integration removed" });
}
