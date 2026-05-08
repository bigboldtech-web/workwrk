// Invoice detail + actions. Approve / Reject / Pay flow:
//   PENDING → APPROVED  via action=approve
//   PENDING → REJECTED  via action=reject
//   APPROVED → PAID     via action=pay (records paidAt)

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
  if (!isManager(session)) return jsonError("Forbidden", 403);

  const { id } = await params;
  const orgId = getOrgId(session);

  const invoice = await prisma.invoice.findFirst({
    where: { id, organizationId: orgId },
    include: {
      vendor: true,
      approver: { select: { id: true, firstName: true, lastName: true } },
      purchaseOrder: { select: { id: true, number: true, amount: true, currency: true } },
    },
  });
  if (!invoice) return jsonError("Invoice not found", 404);
  return jsonSuccess({
    ...invoice,
    amount: Number(invoice.amount),
    purchaseOrder: invoice.purchaseOrder
      ? { ...invoice.purchaseOrder, amount: Number(invoice.purchaseOrder.amount) }
      : null,
  });
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;
  if (!isManager(session)) return jsonError("Forbidden", 403);

  const { id } = await params;
  const orgId = getOrgId(session);
  const userId = getUserId(session);

  const invoice = await prisma.invoice.findFirst({
    where: { id, organizationId: orgId },
  });
  if (!invoice) return jsonError("Invoice not found", 404);

  const body = await req.json();
  const action = typeof body.action === "string" ? body.action : null;
  const note = typeof body.note === "string" ? body.note.trim() || null : null;

  let updateData: Record<string, unknown> = {};
  if (action === "approve") {
    if (invoice.status !== "PENDING") return jsonError(`Cannot approve a ${invoice.status} invoice`, 409);
    updateData = {
      status: "APPROVED",
      approverId: userId,
      decisionAt: new Date(),
      decisionNote: note,
    };
  } else if (action === "reject") {
    if (invoice.status !== "PENDING") return jsonError(`Cannot reject a ${invoice.status} invoice`, 409);
    updateData = {
      status: "REJECTED",
      approverId: userId,
      decisionAt: new Date(),
      decisionNote: note,
    };
  } else if (action === "pay") {
    // Only org admin / finance can mark paid — the side that actually
    // disburses funds.
    if (!isOrgAdmin(session)) return jsonError("Forbidden — finance only", 403);
    if (invoice.status !== "APPROVED") return jsonError(`Cannot pay a ${invoice.status} invoice`, 409);
    updateData = { status: "PAID", paidAt: new Date() };
  } else if (!action) {
    // Field edits on PENDING only. Use sparingly — invoice fields
    // are usually authoritative once entered.
    if (invoice.status !== "PENDING") {
      return jsonError(`Cannot edit a ${invoice.status} invoice. Reject and re-enter if wrong.`, 409);
    }
    if (typeof body.notes === "string") updateData.notes = body.notes.trim() || null;
    if (body.dueDate) {
      const d = new Date(body.dueDate);
      if (Number.isNaN(d.getTime())) return jsonError("Invalid dueDate");
      updateData.dueDate = d;
    }
    if (Object.keys(updateData).length === 0) return jsonError("No changes");
  } else {
    return jsonError("Unknown action");
  }

  const updated = await prisma.invoice.update({ where: { id }, data: updateData });

  logActivity({
    type: action ? `invoice_${action}` : "invoice_updated",
    actorId: userId,
    organizationId: orgId,
    description: `${action ?? "edited"} invoice ${invoice.invoiceNumber}`,
    targetId: id,
    targetType: "invoice",
  });

  return jsonSuccess({ ...updated, amount: Number(updated.amount) });
}
