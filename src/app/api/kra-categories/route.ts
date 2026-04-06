import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionOrFail, getOrgId, isManager, jsonError, jsonSuccess } from "@/lib/api-helpers";

export async function GET() {
  const { error, session } = await getSessionOrFail();
  if (error) return error;

  const orgId = getOrgId(session);
  const categories = await prisma.kraCategory.findMany({
    where: { organizationId: orgId },
    orderBy: { name: "asc" },
  });

  return jsonSuccess(categories);
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
  } catch (err: any) {
    if (err.code === "P2002") return jsonError("Category already exists");
    return jsonError(err.message || "Failed to create category", 500);
  }
}

export async function DELETE(req: NextRequest) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;
  if (!isManager(session)) return jsonError("Forbidden", 403);

  const orgId = getOrgId(session);
  const { id } = await req.json();

  if (!id) return jsonError("Category ID is required");

  await prisma.kraCategory.deleteMany({ where: { id, organizationId: orgId } });
  return jsonSuccess({ message: "Deleted" });
}

export async function PATCH(req: NextRequest) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;
  if (!isManager(session)) return jsonError("Forbidden", 403);

  const orgId = getOrgId(session);
  const { id, name } = await req.json();

  if (!id || !name?.trim()) return jsonError("ID and name are required");

  try {
    const updated = await prisma.kraCategory.update({
      where: { id },
      data: { name: name.trim() },
    });
    return jsonSuccess(updated);
  } catch (err: any) {
    if (err.code === "P2002") return jsonError("Category name already exists");
    return jsonError(err.message || "Failed to update category", 500);
  }
}
