// Single workflow run — get + decide step + cancel.

import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  getSessionOrFail,
  getOrgId,
  getUserId,
  jsonError,
  jsonSuccess,
} from "@/lib/api-helpers";
import { decideStep, cancelRun } from "@/lib/workflow/engine";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;

  const { id } = await params;
  const orgId = getOrgId(session);
  const run = await prisma.workflowRun.findFirst({
    where: { id, organizationId: orgId },
    include: { workflow: { select: { id: true, name: true, targetType: true, steps: true } } },
  });
  if (!run) return jsonError("Not found", 404);
  return jsonSuccess(run);
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;

  const { id } = await params;
  const orgId = getOrgId(session);
  const userId = getUserId(session);
  const body = await req.json();
  const action = typeof body.action === "string" ? body.action : "decide";

  // Ownership check.
  const run = await prisma.workflowRun.findFirst({
    where: { id, organizationId: orgId },
    select: { id: true },
  });
  if (!run) return jsonError("Not found", 404);

  if (action === "decide") {
    const decision = body.decision === "REJECT" ? "REJECT" : "APPROVE";
    const note = typeof body.note === "string" ? body.note : null;
    try {
      const result = await decideStep({ runId: id, actorId: userId, decision, note });
      return jsonSuccess(result);
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : "decide failed";
      return jsonError(message, 400);
    }
  }

  if (action === "cancel") {
    await cancelRun(id);
    return jsonSuccess({ ok: true });
  }

  return jsonError("Unknown action. Use decide | cancel");
}
