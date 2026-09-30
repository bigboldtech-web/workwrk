// Offices: GET is the lookup every picker reads (any signed-in person of
// the org); POST, PATCH and DELETE are Structure > Offices, on that page's
// rule (an Owner or an Admin, the account re-read), never the manager tier.
import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionOrFail, getOrgId, getUserId, jsonError, jsonSuccess, LOOKUP_CACHE_HEADERS } from "@/lib/api-helpers";
import { settingsWriteGate } from "@/lib/access/settings-write";
import { logActivity } from "@/lib/activity";
import { z } from "zod";

const optText = (max: number) => z.string().trim().max(max).nullable().optional().transform((v) => (v === "" ? null : v));
const officePatchSchema = z.strictObject({
  id: z.string().min(1).max(64),
  name: z.string().trim().min(1, "Office name is required").max(120).optional(),
  address: optText(300),
  city: optText(120),
  state: optText(120),
  country: optText(120),
  timezone: optText(64),
  isHeadquarters: z.boolean().optional(),
});

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
  // Structure > Offices is the one screen that writes offices, and it is an
  // Owner and Admin page: the page rule, the actor re-read (settings-write.ts).
  const writeGate = await settingsWriteGate(session, "structure");
  if (!writeGate.ok) return writeGate.response;

  const orgId = getOrgId(session);
  const body = (await req.json().catch(() => null)) ?? {};
  const { name, address, city, state, country, timezone, isHeadquarters } = body as Record<string, string | boolean | undefined>;

  if (typeof name !== "string" || !name.trim()) return jsonError("Office name is required");

  if (isHeadquarters === true) {
    await prisma.office.updateMany({ where: { organizationId: orgId }, data: { isHeadquarters: false } });
  }
  const office = await prisma.office.create({
    data: {
      name: name.trim().slice(0, 120),
      address: typeof address === "string" && address ? address.slice(0, 300) : null,
      city: typeof city === "string" && city ? city.slice(0, 120) : null,
      state: typeof state === "string" && state ? state.slice(0, 120) : null,
      country: typeof country === "string" && country ? country.slice(0, 120) : null,
      timezone: typeof timezone === "string" && timezone ? timezone.slice(0, 64) : null,
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
  // Structure > Offices is the one screen that writes offices, and it is an
  // Owner and Admin page: the page rule, the actor re-read (settings-write.ts).
  const writeGate = await settingsWriteGate(session, "structure");
  if (!writeGate.ok) return writeGate.response;

  const orgId = getOrgId(session);
  const body = await req.json().catch(() => null);
  // A WHITELIST of the office's own fields. The body used to be passed to
  // prisma as-is, so a PATCH could set organizationId and move an office
  // into another workspace.
  const parsed = officePatchSchema.safeParse(body);
  if (!parsed.success) return jsonError(parsed.error.issues[0]?.message ?? "Invalid office", 400);
  const { id, ...updates } = parsed.data;

  const existing = await prisma.office.findFirst({
    where: { id, organizationId: orgId },
  });
  if (!existing) return jsonError("Office not found", 404);

  const office = await prisma.$transaction(async (tx) => {
    // One headquarters: marking this one clears the others.
    if (updates.isHeadquarters === true) {
      await tx.office.updateMany({ where: { organizationId: orgId, id: { not: id } }, data: { isHeadquarters: false } });
    }
    return tx.office.update({ where: { id }, data: updates });
  });

  logActivity({
    type: "office_updated",
    actorId: getUserId(session),
    organizationId: orgId,
    description: `Updated office "${office.name}"`,
    targetId: office.id,
    targetType: "office",
    metadata: { keys: Object.keys(updates) },
  });

  return jsonSuccess(office);
}

export async function DELETE(req: NextRequest) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;
  // Structure > Offices is the one screen that writes offices, and it is an
  // Owner and Admin page: the page rule, the actor re-read (settings-write.ts).
  const writeGate = await settingsWriteGate(session, "structure");
  if (!writeGate.ok) return writeGate.response;

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
