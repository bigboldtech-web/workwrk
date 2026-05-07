// Expenses — list + create. Scope is per-org with role-aware filtering:
//   employee        → own expenses only
//   manager+        → own + direct reports + (filtered) own queue as approver
//   org admin       → everything
//
// At Fortune-500 volume an org could carry millions of expense rows.
// Every query is bounded (`take`) and paginated; the indexes on
// (organizationId, status), (reporterId, status), and
// (approverId, status) cover the hot filter combos.

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

const VALID_STATUSES = new Set([
  "DRAFT",
  "SUBMITTED",
  "APPROVED",
  "REJECTED",
  "REIMBURSED",
]);

const PAGE_SIZE_DEFAULT = 50;
const PAGE_SIZE_MAX = 200;

export async function GET(req: NextRequest) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;

  const orgId = getOrgId(session);
  const userId = getUserId(session);
  const sp = new URL(req.url).searchParams;

  // scope:
  //   "mine"         → reporterId = me
  //   "approve"      → SUBMITTED waiting on me as approver  (or any manager
  //                    if no specific approver is set)
  //   "all"          → org-wide (admins / managers depending on UX choice)
  // Default "mine" — least-surprise for an employee opening /expenses.
  const scope = sp.get("scope") ?? "mine";
  const status = sp.get("status");
  const category = sp.get("category");
  const startDate = sp.get("startDate");
  const endDate = sp.get("endDate");
  const search = sp.get("q")?.trim() ?? "";
  const cursor = sp.get("cursor");
  const limit = Math.min(
    Math.max(1, Number(sp.get("limit") ?? PAGE_SIZE_DEFAULT)),
    PAGE_SIZE_MAX,
  );

  const where: Record<string, unknown> = { organizationId: orgId };

  if (scope === "mine") {
    where.reporterId = userId;
  } else if (scope === "approve") {
    if (!isManager(session)) return jsonError("Forbidden", 403);
    where.status = "SUBMITTED";
    // If a specific approver was assigned at submission time, filter to
    // me; otherwise expose to any manager (org-wide approval queue).
    where.OR = [{ approverId: userId }, { approverId: null }];
  } else if (scope === "all") {
    if (!isOrgAdmin(session) && !isManager(session)) {
      return jsonError("Forbidden", 403);
    }
  } else {
    return jsonError("Invalid scope");
  }

  if (status) {
    if (!VALID_STATUSES.has(status)) return jsonError("Invalid status");
    // `approve` already pins status; allow further narrowing only when
    // it's a no-op or compatible.
    if (scope === "approve" && status !== "SUBMITTED") {
      return jsonError("approve scope only returns SUBMITTED");
    }
    where.status = status;
  }
  if (category) {
    if (!VALID_CATEGORIES.has(category)) return jsonError("Invalid category");
    where.category = category;
  }
  if (startDate || endDate) {
    const dateFilter: Record<string, Date> = {};
    if (startDate) dateFilter.gte = new Date(startDate);
    if (endDate) dateFilter.lte = new Date(endDate);
    where.expenseDate = dateFilter;
  }
  if (search) {
    where.description = { contains: search, mode: "insensitive" };
  }

  const items = await prisma.expense.findMany({
    where,
    orderBy: [{ expenseDate: "desc" }, { id: "desc" }],
    take: limit + 1,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    select: {
      id: true,
      description: true,
      category: true,
      amount: true,
      currency: true,
      status: true,
      expenseDate: true,
      submittedAt: true,
      decisionAt: true,
      receiptUrl: true,
      reporter: { select: { id: true, firstName: true, lastName: true } },
      approver: { select: { id: true, firstName: true, lastName: true } },
    },
  });

  const hasMore = items.length > limit;
  const page = hasMore ? items.slice(0, limit) : items;
  // Decimal serializes as a string — normalize to Number for the wire,
  // which is fine up to about $1e15 (we cap at 12 digits in schema).
  const serialized = page.map((e) => ({ ...e, amount: Number(e.amount) }));

  return jsonSuccess({
    items: serialized,
    nextCursor: hasMore ? page[page.length - 1]?.id ?? null : null,
  });
}

export async function POST(req: NextRequest) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;

  const body = await req.json();
  const description = typeof body.description === "string" ? body.description.trim() : "";
  const notes = typeof body.notes === "string" ? body.notes.trim() || null : null;
  const category = typeof body.category === "string" ? body.category : "";
  const currency = typeof body.currency === "string" ? body.currency.trim().toUpperCase() : "USD";
  const expenseDate = body.expenseDate ? new Date(body.expenseDate) : null;
  const receiptUrl = typeof body.receiptUrl === "string" ? body.receiptUrl.trim() || null : null;
  const submit = body.submit === true;

  if (!description) return jsonError("description is required");
  if (description.length > 200) return jsonError("description too long (max 200)");
  if (!VALID_CATEGORIES.has(category)) return jsonError("Invalid category");
  if (!expenseDate || Number.isNaN(expenseDate.getTime())) {
    return jsonError("expenseDate is required");
  }
  if (currency.length !== 3) return jsonError("currency must be a 3-letter ISO code");

  const amountRaw = body.amount;
  const amountNum = typeof amountRaw === "number" ? amountRaw : Number(amountRaw);
  if (!Number.isFinite(amountNum) || amountNum <= 0) {
    return jsonError("amount must be a positive number");
  }
  if (amountNum > 9_999_999_999) {
    return jsonError("amount exceeds the column limit");
  }

  const orgId = getOrgId(session);
  const userId = getUserId(session);

  // Approver inference: if the reporter has a manager, default to that.
  // Submitted expenses without a manager fall to the open approval queue
  // (any manager can pick them up).
  let approverId: string | null = null;
  if (submit) {
    const me = await prisma.user.findUnique({
      where: { id: userId },
      select: { managerId: true },
    });
    approverId = me?.managerId ?? null;
  }

  const expense = await prisma.expense.create({
    data: {
      organizationId: orgId,
      reporterId: userId,
      description,
      notes,
      category: category as never,
      amount: amountNum,
      currency,
      expenseDate,
      receiptUrl,
      status: submit ? "SUBMITTED" : "DRAFT",
      submittedAt: submit ? new Date() : null,
      approverId,
    },
  });

  logActivity({
    type: submit ? "expense_submitted" : "expense_drafted",
    actorId: userId,
    organizationId: orgId,
    description: `${submit ? "Submitted" : "Drafted"} expense "${description}" (${currency} ${amountNum.toFixed(2)})`,
    targetId: expense.id,
    targetType: "expense",
  });

  return jsonSuccess({ ...expense, amount: Number(expense.amount) }, 201);
}
