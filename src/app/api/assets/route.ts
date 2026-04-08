import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionOrFail, getOrgId, isManager, jsonError, jsonSuccess, requirePermission } from "@/lib/api-helpers";

export async function GET(req: NextRequest) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;

  const orgId = getOrgId(session);
  const { searchParams } = new URL(req.url);
  const status = searchParams.get("status");
  const type = searchParams.get("type");
  const assignedToId = searchParams.get("assignedToId");
  const search = searchParams.get("search");

  const where: any = { organizationId: orgId };
  if (status) where.status = status;
  if (type) where.type = type;
  if (assignedToId) where.assignedToId = assignedToId;
  if (search) {
    where.OR = [
      { name: { contains: search, mode: "insensitive" } },
      { brand: { contains: search, mode: "insensitive" } },
      { model: { contains: search, mode: "insensitive" } },
      { serialNumber: { contains: search, mode: "insensitive" } },
      { imeiNumber: { contains: search, mode: "insensitive" } },
    ];
  }

  const assets = await prisma.asset.findMany({
    where,
    include: {
      assignedTo: { select: { id: true, firstName: true, lastName: true, avatar: true, department: { select: { name: true } } } },
    },
    orderBy: { createdAt: "desc" },
  });

  return jsonSuccess(assets);
}

export async function POST(req: NextRequest) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;
  const denied = await requirePermission(session, "assets", "create");
  if (denied) return denied;

  const orgId = getOrgId(session);
  const body = await req.json();
  const { name, type, brand, model, serialNumber, imeiNumber, purchaseDate, purchaseCost, warrantyExpiry, condition, notes, assignedToId } = body;

  if (!name?.trim() || !type) return jsonError("Name and type are required");

  const asset = await prisma.asset.create({
    data: {
      name: name.trim(),
      type,
      brand: brand || null,
      model: model || null,
      serialNumber: serialNumber || null,
      imeiNumber: imeiNumber || null,
      purchaseDate: purchaseDate ? new Date(purchaseDate) : null,
      purchaseCost: purchaseCost ? parseFloat(purchaseCost) : null,
      warrantyExpiry: warrantyExpiry ? new Date(warrantyExpiry) : null,
      condition: condition || "GOOD",
      notes: notes || null,
      status: assignedToId ? "ASSIGNED" : "AVAILABLE",
      assignedToId: assignedToId || null,
      assignedAt: assignedToId ? new Date() : null,
      organizationId: orgId,
    },
    include: {
      assignedTo: { select: { id: true, firstName: true, lastName: true } },
    },
  });

  // Notify if assigned at creation
  if (assignedToId) {
    await prisma.notification.create({
      data: {
        userId: assignedToId,
        type: "asset_assigned",
        title: "Asset Assigned",
        message: `You have been assigned: ${asset.name}${asset.serialNumber ? ` (S/N: ${asset.serialNumber})` : ""}`,
        link: "/people/" + assignedToId,
      },
    });
  }

  return jsonSuccess(asset, 201);
}
