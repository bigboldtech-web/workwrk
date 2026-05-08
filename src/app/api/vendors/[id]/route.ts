// Vendor edit / archive / delete. Soft-archive when the vendor has
// any related POs or invoices; hard-delete only when truly orphaned.

import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  getSessionOrFail,
  getOrgId,
  jsonError,
  jsonSuccess,
  isManager,
  isOrgAdmin,
} from "@/lib/api-helpers";

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;
  if (!isManager(session)) return jsonError("Forbidden", 403);

  const { id } = await params;
  const orgId = getOrgId(session);

  const vendor = await prisma.vendor.findFirst({ where: { id, organizationId: orgId } });
  if (!vendor) return jsonError("Vendor not found", 404);

  const body = await req.json();
  const data: Record<string, unknown> = {};

  if (typeof body.name === "string") {
    const name = body.name.trim();
    if (!name) return jsonError("name cannot be empty");
    data.name = name;
  }
  if (body.email !== undefined) data.email = typeof body.email === "string" ? body.email.trim().toLowerCase() || null : null;
  if (body.contactName !== undefined) data.contactName = typeof body.contactName === "string" ? body.contactName.trim() || null : null;
  if (body.phone !== undefined) data.phone = typeof body.phone === "string" ? body.phone.trim() || null : null;
  if (body.taxId !== undefined) data.taxId = typeof body.taxId === "string" ? body.taxId.trim() || null : null;
  if (body.paymentTermsDays !== undefined) {
    const num = Number(body.paymentTermsDays);
    if (!Number.isFinite(num) || num < 0 || num > 365) return jsonError("Invalid paymentTermsDays");
    data.paymentTermsDays = num;
  }
  if (typeof body.archived === "boolean") data.archived = body.archived;

  if (Object.keys(data).length === 0) return jsonError("No changes");

  const updated = await prisma.vendor.update({ where: { id }, data });
  return jsonSuccess(updated);
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;
  if (!isOrgAdmin(session)) return jsonError("Forbidden", 403);

  const { id } = await params;
  const orgId = getOrgId(session);

  const vendor = await prisma.vendor.findFirst({
    where: { id, organizationId: orgId },
    include: { _count: { select: { purchaseOrders: true, invoices: true } } },
  });
  if (!vendor) return jsonError("Vendor not found", 404);
  if (vendor._count.purchaseOrders > 0 || vendor._count.invoices > 0) {
    return jsonError("Vendor has POs / invoices. Archive instead.", 409);
  }

  await prisma.vendor.delete({ where: { id } });
  return jsonSuccess({ deleted: true });
}
