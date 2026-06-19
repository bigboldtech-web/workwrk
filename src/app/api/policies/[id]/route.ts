import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionOrFail, getOrgId, getUserId, isManager, jsonError, jsonSuccess } from "@/lib/api-helpers";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;
  const { id } = await params;
  const orgId = getOrgId(session);
  const userId = getUserId(session);
  const [policy, totalUsers] = await Promise.all([
    prisma.policy.findFirst({
      where: { id, organizationId: orgId },
      include: { acknowledgments: { select: { userId: true, version: true, acknowledgedAt: true } } },
    }),
    prisma.user.count({ where: { organizationId: orgId, deletedAt: null } }),
  ]);
  if (!policy) return jsonError("Not found", 404);

  // "Acked" = the viewer has an acknowledgement at or beyond the version that
  // acks are currently measured against. A prior-version ack that no longer
  // satisfies the requirement surfaces as needsReack.
  const myAcks = policy.acknowledgments.filter((a) => a.userId === userId);
  const acknowledged = myAcks.some((a) => (a.version ?? 0) >= policy.ackVersion);
  const needsReack = !acknowledged && myAcks.length > 0;
  // Count people who have acked the CURRENT required version (one row per user).
  const currentAckUserIds = new Set(
    policy.acknowledgments.filter((a) => (a.version ?? 0) >= policy.ackVersion).map((a) => a.userId),
  );
  return jsonSuccess({
    ...policy,
    acknowledgments: undefined,
    acknowledged,
    needsReack,
    totalAcks: currentAckUserIds.size,
    totalUsers,
    canEdit: isManager(session),
  });
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;
  if (!isManager(session)) return jsonError("Forbidden", 403);
  const { id } = await params;
  const body = await req.json();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const data: any = {};
  if (body.title !== undefined) data.title = body.title;
  if (body.content !== undefined) data.content = body.content;
  if (body.category !== undefined) data.category = body.category;
  if (body.requiresAck !== undefined) data.requiresAck = body.requiresAck;
  if (body.ackStatement !== undefined) data.ackStatement = body.ackStatement || null;
  if (body.effectiveDate !== undefined) data.effectiveDate = body.effectiveDate ? new Date(body.effectiveDate) : null;
  if (body.status !== undefined) data.status = body.status;

  // Automatic version control: when a PUBLISHED policy's content or title
  // changes, snapshot the prior state into PolicyVersion and bump the version.
  // Draft edits don't version (nothing published to record yet).
  const existing = await prisma.policy.findFirst({ where: { id, organizationId: getOrgId(session) } });
  if (!existing) return jsonError("Not found", 404);
  const touchesContent = body.content !== undefined && body.content !== existing.content;
  const touchesTitle = body.title !== undefined && body.title !== existing.title;
  const requireReack = body.requireReack === true;
  let versionBumped = false;
  if (existing.status === "PUBLISHED" && (touchesContent || touchesTitle)) {
    await prisma.policyVersion.create({
      data: {
        policyId: id,
        version: existing.version,
        title: existing.title,
        content: existing.content,
        status: existing.status,
        publishedBy: getUserId(session),
      },
    });
    data.version = existing.version + 1;
    versionBumped = true;
    // Per-publish re-acknowledgement: only when the manager opts in does the
    // ackVersion baseline move, invalidating prior acks. Minor edits leave it.
    if (requireReack) data.ackVersion = existing.version + 1;
  }
  // First publish (DRAFT/ARCHIVED → PUBLISHED): baseline acks at this version.
  if (body.status === "PUBLISHED" && existing.status !== "PUBLISHED") {
    data.ackVersion = data.version ?? existing.version;
  }

  const updated = await prisma.policy.update({ where: { id }, data });

  // When re-acknowledgement is required, reopen completed assignments so the
  // policy reappears on the assignees' /today list.
  if (versionBumped && requireReack) {
    await prisma.policyAssignment.updateMany({
      where: { policyId: id, status: "COMPLETED" },
      data: { status: "ASSIGNED", completedAt: null },
    });
  }

  return jsonSuccess(updated);
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;
  if (!isManager(session)) return jsonError("Forbidden", 403);
  const { id } = await params;
  await prisma.policy.delete({ where: { id } });
  return jsonSuccess({ message: "Deleted" });
}
