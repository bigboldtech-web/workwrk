import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionOrFail, getOrgId, isManager, jsonError, jsonSuccess } from "@/lib/api-helpers";

// GET: List all categories with subcategories
export async function GET() {
  const { error, session } = await getSessionOrFail();
  if (error) return error;

  const orgId = getOrgId(session);

  const categories = await prisma.sOPCategory.findMany({
    where: { organizationId: orgId },
    include: { subcategories: { orderBy: { name: "asc" } } },
    orderBy: { name: "asc" },
  });

  return jsonSuccess(categories);
}

// POST: Create category or subcategory
export async function POST(req: NextRequest) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;
  if (!isManager(session)) return jsonError("Forbidden", 403);

  const orgId = getOrgId(session);
  const body = await req.json();
  const { name, categoryId } = body;

  if (!name?.trim()) return jsonError("Name is required");

  // If categoryId is provided, create a subcategory
  if (categoryId) {
    const category = await prisma.sOPCategory.findFirst({
      where: { id: categoryId, organizationId: orgId },
    });
    if (!category) return jsonError("Category not found", 404);

    const existing = await prisma.sOPSubcategory.findUnique({
      where: { name_categoryId: { name: name.trim(), categoryId } },
    });
    if (existing) return jsonError("Subcategory already exists");

    const subcategory = await prisma.sOPSubcategory.create({
      data: { name: name.trim(), categoryId },
    });
    return jsonSuccess(subcategory, 201);
  }

  // Create a category
  const existing = await prisma.sOPCategory.findUnique({
    where: { name_organizationId: { name: name.trim(), organizationId: orgId } },
  });
  if (existing) return jsonError("Category already exists");

  const category = await prisma.sOPCategory.create({
    data: { name: name.trim(), organizationId: orgId },
    include: { subcategories: true },
  });

  return jsonSuccess(category, 201);
}

// DELETE: Delete category or subcategory
export async function DELETE(req: NextRequest) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;
  if (!isManager(session)) return jsonError("Forbidden", 403);

  const orgId = getOrgId(session);
  const { id, type } = await req.json();

  if (!id) return jsonError("ID is required");

  if (type === "subcategory") {
    await prisma.sOPSubcategory.delete({ where: { id } });
  } else {
    const cat = await prisma.sOPCategory.findFirst({
      where: { id, organizationId: orgId },
    });
    if (!cat) return jsonError("Category not found", 404);
    await prisma.sOPCategory.delete({ where: { id } });
  }

  return jsonSuccess({ message: "Deleted" });
}
