import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionOrFail, getOrgId, jsonError, jsonSuccess } from "@/lib/api-helpers";
import { inScope, personScope } from "@/lib/process-scope";
import { remindPolicyAssignees } from "@/lib/policy-remind";

/**
 * POST: remind everyone still pending (the ledger's "…" › Remind everyone
 * pending). Scoped to the people the caller may reach; the count answered is
 * the number actually reminded.
 */
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;
  const scope = await personScope(session);
  if (!scope.canView) return jsonError("Forbidden", 403);
  const { id } = await params;
  const orgId = getOrgId(session);
  const policy = await prisma.policy.findFirst({ where: { id, organizationId: orgId }, select: { id: true, title: true } });
  if (!policy) return jsonError("Policy not found", 404);
  const rows = await prisma.policyAssignment.findMany({ where: { policyId: id, status: { not: "COMPLETED" } }, select: { id: true, userId: true, dueDate: true } });
  const targets = rows.filter((r) => inScope(scope, r.userId));
  const users = await prisma.user.findMany({ where: { id: { in: targets.map((t) => t.userId) } }, select: { id: true, email: true } });
  const emailById = new Map(users.map((u) => [u.id, u.email]));
  const count = await remindPolicyAssignees({ orgId, policyId: id, policyTitle: policy.title, targets: targets.map((t) => ({ assignmentId: t.id, userId: t.userId, email: emailById.get(t.userId) ?? "", dueDate: t.dueDate })) });
  return jsonSuccess({ reminded: count });
}
