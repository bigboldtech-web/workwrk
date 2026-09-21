import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionOrFail, getOrgId, jsonError, jsonSuccess } from "@/lib/api-helpers";
import { inScope, personScope } from "@/lib/process-scope";
import { remindPolicyAssignees } from "@/lib/policy-remind";

/** POST: remind one person (the ledger row menu). Never on a completed assignment. */
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string; assignmentId: string }> }) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;
  const scope = await personScope(session);
  if (!scope.canView) return jsonError("Forbidden", 403);
  const { id, assignmentId } = await params;
  const orgId = getOrgId(session);
  const row = await prisma.policyAssignment.findFirst({
    where: { id: assignmentId, policyId: id, policy: { organizationId: orgId } },
    include: { policy: { select: { id: true, title: true } } },
  });
  if (!row) return jsonError("Assignment not found", 404);
  if (!inScope(scope, row.userId)) return jsonError("You can only remind people who report to you.", 403);
  if (row.status === "COMPLETED") return jsonError("This person has already acknowledged it.", 409);
  const user = await prisma.user.findUnique({ where: { id: row.userId }, select: { email: true } });
  const count = await remindPolicyAssignees({ orgId, policyId: id, policyTitle: row.policy.title, targets: [{ assignmentId: row.id, userId: row.userId, email: user?.email ?? "", dueDate: row.dueDate }] });
  return jsonSuccess({ reminded: count });
}
