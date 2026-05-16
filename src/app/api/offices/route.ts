import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionOrFail, getOrgId, getUserId, isManager, jsonError, jsonSuccess, LOOKUP_CACHE_HEADERS } from "@/lib/api-helpers";
import { logActivity } from "@/lib/activity";

export async function GET() {
  const { error, session } = await getSessionOrFail();
  if (error) return error;

  const orgId = getOrgId(session);

  const offices = await prisma.office.findMany({
    where: { organizationId: orgId },
    include: { _count: { select: { members: true } } },
    orderBy: [{ isHeadquarters: "desc" }, { name: "asc" }],
  });

  return jsonSuccess(offices, 200, LOOKUP_CACHE_HEADERS);
}

export async function POST(req: NextRequest) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;
  if (!isManager(session)) return jsonError("Forbidden", 403);

  const orgId = getOrgId(session);
  const body = await req.json();
  const { name, address, city, state, country, timezone, isHeadquarters } = body;

  if (!name?.trim()) return jsonError("Office name is required");

  const office = await prisma.office.create({
    data: {
      name: name.trim(),
      address: address || null,
      city: city || null,
      state: state || null,
      country: country || null,
      timezone: timezone || null,
      isHeadquarters: isHeadquarters === true,
      organizationId: orgId,
    },
  });

  logActivity({
    type: "office_created",
    actorId: getUserId(session),
    organizationId: orgId,
    description: `Added office "${office.name}"${office.isHeadquarters ? " (HQ)" : ""}`,
    targetId: office.id,
    targetType: "office",
  });

  return jsonSuccess(office, 201);
}

export async function PATCH(req: NextRequest) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;
  if (!isManager(session)) return jsonError("Forbidden", 403);

  const orgId = getOrgId(session);
  const body = await req.json();
  const { id, ...updates } = body;

  if (!id) return jsonError("Office ID required");

  const existing = await prisma.office.findFirst({
    where: { id, organizationId: orgId },
  });
  if (!existing) return jsonError("Office not found", 404);

  const office = await prisma.office.update({
    where: { id },
    data: updates,
  });

  return jsonSuccess(office);
}

export async function DELETE(req: NextRequest) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;
  if (!isManager(session)) return jsonError("Forbidden", 403);

  const orgId = getOrgId(session);
  const { id } = await req.json();

  if (!id) return jsonError("Office ID required");

  const existing = await prisma.office.findFirst({
    where: { id, organizationId: orgId },
    include: { _count: { select: { members: true } } },
  });
  if (!existing) return jsonError("Office not found", 404);
  if (existing._count.members > 0) return jsonError("Cannot delete office with assigned members");

  await prisma.office.delete({ where: { id } });

  logActivity({
    type: "office_deleted",
    actorId: getUserId(session),
    organizationId: orgId,
    description: `Deleted office "${existing.name}"`,
    targetId: id,
    targetType: "office",
  });

  return jsonSuccess({ message: "Office deleted" });
}
