import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionOrFail, getOrgId, isManager, jsonError, jsonSuccess, LOOKUP_CACHE_HEADERS } from "@/lib/api-helpers";

export async function GET() {
  const { error, session } = await getSessionOrFail();
  if (error) return error;

  const orgId = getOrgId(session);
  const categories = await prisma.kraCategory.findMany({
    where: { organizationId: orgId },
    orderBy: { name: "asc" },
  });

  return jsonSuccess(categories, 200, LOOKUP_CACHE_HEADERS);
}

export async function POST(req: NextRequest) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;
  if (!isManager(session)) return jsonError("Forbidden", 403);

  const orgId = getOrgId(session);
  const { name } = await req.json();

  if (!name?.trim()) return jsonError("Category name is required");

  try {
    const category = await prisma.kraCategory.create({
      data: { name: name.trim(), organizationId: orgId },
    });
    return jsonSuccess(category, 201);
  } catch (err: unknown) {
    if ((err as { code?: string })?.code === "P2002") return jsonError("Category already exists");
    return jsonError("Couldn't create the category", 500);
  }
}

export async function DELETE(req: NextRequest) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;
  if (!isManager(session)) return jsonError("Forbidden", 403);

  const orgId = getOrgId(session);
  const body = await req.json().catch(() => ({}));
  // A plain id only: {"id":{"not":""}} deleted every category of the
  // workspace in one call (pen test 2026-11-28 review).
  const id = typeof body?.id === "string" ? body.id : "";

  if (!id) return jsonError("Category ID is required");

  await prisma.kraCategory.deleteMany({ where: { id, organizationId: orgId } });
  return jsonSuccess({ message: "Deleted" });
}

export async function PATCH(req: NextRequest) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;
  if (!isManager(session)) return jsonError("Forbidden", 403);

  const orgId = getOrgId(session);
  const body = await req.json().catch(() => ({}));
  const id = typeof body?.id === "string" ? body.id : "";
  const name = typeof body?.name === "string" ? body.name.trim() : "";

  if (!id || !name) return jsonError("ID and name are required");

  // The company wall (pen test 2026-11-28, V-05): the rename ran by id alone,
  // so one workspace renamed another's categories, and a failure handed back
  // the raw database message.
  const own = await prisma.kraCategory.findFirst({ where: { id, organizationId: orgId }, select: { id: true } });
  if (!own) return jsonError("Category not found", 404);

  try {
    const updated = await prisma.kraCategory.update({
      where: { id },
      data: { name },
    });
    return jsonSuccess(updated);
  } catch (err: unknown) {
    if ((err as { code?: string })?.code === "P2002") return jsonError("Category name already exists");
    return jsonError("Couldn't update the category", 500);
  }
}
