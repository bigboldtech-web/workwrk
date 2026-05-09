// Workflow runs — list + start. Manager+ can see runs targeting
// records they own; admins see everything.

import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  getSessionOrFail,
  getOrgId,
  jsonError,
  jsonSuccess,
  isManager,
} from "@/lib/api-helpers";
import { startRun } from "@/lib/workflow/engine";

export async function GET(req: NextRequest) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;
  if (!isManager(session)) return jsonError("Forbidden", 403);

  const orgId = getOrgId(session);
  const sp = new URL(req.url).searchParams;
  const entityType = sp.get("entityType");
  const entityId = sp.get("entityId");
  const status = sp.get("status")?.toUpperCase();
  const limit = Math.min(200, Number(sp.get("limit")) || 50);

  const where: Record<string, unknown> = { organizationId: orgId };
  if (entityType) where.entityType = entityType;
  if (entityId) where.entityId = entityId;
  if (status) where.status = status;

  const runs = await prisma.workflowRun.findMany({
    where,
    orderBy: { startedAt: "desc" },
    take: limit,
    include: {
      workflow: { select: { id: true, name: true, targetType: true, steps: true } },
    },
  });
  return jsonSuccess(runs);
}

export async function POST(req: NextRequest) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;

  const body = await req.json();
  const entityType = typeof body.entityType === "string" ? body.entityType : "";
  const entityId = typeof body.entityId === "string" ? body.entityId : "";
  if (!entityType) return jsonError("entityType required");
  if (!entityId) return jsonError("entityId required");

  const orgId = getOrgId(session);
  const result = await startRun({ organizationId: orgId, entityType, entityId });
  if (!result) return jsonError("No active workflow for this entityType", 404);
  return jsonSuccess(result, 201);
}
