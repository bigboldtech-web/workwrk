import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionOrFail, getOrgId, getUserId, jsonError, jsonSuccess, isManager } from "@/lib/api-helpers";
import { sendEmail } from "@/lib/email";
import { policyAssignedTemplate } from "@/lib/email-templates";
import { inScope, personScope } from "@/lib/process-scope";
import { parseProcessSettings, defaultAckDueDate } from "@/lib/process-settings";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SettingsBlob = Record<string, any>;

/** GET: who is assigned to this policy and their acknowledgement status, scoped to the people the viewer may see. */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;
  const scope = await personScope(session);
  if (!scope.canView) return jsonError("Forbidden", 403);

  const { id } = await params;
  const orgId = getOrgId(session);
  const policy = await prisma.policy.findFirst({ where: { id, organizationId: orgId }, select: { id: true } });
  if (!policy) return jsonError("Policy not found", 404);

  const assignments = (await prisma.policyAssignment.findMany({ where: { policyId: id }, orderBy: [{ status: "asc" }, { createdAt: "desc" }] }))
    .filter((a) => inScope(scope, a.userId));
  const users = await prisma.user.findMany({
    where: { id: { in: assignments.map((a) => a.userId) } },
    select: { id: true, firstName: true, lastName: true, email: true, avatar: true, department: { select: { name: true } } },
  });
  const byId = new Map(users.map((u) => [u.id, u]));

  return jsonSuccess({
    assignments: assignments.map((a) => {
      const u = byId.get(a.userId);
      return {
        id: a.id,
        userId: a.userId,
        status: a.status,
        mandatory: a.mandatory,
        dueDate: a.dueDate,
        completedAt: a.completedAt,
        name: u ? `${u.firstName} ${u.lastName}` : "Unknown",
        email: u?.email ?? null,
        avatar: u?.avatar ?? null,
        department: u?.department?.name ?? null,
      };
    }),
  });
}

/**
 * POST: assign this policy to people. Body:
 *   { userIds?: string[], departmentId?: string, all?: boolean, mandatory?, dueDate? }
 * When no due date is given the org's `ackDueDays` default (Organize ›
 * Defaults) sets one. Non-org-wide assigners are scoped to their report tree.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;
  if (!isManager(session)) return jsonError("Forbidden", 403);

  const { id } = await params;
  const orgId = getOrgId(session);
  const body = await req.json().catch(() => ({}));
  const { userIds, departmentId, all, dueDate, mandatory } = body as { userIds?: unknown; departmentId?: unknown; all?: unknown; dueDate?: unknown; mandatory?: unknown };

  const [policy, org] = await Promise.all([
    prisma.policy.findFirst({ where: { id, organizationId: orgId } }),
    prisma.organization.findUnique({ where: { id: orgId }, select: { settings: true } }),
  ]);
  if (!policy) return jsonError("Policy not found", 404);

  let resolved: string[] = Array.isArray(userIds) ? userIds.filter((x): x is string => typeof x === "string") : [];
  if (typeof departmentId === "string" && departmentId) {
    const deptUsers = await prisma.user.findMany({ where: { departmentId, organizationId: orgId, status: "ACTIVE" }, select: { id: true } });
    resolved = [...new Set([...resolved, ...deptUsers.map((u) => u.id)])];
  }
  if (all === true) {
    const allUsers = await prisma.user.findMany({ where: { organizationId: orgId, status: "ACTIVE" }, select: { id: true } });
    resolved = [...new Set([...resolved, ...allUsers.map((u) => u.id)])];
  }
  if (resolved.length === 0) return jsonError("No recipients. Provide userIds[], departmentId, or all:true");

  const scope = await personScope(session);
  if (!scope.orgWide) {
    resolved = resolved.filter((uid) => inScope(scope, uid));
    if (resolved.length === 0) return jsonError("You can only assign to people who report to you.", 403);
  }

  const settings = (org?.settings as SettingsBlob | null) || {};
  const defaults = parseProcessSettings(settings.process).value;
  const due = typeof dueDate === "string" && dueDate ? new Date(dueDate) : (() => { const d = defaultAckDueDate(defaults.ackDueDays); return d ? new Date(d) : null; })();

  const assignerId = getUserId(session);
  const result = await prisma.policyAssignment.createMany({
    data: resolved.map((uid) => ({ policyId: id, userId: uid, mandatory: mandatory === undefined ? true : !!mandatory, dueDate: due, assignedBy: assignerId })),
    skipDuplicates: true,
  });
  // Someone who already acknowledged the current version owes nothing: their
  // new row completes at once instead of staying ASSIGNED for ever (a badge
  // nobody could clear, because the page showed "Acknowledged" and no button).
  const alreadyAcked = await prisma.policyAcknowledgment.findMany({ where: { policyId: id, userId: { in: resolved }, version: { gte: policy.ackVersion } }, select: { userId: true, acknowledgedAt: true } });
  if (alreadyAcked.length) {
    await prisma.policyAssignment.updateMany({ where: { policyId: id, userId: { in: alreadyAcked.map((a) => a.userId) }, status: { not: "COMPLETED" } }, data: { status: "COMPLETED", completedAt: new Date() } });
  }
  const ackedIds = new Set(alreadyAcked.map((a) => a.userId));
  const toNotify = resolved.filter((uid) => !ackedIds.has(uid));

  if (toNotify.length) await prisma.notification.createMany({
    data: toNotify.map((uid) => ({
      title: "Policy to acknowledge",
      message: `Please review and acknowledge "${policy.title}".`,
      type: "policy.assigned",
      link: `/policies/${id}`,
      userId: uid,
    })),
  });

  const baseUrl = process.env.NEXTAUTH_URL || "http://localhost:3000";
  const users = await prisma.user.findMany({ where: { id: { in: toNotify } }, select: { id: true, email: true } });
  for (const u of users) {
    const { subject, html } = policyAssignedTemplate({ policyTitle: policy.title, dueDate: due ? due.toISOString().slice(0, 10) : undefined, policyLink: `${baseUrl}/policies/${id}` });
    try {
      await sendEmail({ to: u.email, subject, html, template: "policy-assigned", variables: { policyTitle: policy.title, dueDate: due?.toISOString() ?? null }, organizationId: orgId, userId: u.id, category: "policy" });
    } catch (e) {
      console.error("[PolicyAssignment] email failed:", e);
    }
  }

  return jsonSuccess({ message: `${result.count} assignments created`, count: result.count }, 201);
}
