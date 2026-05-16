import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionOrFail, getOrgId, getUserId, isManager, jsonError, jsonSuccess } from "@/lib/api-helpers";
import { logActivity } from "@/lib/activity";

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;
  if (!isManager(session)) return jsonError("Forbidden", 403);
  const { id } = await params;
  const body = await req.json();
  const data: any = {};
  if (body.title !== undefined) data.title = body.title;
  if (body.content !== undefined) data.content = body.content;
  if (body.type !== undefined) data.type = body.type;
  if (body.priority !== undefined) data.priority = body.priority;
  if (body.pinned !== undefined) data.pinned = body.pinned;
  if (body.mustAcknowledge !== undefined) data.mustAcknowledge = body.mustAcknowledge === true;
  if (body.expiresAt !== undefined) {
    if (!body.expiresAt) return jsonError("Expiry date is required");
    const expiryDate = new Date(`${String(body.expiresAt).slice(0, 10)}T23:59:59.999Z`);
    if (isNaN(expiryDate.getTime())) return jsonError("Invalid expiry date");
    if (expiryDate.getTime() <= Date.now()) return jsonError("Expiry date must be in the future");
    data.expiresAt = expiryDate;
  }
  const updated = await prisma.announcement.update({ where: { id }, data });
  return jsonSuccess(updated);
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;
  if (!isManager(session)) return jsonError("Forbidden", 403);
  const { id } = await params;
  const orgId = getOrgId(session);
  const userId = getUserId(session);
  // Fetch the row before delete so we can name it in the audit log.
  // Org-scoped so a stale/cross-tenant ID never deletes someone
  // else's data even if the manager somehow obtained it.
  const target = await prisma.announcement.findFirst({
    where: { id, organizationId: orgId },
    select: { id: true, title: true },
  });
  if (!target) return jsonError("Announcement not found", 404);
  await prisma.announcement.delete({ where: { id } });
  await logActivity({
    type: "announcement.delete",
    actorId: userId,
    organizationId: orgId,
    description: `Deleted announcement: ${target.title}`,
    targetType: "Announcement",
    targetId: id,
    severity: "warning",
  });
  return jsonSuccess({ message: "Deleted" });
}
