import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionOrFail, getOrgId, getUserId, isManager, jsonError, jsonSuccess } from "@/lib/api-helpers";

export async function GET() {
  const { error, session } = await getSessionOrFail();
  if (error) return error;

  const orgId = getOrgId(session);
  const userId = getUserId(session);

  const policies = await prisma.policy.findMany({
    where: { organizationId: orgId, status: "PUBLISHED" },
    include: {
      acknowledgments: { where: { userId }, select: { id: true, acknowledgedAt: true } },
      _count: { select: { acknowledgments: true } },
    },
    orderBy: { updatedAt: "desc" },
  });

  // Get total user count for acknowledgment percentage
  const totalUsers = await prisma.user.count({ where: { organizationId: orgId, deletedAt: null } });

  return jsonSuccess(policies.map((p) => ({
    ...p,
    acknowledged: p.acknowledgments.length > 0,
    acknowledgedAt: p.acknowledgments[0]?.acknowledgedAt || null,
    ackRate: totalUsers > 0 ? Math.round((p._count.acknowledgments / totalUsers) * 100) : 0,
    totalAcks: p._count.acknowledgments,
    totalUsers,
  })));
}

export async function POST(req: NextRequest) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;
  if (!isManager(session)) return jsonError("Forbidden", 403);

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

  return jsonSuccess(policy, 201);
}
