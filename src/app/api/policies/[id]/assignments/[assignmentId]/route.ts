import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionOrFail, getOrgId, jsonError, jsonSuccess } from "@/lib/api-helpers";
import { inScope, personScope } from "@/lib/process-scope";

/**
 * PATCH /api/policies/[id]/assignments/[assignmentId] { dueDate?, mandatory? }
 * DELETE /api/policies/[id]/assignments/[assignmentId]
 * (spec-process section 2 `/policies/[id]/compliance`: the row menu's Change
 * due date and Remove assignment, which the old UI implied and no endpoint
 * supported). Both are gated on the person rule: the manager chain, the
 * People team and admins may change or withdraw an assignment for someone
 * in their scope. Removing an assignment keeps the acknowledgement history.
 */
async function loadAssignment(session: unknown, policyId: string, assignmentId: string) {
  const orgId = getOrgId(session);
  const row = await prisma.policyAssignment.findFirst({
    where: { id: assignmentId, policyId, policy: { organizationId: orgId } },
    select: { id: true, userId: true, policyId: true },
  });
  return row;
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string; assignmentId: string }> }) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;
  const scope = await personScope(session);
  if (!scope.canView) return jsonError("Forbidden", 403);
  const { id, assignmentId } = await params;
  const row = await loadAssignment(session, id, assignmentId);
  if (!row) return jsonError("Assignment not found", 404);
  if (!inScope(scope, row.userId)) return jsonError("You can only change assignments for people who report to you.", 403);

  const body = await req.json().catch(() => ({}));
  const data: { dueDate?: Date | null; mandatory?: boolean } = {};
  if (body.dueDate !== undefined) {
    if (!body.dueDate) data.dueDate = null;
    else {
      const d = new Date(body.dueDate);
      if (typeof body.dueDate !== "string" || Number.isNaN(d.getTime())) return jsonError("dueDate must be a date (YYYY-MM-DD) or empty.");
      data.dueDate = d;
    }
  }
  if (body.mandatory !== undefined) data.mandatory = !!body.mandatory;
  if (Object.keys(data).length === 0) return jsonError("Nothing to change");
  const updated = await prisma.policyAssignment.update({ where: { id: assignmentId }, data });
  return jsonSuccess(updated);
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string; assignmentId: string }> }) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;
  const scope = await personScope(session);
  if (!scope.canView) return jsonError("Forbidden", 403);
  const { id, assignmentId } = await params;
  const row = await loadAssignment(session, id, assignmentId);
  if (!row) return jsonError("Assignment not found", 404);
  if (!inScope(scope, row.userId)) return jsonError("You can only remove assignments for people who report to you.", 403);
  await prisma.policyAssignment.delete({ where: { id: assignmentId } });
  return jsonSuccess({ removed: true });
}
