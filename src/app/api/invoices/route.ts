// Invoices — list + create. Manager+ only. Optional link to a PO.

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

const VALID_STATUS = new Set(["PENDING", "APPROVED", "REJECTED", "PAID"]);

export async function GET(req: NextRequest) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;
  if (!isManager(session)) return jsonError("Forbidden", 403);

  const orgId = getOrgId(session);
  const sp = new URL(req.url).searchParams;
  const status = sp.get("status");
  const dueWithin = sp.get("dueWithin"); // days
  const limit = Math.min(Math.max(1, Number(sp.get("limit") ?? 100)), 200);

  const where: Record<string, unknown> = { organizationId: orgId };
  if (status) {
    if (!VALID_STATUS.has(status)) return jsonError("Invalid status");
    where.status = status;
  }
  if (dueWithin) {
    const days = Number(dueWithin);
    if (Number.isFinite(days)) {
      where.dueDate = { lte: new Date(Date.now() + days * 24 * 3600 * 1000) };
    }
  }

  const invoices = await prisma.invoice.findMany({
    where,
    orderBy: [{ dueDate: "asc" }, { createdAt: "desc" }],
    take: limit,
    include: {
      vendor: { select: { id: true, name: true } },
      approver: { select: { id: true, firstName: true, lastName: true } },
      purchaseOrder: { select: { id: true, number: true } },
    },
  });
  return jsonSuccess(invoices.map((i) => ({ ...i, amount: Number(i.amount) })));
}

export async function POST(req: NextRequest) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;
  if (!isManager(session)) return jsonError("Forbidden", 403);

  const body = await req.json();
  const vendorId = typeof body.vendorId === "string" ? body.vendorId : "";
  const purchaseOrderId = typeof body.purchaseOrderId === "string" && body.purchaseOrderId
    ? body.purchaseOrderId
    : null;
  const invoiceNumber = typeof body.invoiceNumber === "string" ? body.invoiceNumber.trim() : "";
  const amountNum = Number(body.amount);
  const currency = (typeof body.currency === "string" ? body.currency.trim().toUpperCase() : "USD").slice(0, 3);
  const issueDate = body.issueDate ? new Date(body.issueDate) : null;
  const dueDate = body.dueDate ? new Date(body.dueDate) : null;
  const notes = typeof body.notes === "string" ? body.notes.trim() || null : null;

  if (!vendorId) return jsonError("vendorId is required");
  if (!invoiceNumber) return jsonError("invoiceNumber is required");
  if (!Number.isFinite(amountNum) || amountNum <= 0) return jsonError("Invalid amount");
  if (currency.length !== 3) return jsonError("currency must be 3-letter ISO");
  if (!issueDate || Number.isNaN(issueDate.getTime())) return jsonError("Invalid issueDate");
  if (!dueDate || Number.isNaN(dueDate.getTime())) return jsonError("Invalid dueDate");

  const orgId = getOrgId(session);
  const userId = getUserId(session);

  const vendor = await prisma.vendor.findFirst({
    where: { id: vendorId, organizationId: orgId },
    select: { id: true, name: true },
  });
  if (!vendor) return jsonError("Vendor not found", 404);

  if (purchaseOrderId) {
    const po = await prisma.purchaseOrder.findFirst({
      where: { id: purchaseOrderId, organizationId: orgId, vendorId },
      select: { id: true },
    });
    if (!po) return jsonError("PO not found or vendor mismatch", 404);
  }

  // Unique on (org, vendor, invoiceNumber) — duplicate invoice from
  // same vendor with same number is a real-world fraud signal we
  // catch here.
  const existing = await prisma.invoice.findUnique({
    where: {
      organizationId_vendorId_invoiceNumber: {
        organizationId: orgId,
        vendorId,
        invoiceNumber,
      },
    },
    select: { id: true },
  });
  if (existing) return jsonError("Invoice number already exists for this vendor", 409);

  const invoice = await prisma.invoice.create({
    data: {
      organizationId: orgId,
      vendorId,
      purchaseOrderId,
      invoiceNumber,
      amount: amountNum,
      currency,
      issueDate,
      dueDate,
      notes,
    },
  });

  logActivity({
    type: "invoice_created",
    actorId: userId,
    organizationId: orgId,
    description: `Recorded invoice ${invoiceNumber} from ${vendor.name} (${currency} ${amountNum.toFixed(2)})`,
    targetId: invoice.id,
    targetType: "invoice",
  });

  return jsonSuccess({ ...invoice, amount: Number(invoice.amount) }, 201);
}
