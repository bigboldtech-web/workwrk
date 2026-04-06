import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionOrFail, getOrgId, isManager, jsonError, jsonSuccess } from "@/lib/api-helpers";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;

  const { id } = await params;
  const asset = await prisma.asset.findFirst({
    where: { id, organizationId: getOrgId(session) },
    include: {
      assignedTo: { select: { id: true, firstName: true, lastName: true, avatar: true, department: { select: { name: true } } } },
    },
  });

  if (!asset) return jsonError("Asset not found", 404);
  return jsonSuccess(asset);
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;
  if (!isManager(session)) return jsonError("Forbidden", 403);

  const { id } = await params;
  const orgId = getOrgId(session);
  const body = await req.json();

  const existing = await prisma.asset.findFirst({ where: { id, organizationId: orgId } });
  if (!existing) return jsonError("Asset not found", 404);

  const data: any = {};
  if (body.name !== undefined) data.name = body.name;
  if (body.type !== undefined) data.type = body.type;
  if (body.brand !== undefined) data.brand = body.brand || null;
  if (body.model !== undefined) data.model = body.model || null;
  if (body.serialNumber !== undefined) data.serialNumber = body.serialNumber || null;
  if (body.imeiNumber !== undefined) data.imeiNumber = body.imeiNumber || null;
  if (body.purchaseDate !== undefined) data.purchaseDate = body.purchaseDate ? new Date(body.purchaseDate) : null;
  if (body.purchaseCost !== undefined) data.purchaseCost = body.purchaseCost ? parseFloat(body.purchaseCost) : null;
  if (body.warrantyExpiry !== undefined) data.warrantyExpiry = body.warrantyExpiry ? new Date(body.warrantyExpiry) : null;
  if (body.condition !== undefined) data.condition = body.condition;
  if (body.notes !== undefined) data.notes = body.notes || null;
  if (body.status !== undefined) data.status = body.status;

  // Handle assignment/unassignment
  if (body.assignedToId !== undefined) {
    if (body.assignedToId) {
      data.assignedToId = body.assignedToId;
      data.assignedAt = new Date();
      data.returnedAt = null;
      data.status = "ASSIGNED";
    } else {
      data.assignedToId = null;
      data.returnedAt = new Date();
      data.assignedAt = null;
      if (!body.status) data.status = "AVAILABLE";
    }
  }

  const updated = await prisma.asset.update({
    where: { id },
    data,
    include: {
      assignedTo: { select: { id: true, firstName: true, lastName: true } },
    },
  });

  return jsonSuccess(updated);
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;
  if (!isManager(session)) return jsonError("Forbidden", 403);

  const { id } = await params;
  await prisma.asset.deleteMany({ where: { id, organizationId: getOrgId(session) } });
  return jsonSuccess({ message: "Asset deleted" });
}
