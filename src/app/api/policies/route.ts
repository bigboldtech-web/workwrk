import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionOrFail, getOrgId, getUserId, isManager, jsonError, jsonSuccess, requirePermission } from "@/lib/api-helpers";
import { logAuditEvent } from "@/lib/activity";

export async function GET() {
  const { error, session } = await getSessionOrFail();
  if (error) return error;

  const orgId = getOrgId(session);
  const userId = getUserId(session);

  const [policies, totalUsers, currentUser] = await Promise.all([
    prisma.policy.findMany({
      where: { organizationId: orgId, status: "PUBLISHED" },
      include: {
        acknowledgments: { where: { userId } },
        _count: { select: { acknowledgments: true } },
      },
      orderBy: { updatedAt: "desc" },
    }),
    prisma.user.count({ where: { organizationId: orgId, deletedAt: null } }),
    prisma.user.findUnique({
      where: { id: userId },
      select: { firstName: true, lastName: true, email: true },
    }),
  ]);

  return jsonSuccess(policies.map((p) => {
    const ack = p.acknowledgments[0] || null;
    return {
      ...p,
      acknowledged: !!ack,
      acknowledgedAt: ack?.acknowledgedAt || null,
      acknowledgedBy: ack && currentUser ? `${currentUser.firstName} ${currentUser.lastName}` : null,
      acknowledgedEmail: ack ? currentUser?.email || null : null,
      acknowledgedIp: ack?.ipAddress || null,
      ackRate: totalUsers > 0 ? Math.round((p._count.acknowledgments / totalUsers) * 100) : 0,
      totalAcks: p._count.acknowledgments,
      totalUsers,
    };
  }));
}

export async function POST(req: NextRequest) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;
  const denied = await requirePermission(session, "policies", "create");
  if (denied) return denied;

  const orgId = getOrgId(session);
  const body = await req.json();
  const { title, content, category, requiresAck, effectiveDate, status } = body;

  if (!title?.trim() || !content?.trim()) return jsonError("Title and content required");

  const finalStatus = status || "PUBLISHED";
  const policy = await prisma.policy.create({
    data: {
      title: title.trim(),
      content: content.trim(),
      category: category || null,
      requiresAck: requiresAck !== false,
      effectiveDate: effectiveDate ? new Date(effectiveDate) : null,
      status: finalStatus,
      organizationId: orgId,
    },
  });

  // Notify all org users when published
  if (finalStatus === "PUBLISHED") {
    const users = await prisma.user.findMany({
      where: { organizationId: orgId, deletedAt: null },
      select: { id: true },
    });
    if (users.length > 0) {
      await prisma.notification.createMany({
        data: users.map((u) => ({
          userId: u.id,
          type: "policy_published",
          title: policy.requiresAck ? "New Policy — Acknowledgment Required" : "New Policy Published",
          message: `${policy.title}${policy.category ? ` (${policy.category})` : ""}`,
          link: "/policies",
        })),
      });
    }
  }

  // Policies are compliance documents — every publication is a
  // signal we want preserved at warning severity for SOC 2 / legal
  // review pulls.
  logAuditEvent({
    type: `policy.${finalStatus === "PUBLISHED" ? "publish" : "draft"}`,
    actorId: getUserId(session),
    organizationId: orgId,
    description: `${finalStatus === "PUBLISHED" ? "Published" : "Drafted"} policy: ${policy.title}`,
    targetId: policy.id,
    targetType: "Policy",
    metadata: { title: policy.title, category, requiresAck: policy.requiresAck, status: finalStatus },
  });

  return jsonSuccess(policy, 201);
}
