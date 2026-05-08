// PO detail + state transitions in a single PATCH endpoint:
//   submit  : DRAFT → SUBMITTED  (requester only)
//   retract : SUBMITTED → DRAFT  (requester only, before decision)
//   approve : SUBMITTED → APPROVED  (manager+, not self)
//   reject  : SUBMITTED → REJECTED  (manager+, not self)
//   send    : APPROVED → SENT  (any party with edit rights)
//   receive : SENT → RECEIVED  (any party)
//   close   : RECEIVED → CLOSED  (any party)

import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  getSessionOrFail,
  getOrgId,
  getUserId,
  jsonError,
  jsonSuccess,
  isManager,
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

  const po = await prisma.purchaseOrder.findFirst({
    where: { id, organizationId: orgId },
    include: {
      vendor: true,
      requester: { select: { id: true, firstName: true, lastName: true, email: true } },
      approver: { select: { id: true, firstName: true, lastName: true } },
      invoices: {
        orderBy: { createdAt: "desc" },
        select: {
          id: true,
          invoiceNumber: true,
          amount: true,
          currency: true,
          status: true,
          dueDate: true,
        },
      },
    },
  });
  if (!po) return jsonError("PO not found", 404);

  const canSee = po.requesterId === userId || po.approverId === userId || isManager(session);
  if (!canSee) return jsonError("PO not found", 404);

  return jsonSuccess({
    ...po,
    amount: Number(po.amount),
    invoices: po.invoices.map((i) => ({ ...i, amount: Number(i.amount) })),
  });
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

  const po = await prisma.purchaseOrder.findFirst({
    where: { id, organizationId: orgId },
  });
  if (!po) return jsonError("PO not found", 404);

  const body = await req.json();
  const action = typeof body.action === "string" ? body.action : null;
  const isOwner = po.requesterId === userId;
  const note = typeof body.note === "string" ? body.note.trim() || null : null;

  // No action → field edits (DRAFT only, owner only).
  if (!action) {
    if (po.status !== "DRAFT" || !isOwner) {
      return jsonError("Only DRAFT POs can be edited by the requester", 403);
    }
    const data: Record<string, unknown> = {};
    if (typeof body.description === "string") {
      const d = body.description.trim();
      if (!d) return jsonError("description cannot be empty");
      data.description = d;
    }
    if (body.amount !== undefined) {
      const num = Number(body.amount);
      if (!Number.isFinite(num) || num <= 0) return jsonError("Invalid amount");
      data.amount = num;
    }
    if (typeof body.currency === "string") {
      const cur = body.currency.trim().toUpperCase();
      if (cur.length !== 3) return jsonError("currency must be 3-letter ISO");
      data.currency = cur;
    }
    if (body.expectedDeliveryDate !== undefined) {
      if (body.expectedDeliveryDate === null || body.expectedDeliveryDate === "") {
        data.expectedDeliveryDate = null;
      } else {
        const d = new Date(body.expectedDeliveryDate);
        if (Number.isNaN(d.getTime())) return jsonError("Invalid expectedDeliveryDate");
        data.expectedDeliveryDate = d;
      }
    }
    if (body.notes !== undefined) data.notes = typeof body.notes === "string" ? body.notes.trim() || null : null;

    if (Object.keys(data).length === 0) return jsonError("No changes");
    const updated = await prisma.purchaseOrder.update({ where: { id }, data });
    return jsonSuccess({ ...updated, amount: Number(updated.amount) });
  }

  // Action transitions.
  let updateData: Record<string, unknown> = {};
  if (action === "submit") {
    if (!isOwner) return jsonError("Forbidden", 403);
    if (po.status !== "DRAFT") return jsonError(`Cannot submit a ${po.status} PO`, 409);
    const me = await prisma.user.findUnique({
      where: { id: userId },
      select: { managerId: true },
    });
    updateData = {
      status: "SUBMITTED",
      submittedAt: new Date(),
      approverId: po.approverId ?? me?.managerId ?? null,
    };
  } else if (action === "retract") {
    if (!isOwner) return jsonError("Forbidden", 403);
    if (po.status !== "SUBMITTED") return jsonError(`Cannot retract a ${po.status} PO`, 409);
    updateData = { status: "DRAFT", submittedAt: null };
  } else if (action === "approve" || action === "reject") {
    if (!isManager(session)) return jsonError("Forbidden", 403);
    if (po.requesterId === userId) return jsonError("You can't decide your own PO", 403);
    if (po.status !== "SUBMITTED") return jsonError(`Cannot decide a ${po.status} PO`, 409);
    updateData = {
      status: action === "approve" ? "APPROVED" : "REJECTED",
      approverId: userId,
      decisionAt: new Date(),
      decisionNote: note,
    };
  } else if (action === "send") {
    if (po.status !== "APPROVED") return jsonError(`Cannot send a ${po.status} PO`, 409);
    if (!isManager(session) && !isOwner) return jsonError("Forbidden", 403);
    updateData = { status: "SENT" };
  } else if (action === "receive") {
    if (po.status !== "SENT") return jsonError(`Cannot mark received on a ${po.status} PO`, 409);
    if (!isManager(session) && !isOwner) return jsonError("Forbidden", 403);
    updateData = { status: "RECEIVED", receivedAt: new Date() };
  } else if (action === "close") {
    if (po.status !== "RECEIVED" && po.status !== "REJECTED") {
      return jsonError(`Cannot close a ${po.status} PO`, 409);
    }
    if (!isManager(session) && !isOwner) return jsonError("Forbidden", 403);
    updateData = { status: "CLOSED" };
  } else {
    return jsonError("Unknown action");
  }

  const updated = await prisma.purchaseOrder.update({
    where: { id },
    data: updateData,
  });

  logActivity({
    type: `po_${action}`,
    actorId: userId,
    organizationId: orgId,
    description: `${action} on ${po.number}`,
    targetId: id,
    targetType: "purchase_order",
  });

  return jsonSuccess({ ...updated, amount: Number(updated.amount) });
}
