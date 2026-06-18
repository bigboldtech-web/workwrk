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
      include: { acknowledgments: { select: { userId: true, acknowledgedAt: true } }, _count: { select: { acknowledgments: true } } },
    }),
    prisma.user.count({ where: { organizationId: orgId, deletedAt: null } }),
  ]);
  if (!policy) return jsonError("Not found", 404);
  const acknowledged = policy.acknowledgments.some((a) => a.userId === userId);
  return jsonSuccess({ ...policy, acknowledged, totalAcks: policy._count.acknowledgments, totalUsers, canEdit: isManager(session) });
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;
  if (!isManager(session)) return jsonError("Forbidden", 403);
  const { id } = await params;
  const body = await req.json();
  const data: any = {};
  if (body.title !== undefined) data.title = body.title;
  if (body.content !== undefined) data.content = body.content;
  if (body.category !== undefined) data.category = body.category;
  if (body.requiresAck !== undefined) data.requiresAck = body.requiresAck;
  if (body.effectiveDate !== undefined) data.effectiveDate = body.effectiveDate ? new Date(body.effectiveDate) : null;
  if (body.status !== undefined) data.status = body.status;

  // Automatic version control: when a PUBLISHED policy's content or title
  // changes, snapshot the prior state into PolicyVersion and bump the version.
  // Draft edits don't version (nothing published to record yet).
  const existing = await prisma.policy.findFirst({ where: { id, organizationId: getOrgId(session) } });
  if (!existing) return jsonError("Not found", 404);
  const touchesContent = body.content !== undefined && body.content !== existing.content;
  const touchesTitle = body.title !== undefined && body.title !== existing.title;
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
  }

  const updated = await prisma.policy.update({ where: { id }, data });
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
