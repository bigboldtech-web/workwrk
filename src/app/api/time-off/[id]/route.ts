// Single time-off request: read / cancel.
//   GET    — requester, approver, manager+
//   PATCH  — requester (cancel only) or admin (any field)
//   DELETE — requester (PENDING only); admin can delete any
//
// Approve/reject lives on the /decide endpoint to keep the audit
// stamping in one place.

import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  getSessionOrFail,
  getOrgId,
  getUserId,
  jsonError,
  jsonSuccess,
  isManager,
  isOrgAdmin,
} from "@/lib/api-helpers";
import { logActivity } from "@/lib/activity";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;
  const { id } = await params;
  const orgId = getOrgId(session);
  const userId = getUserId(session);

  const r = await prisma.timeOffRequest.findFirst({
    where: { id, organizationId: orgId },
    include: {
      user: { select: { id: true, firstName: true, lastName: true, email: true } },
      approver: { select: { id: true, firstName: true, lastName: true } },
      policy: { select: { id: true, name: true, type: true, color: true } },
    },
  });
  if (!r) return jsonError("Request not found", 404);

  const canSee =
    r.userId === userId || r.approverId === userId || isManager(session);
  if (!canSee) return jsonError("Request not found", 404);

  return jsonSuccess({ ...r, hours: Number(r.hours) });
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;
  const { id } = await params;
  const orgId = getOrgId(session);
  const userId = getUserId(session);

  const r = await prisma.timeOffRequest.findFirst({
    where: { id, organizationId: orgId },
  });
  if (!r) return jsonError("Request not found", 404);

  const isOwner = r.userId === userId;
  const adminCanAct = isOrgAdmin(session);

  const body = await req.json();
  const data: Record<string, unknown> = {};

  // Owner-only path: cancel a PENDING / APPROVED request.
  if (isOwner) {
    if (body.status === "CANCELLED") {
      if (r.status === "REJECTED" || r.status === "CANCELLED") {
        return jsonError("Already finalized", 409);
      }
      data.status = "CANCELLED";
    } else if (Object.keys(body).length > 0 && !adminCanAct) {
      return jsonError("Owners can only cancel a request. Ask an admin to edit.", 403);
    }
  }

  if (adminCanAct) {
    if (body.startDate) {
      const d = new Date(body.startDate);
      if (Number.isNaN(d.getTime())) return jsonError("Invalid startDate");
      data.startDate = d;
    }
    if (body.endDate) {
      const d = new Date(body.endDate);
      if (Number.isNaN(d.getTime())) return jsonError("Invalid endDate");
      data.endDate = d;
    }
    if (body.hours !== undefined) {
      const num = Number(body.hours);
      if (!Number.isFinite(num) || num <= 0 || num > 99_999) {
        return jsonError("Invalid hours");
      }
      data.hours = num;
    }
    if (body.reason !== undefined) {
      data.reason = typeof body.reason === "string" ? body.reason.trim() || null : null;
    }
  }

  if (Object.keys(data).length === 0) return jsonError("No changes");

  const updated = await prisma.timeOffRequest.update({ where: { id }, data });

  logActivity({
    type: "time_off_updated",
    actorId: userId,
    organizationId: orgId,
    description: `Updated time-off request`,
    targetId: id,
    targetType: "time_off_request",
  });

  return jsonSuccess({ ...updated, hours: Number(updated.hours) });
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;
  const { id } = await params;
  const orgId = getOrgId(session);
  const userId = getUserId(session);

  const r = await prisma.timeOffRequest.findFirst({
    where: { id, organizationId: orgId },
  });
  if (!r) return jsonError("Request not found", 404);

  const adminCanAct = isOrgAdmin(session);
  const ownerCanDelete = r.userId === userId && r.status === "PENDING";

  if (!adminCanAct && !ownerCanDelete) return jsonError("Forbidden", 403);

  await prisma.timeOffRequest.delete({ where: { id } });
  return jsonSuccess({ deleted: true });
}
