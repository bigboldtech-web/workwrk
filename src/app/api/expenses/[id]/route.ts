// Expense detail / edit / delete. Authorization rules:
//   GET    — reporter, approver, manager+, admin
//   PATCH  — reporter (DRAFT only), or manager+ (any)
//   DELETE — reporter (DRAFT only), or admin (any)
//
// Editing a SUBMITTED/APPROVED/REIMBURSED row is intentionally
// blocked from the reporter — they have to either retract (set
// back to DRAFT) or ask the approver. Decision flow is its own
// endpoint to keep the audit trail clean.

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

const VALID_CATEGORIES = new Set([
  "TRAVEL",
  "MEALS",
  "LODGING",
  "TRANSPORT",
  "SUPPLIES",
  "SUBSCRIPTION",
  "EQUIPMENT",
  "CLIENT_ENTERTAINMENT",
  "TRAINING",
  "OTHER",
]);

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;
  const { id } = await params;
  const orgId = getOrgId(session);
  const userId = getUserId(session);

  const expense = await prisma.expense.findFirst({
    where: { id, organizationId: orgId },
    include: {
      reporter: { select: { id: true, firstName: true, lastName: true, email: true } },
      approver: { select: { id: true, firstName: true, lastName: true, email: true } },
    },
  });
  if (!expense) return jsonError("Expense not found", 404);

  const canSee =
    expense.reporterId === userId ||
    expense.approverId === userId ||
    isManager(session);
  if (!canSee) return jsonError("Expense not found", 404);

  return jsonSuccess({ ...expense, amount: Number(expense.amount) });
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

  const existing = await prisma.expense.findFirst({
    where: { id, organizationId: orgId },
  });
  if (!existing) return jsonError("Expense not found", 404);

  const isOwner = existing.reporterId === userId;
  const canEdit = (isOwner && existing.status === "DRAFT") || isManager(session);
  if (!canEdit) {
    return jsonError(
      isOwner
        ? "Only DRAFT expenses can be edited. Ask your approver or retract first."
        : "Forbidden",
      403,
    );
  }

  const body = await req.json();
  const data: Record<string, unknown> = {};

  if (typeof body.description === "string") {
    const description = body.description.trim();
    if (!description) return jsonError("description cannot be empty");
    if (description.length > 200) return jsonError("description too long");
    data.description = description;
  }
  if (body.notes !== undefined) {
    data.notes = typeof body.notes === "string" ? body.notes.trim() || null : null;
  }
  if (typeof body.category === "string") {
    if (!VALID_CATEGORIES.has(body.category)) return jsonError("Invalid category");
    data.category = body.category;
  }
  if (body.amount !== undefined) {
    const num = typeof body.amount === "number" ? body.amount : Number(body.amount);
    if (!Number.isFinite(num) || num <= 0) return jsonError("Invalid amount");
    if (num > 9_999_999_999) return jsonError("amount exceeds the column limit");
    data.amount = num;
  }
  if (typeof body.currency === "string") {
    const cur = body.currency.trim().toUpperCase();
    if (cur.length !== 3) return jsonError("currency must be a 3-letter ISO code");
    data.currency = cur;
  }
  if (body.expenseDate) {
    const d = new Date(body.expenseDate);
    if (Number.isNaN(d.getTime())) return jsonError("Invalid expenseDate");
    data.expenseDate = d;
  }
  if (body.receiptUrl !== undefined) {
    data.receiptUrl = typeof body.receiptUrl === "string" ? body.receiptUrl.trim() || null : null;
  }

  // Submit transition: explicit submit=true flips DRAFT → SUBMITTED and
  // stamps submittedAt / approver. Any other status edit goes through
  // the /decision endpoint instead.
  if (body.submit === true && existing.status === "DRAFT") {
    data.status = "SUBMITTED";
    data.submittedAt = new Date();
    if (!existing.approverId) {
      const me = await prisma.user.findUnique({
        where: { id: existing.reporterId },
        select: { managerId: true },
      });
      if (me?.managerId) data.approverId = me.managerId;
    }
  }

  // Retract: SUBMITTED → DRAFT (reporter only, before any decision).
  if (body.retract === true && existing.status === "SUBMITTED" && isOwner) {
    data.status = "DRAFT";
    data.submittedAt = null;
    data.approverId = null;
  }

  if (Object.keys(data).length === 0) return jsonError("No changes");

  const updated = await prisma.expense.update({
    where: { id },
    data,
  });

  logActivity({
    type: "expense_updated",
    actorId: userId,
    organizationId: orgId,
    description: `Updated expense "${updated.description}"`,
    targetId: id,
    targetType: "expense",
  });

  return jsonSuccess({ ...updated, amount: Number(updated.amount) });
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

  const existing = await prisma.expense.findFirst({
    where: { id, organizationId: orgId },
  });
  if (!existing) return jsonError("Expense not found", 404);

  const canDelete =
    (existing.reporterId === userId && existing.status === "DRAFT") ||
    isOrgAdmin(session);
  if (!canDelete) {
    return jsonError(
      existing.status === "DRAFT" ? "Forbidden" : "Only DRAFT expenses can be deleted",
      403,
    );
  }

  await prisma.expense.delete({ where: { id } });

  logActivity({
    type: "expense_deleted",
    actorId: userId,
    organizationId: orgId,
    description: `Deleted expense "${existing.description}"`,
    targetId: id,
    targetType: "expense",
  });

  return jsonSuccess({ deleted: true });
}
