// Vendors — list + create. Manager+ only (vendor roster shapes
// downstream finance reporting; not employee-readable).

import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { logActivity } from "@/lib/activity";
import {
  getSessionOrFail,
  getOrgId,
  getUserId,
  jsonError,
  jsonSuccess,
  isManager,
} from "@/lib/api-helpers";

export async function GET(req: NextRequest) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;
  if (!isManager(session)) return jsonError("Forbidden", 403);

  const orgId = getOrgId(session);
  const sp = new URL(req.url).searchParams;
  const includeArchived = sp.get("includeArchived") === "1";
  const search = sp.get("q")?.trim() ?? "";

  const where: Record<string, unknown> = { organizationId: orgId };
  if (!includeArchived) where.archived = false;
  if (search) where.name = { contains: search, mode: "insensitive" };

  const vendors = await prisma.vendor.findMany({
    where,
    orderBy: [{ archived: "asc" }, { name: "asc" }],
    take: 200,
    include: { _count: { select: { purchaseOrders: true, invoices: true } } },
  });
  return jsonSuccess(vendors);
}

export async function POST(req: NextRequest) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;
  if (!isManager(session)) return jsonError("Forbidden", 403);

  const body = await req.json();
  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (!name) return jsonError("name is required");
  if (name.length > 200) return jsonError("name too long");

  const orgId = getOrgId(session);

  const existing = await prisma.vendor.findUnique({
    where: { organizationId_name: { organizationId: orgId, name } },
    select: { id: true, archived: true },
  });
  if (existing) {
    if (existing.archived) {
      const reactivated = await prisma.vendor.update({
        where: { id: existing.id },
        data: { archived: false },
      });
      return jsonSuccess(reactivated, 200);
    }
    return jsonError("Vendor with that name exists", 409);
  }

  const paymentTermsDays = body.paymentTermsDays === undefined
    ? 30
    : Math.max(0, Math.min(365, Number(body.paymentTermsDays) || 30));

  const vendor = await prisma.vendor.create({
    data: {
      organizationId: orgId,
      name,
      email: typeof body.email === "string" ? body.email.trim().toLowerCase() || null : null,
      contactName: typeof body.contactName === "string" ? body.contactName.trim() || null : null,
      phone: typeof body.phone === "string" ? body.phone.trim() || null : null,
      taxId: typeof body.taxId === "string" ? body.taxId.trim() || null : null,
      paymentTermsDays,
    },
  });

  // Audit-log vendor creation — procurement events feed downstream
  // PO + invoice approvals, so this is the right place to anchor the
  // trail for "where did this vendor come from."
  logActivity({
    type: "vendor.create",
    actorId: getUserId(session),
    organizationId: orgId,
    description: `Created vendor: ${vendor.name}`,
    targetId: vendor.id,
    targetType: "Vendor",
    metadata: { name: vendor.name, email: vendor.email, paymentTermsDays },
  });

  return jsonSuccess(vendor, 201);
}
