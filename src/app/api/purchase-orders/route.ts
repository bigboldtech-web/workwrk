// Purchase orders — list + create. Auto-generates a per-org sequential
// number on create.
//
// scope:
//   "mine"    → POs I requested
//   "approve" → SUBMITTED, assigned to me as approver (or open queue)
//   "all"     → manager+ org-wide

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
import { tagFilterIds } from "@/lib/tag-filter";

const VALID_STATUS = new Set(["DRAFT", "SUBMITTED", "APPROVED", "REJECTED", "SENT", "RECEIVED", "CLOSED"]);

async function nextPoNumber(orgId: string): Promise<string> {
  // Fortune-500 may have hundreds of thousands of POs; we read the
  // count once. createMany conflicts on the unique (orgId, number)
  // constraint are caught by the caller.
  const count = await prisma.purchaseOrder.count({ where: { organizationId: orgId } });
  return `PO-${String(count + 1).padStart(6, "0")}`;
}

export async function GET(req: NextRequest) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;

  const orgId = getOrgId(session);
  const userId = getUserId(session);
  const sp = new URL(req.url).searchParams;
  const scope = sp.get("scope") ?? "mine";
  const status = sp.get("status");
  const limit = Math.min(Math.max(1, Number(sp.get("limit") ?? 100)), 200);

  const where: Record<string, unknown> = { organizationId: orgId };
  if (scope === "mine") where.requesterId = userId;
  else if (scope === "approve") {
    if (!isManager(session)) return jsonError("Forbidden", 403);
    where.status = "SUBMITTED";
    where.OR = [{ approverId: userId }, { approverId: null }];
  } else if (scope === "all") {
    if (!isManager(session)) return jsonError("Forbidden", 403);
  } else {
    return jsonError("Invalid scope");
  }

  if (status) {
    if (!VALID_STATUS.has(status)) return jsonError("Invalid status");
    if (scope !== "approve") where.status = status;
  }

  const tagsRaw = sp.get("tags");
  if (tagsRaw) {
    const matched = await tagFilterIds({ organizationId: orgId, entityType: "PURCHASE_ORDER", tagsRaw });
    if (matched !== null) {
      if (matched.length === 0) return jsonSuccess([]);
      where.id = { in: matched };
    }
  }

  const pos = await prisma.purchaseOrder.findMany({
    where,
    orderBy: { createdAt: "desc" },
    take: limit,
    include: {
      vendor: { select: { id: true, name: true } },
      requester: { select: { id: true, firstName: true, lastName: true } },
      approver: { select: { id: true, firstName: true, lastName: true } },
      _count: { select: { invoices: true } },
    },
  });

  return jsonSuccess(pos.map((p) => ({ ...p, amount: Number(p.amount) })));
}

export async function POST(req: NextRequest) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;

  const body = await req.json();
  const vendorId = typeof body.vendorId === "string" ? body.vendorId : "";
  const description = typeof body.description === "string" ? body.description.trim() : "";
  const amountNum = Number(body.amount);
  const currency = (typeof body.currency === "string" ? body.currency.trim().toUpperCase() : "USD").slice(0, 3);
  const notes = typeof body.notes === "string" ? body.notes.trim() || null : null;
  const submit = body.submit === true;
  const expectedDeliveryDate = body.expectedDeliveryDate ? new Date(body.expectedDeliveryDate) : null;

  if (!vendorId) return jsonError("vendorId is required");
  if (!description) return jsonError("description is required");
  if (description.length > 1000) return jsonError("description too long");
  if (!Number.isFinite(amountNum) || amountNum <= 0) return jsonError("Invalid amount");
  if (amountNum > 9_999_999_999) return jsonError("amount exceeds limit");
  if (currency.length !== 3) return jsonError("currency must be 3-letter ISO");
  if (expectedDeliveryDate && Number.isNaN(expectedDeliveryDate.getTime())) {
    return jsonError("Invalid expectedDeliveryDate");
  }

  const orgId = getOrgId(session);
  const userId = getUserId(session);

  const vendor = await prisma.vendor.findFirst({
    where: { id: vendorId, organizationId: orgId, archived: false },
    select: { id: true, name: true },
  });
  if (!vendor) return jsonError("Vendor not found", 404);

  // Default approver = requester's manager when submitting.
  let approverId: string | null = null;
  if (submit) {
    const me = await prisma.user.findUnique({
      where: { id: userId },
      select: { managerId: true },
    });
    approverId = me?.managerId ?? null;
  }

  // Generate number with one retry on the rare unique-constraint race.
  let po;
  for (let attempt = 0; attempt < 3; attempt++) {
    const number = await nextPoNumber(orgId);
    try {
      po = await prisma.purchaseOrder.create({
        data: {
          organizationId: orgId,
          number,
          vendorId,
          requesterId: userId,
          approverId,
          description,
          amount: amountNum,
          currency,
          status: submit ? "SUBMITTED" : "DRAFT",
          expectedDeliveryDate,
          submittedAt: submit ? new Date() : null,
          notes,
        },
      });
      break;
    } catch {
      if (attempt === 2) throw new Error("Couldn't allocate PO number after 3 attempts");
    }
  }

  if (!po) return jsonError("Couldn't create PO");

  logActivity({
    type: submit ? "po_submitted" : "po_drafted",
    actorId: userId,
    organizationId: orgId,
    description: `${submit ? "Submitted" : "Drafted"} ${po.number} to ${vendor.name} (${currency} ${amountNum.toFixed(2)})`,
    targetId: po.id,
    targetType: "purchase_order",
  });

  return jsonSuccess({ ...po, amount: Number(po.amount) }, 201);
}
