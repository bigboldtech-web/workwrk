import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionOrFail, getOrgId, getUserId, jsonError, jsonSuccess, isManager } from "@/lib/api-helpers";
import { getTeamUserIds } from "@/lib/team";
import { sendEmail } from "@/lib/email";
import { policyAssignedTemplate } from "@/lib/email-templates";

const ORG_WIDE_ASSIGNERS = new Set(["COMPANY_ADMIN", "SUPER_ADMIN", "C_LEVEL", "VP", "DIRECTOR", "HR"]);

// GET: who is assigned to this policy + their acknowledgement status (manager).
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;
  if (!isManager(session)) return jsonError("Forbidden", 403);

  const { id } = await params;
  const orgId = getOrgId(session);
  const policy = await prisma.policy.findFirst({ where: { id, organizationId: orgId }, select: { id: true } });
  if (!policy) return jsonError("Policy not found", 404);

  const assignments = await prisma.policyAssignment.findMany({
    where: { policyId: id },
    orderBy: [{ status: "asc" }, { createdAt: "desc" }],
  });
  const users = await prisma.user.findMany({
    where: { id: { in: assignments.map((a) => a.userId) } },
    select: { id: true, firstName: true, lastName: true, email: true },
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
        name: u ? `${u.firstName} ${u.lastName}` : "—",
        email: u?.email ?? null,
      };
    }),
  });
}

// POST: assign this policy to people (manager). Body:
//   { userIds?: string[], departmentId?: string, all?: boolean, mandatory?, dueDate? }
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;
  if (!isManager(session)) return jsonError("Forbidden", 403);

  const { id } = await params;
  const orgId = getOrgId(session);
  const body = await req.json();
  const { userIds, departmentId, all, dueDate, mandatory } = body;

  const policy = await prisma.policy.findFirst({ where: { id, organizationId: orgId } });
  if (!policy) return jsonError("Policy not found", 404);

  let resolved: string[] = Array.isArray(userIds) ? userIds : [];
  if (departmentId) {
    const deptUsers = await prisma.user.findMany({
      where: { departmentId, organizationId: orgId, status: "ACTIVE" },
      select: { id: true },
    });
    resolved = [...new Set([...resolved, ...deptUsers.map((u) => u.id)])];
  }
  if (all) {
    const allUsers = await prisma.user.findMany({
      where: { organizationId: orgId, status: "ACTIVE" },
      select: { id: true },
    });
    resolved = [...new Set([...resolved, ...allUsers.map((u) => u.id)])];
  }
  if (resolved.length === 0) return jsonError("No recipients. Provide userIds[], departmentId, or all:true");

  // Governance: non-org-wide assigners are scoped to their report tree.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const callerLevel = (session.user as any).accessLevel as string;
  if (!ORG_WIDE_ASSIGNERS.has(callerLevel)) {
    const teamIds = new Set(await getTeamUserIds(orgId, getUserId(session)));
    resolved = resolved.filter((uid) => teamIds.has(uid));
    if (resolved.length === 0) return jsonError("You can only assign to people who report to you.", 403);
  }

  const assignerId = getUserId(session);
  const result = await prisma.policyAssignment.createMany({
    data: resolved.map((uid) => ({
      policyId: id,
      userId: uid,
      mandatory: mandatory ?? true,
      dueDate: dueDate ? new Date(dueDate) : null,
      assignedBy: assignerId,
    })),
    skipDuplicates: true,
  });

  // Notify + email.
  await prisma.notification.createMany({
    data: resolved.map((uid) => ({
      title: "Policy to acknowledge",
      message: `Please review & acknowledge "${policy.title}".`,
      type: "POLICY",
      link: `/policies/${id}`,
      userId: uid,
    })),
  });

  const baseUrl = process.env.NEXTAUTH_URL || "http://localhost:3000";
  const users = await prisma.user.findMany({ where: { id: { in: resolved } }, select: { id: true, email: true } });
  for (const u of users) {
    const { subject, html } = policyAssignedTemplate({
      policyTitle: policy.title,
      dueDate: dueDate ? new Date(dueDate).toLocaleDateString() : undefined,
      policyLink: `${baseUrl}/policies/${id}`,
    });
    try {
      await sendEmail({
        to: u.email,
        subject,
        html,
        template: "policy-assigned",
        variables: { policyTitle: policy.title, dueDate },
        organizationId: orgId,
        userId: u.id,
        category: "policy",
      });
    } catch (e) {
      console.error("[PolicyAssignment] email failed:", e);
    }
  }

  return jsonSuccess({ message: `${result.count} assignments created`, count: result.count }, 201);
}
