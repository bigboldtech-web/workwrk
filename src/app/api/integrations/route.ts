import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionOrFail, getOrgId, isManager, jsonError, jsonSuccess } from "@/lib/api-helpers";

export async function GET() {
  const { error, session } = await getSessionOrFail();
  if (error) return error;

  const integrations = await prisma.integration.findMany({
    where: { organizationId: getOrgId(session) },
    include: {
      _count: { select: { syncLogs: true } },
    },
    orderBy: { createdAt: "desc" },
  });

  return jsonSuccess(integrations);
}

export async function POST(req: NextRequest) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;

  if (!isManager(session)) {
    return jsonError("Insufficient permissions", 403);
  }

  const body = await req.json();
  const { name, type, config } = body;

  if (!name || !type) {
    return jsonError("Name and type are required");
  }

  const orgId = getOrgId(session);

  // Check if integration of this type already exists
  const existing = await prisma.integration.findUnique({
    where: { type_organizationId: { type, organizationId: orgId } },
  });

  if (existing) {
    // Update existing
    const updated = await prisma.integration.update({
      where: { id: existing.id },
      data: { name, config: config || {}, status: "ACTIVE" },
    });
    return jsonSuccess(updated);
  }

  const integration = await prisma.integration.create({
    data: {
      name,
      type,
      config: config || {},
      status: "ACTIVE",
      organizationId: orgId,
    },
  });

  return jsonSuccess(integration, 201);
}
