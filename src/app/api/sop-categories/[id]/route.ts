import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  getSessionOrFail,
  getOrgId,
  isManager,
  jsonError,
  jsonSuccess,
} from "@/lib/api-helpers";

type Kind = "category" | "subcategory";

function isKind(v: unknown): v is Kind {
  return v === "category" || v === "subcategory";
}

// PATCH: rename a category or subcategory.
//
// Because SOPs store category/subcategory as *strings* (not FKs), we
// have to carry the rename over to every SOP that references the old
// name — otherwise the registry and the SOPs would drift apart. All of
// this happens in one transaction so a partial failure never leaves a
// half-renamed org.
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;
  if (!isManager(session)) return jsonError("Forbidden", 403);

  const orgId = getOrgId(session);
  const { id } = await params;
  const body = (await req.json()) as { name?: string; type?: Kind };
  const name = body.name?.trim();
  if (!name) return jsonError("Name is required");
  if (!isKind(body.type)) return jsonError("type must be 'category' or 'subcategory'");

  if (body.type === "category") {
    const existing = await prisma.sOPCategory.findFirst({
      where: { id, organizationId: orgId },
    });
    if (!existing) return jsonError("Category not found", 404);
    if (existing.name === name) return jsonSuccess(existing);

    // Prevent name collision with another category in the same org.
    const clash = await prisma.sOPCategory.findUnique({
      where: { name_organizationId: { name, organizationId: orgId } },
    });
    if (clash && clash.id !== id) return jsonError("A category with that name already exists");

    const oldName = existing.name;
    const [updated] = await prisma.$transaction([
      prisma.sOPCategory.update({ where: { id }, data: { name } }),
      prisma.sOP.updateMany({
        where: { organizationId: orgId, category: oldName },
        data: { category: name },
      }),
    ]);
    return jsonSuccess(updated);
  }

  // type === "subcategory"
  const existing = await prisma.sOPSubcategory.findFirst({
    where: { id },
    include: { category: true },
  });
  if (!existing) return jsonError("Subcategory not found", 404);
  if (existing.category.organizationId !== orgId) return jsonError("Forbidden", 403);
  if (existing.name === name) return jsonSuccess(existing);

  const clash = await prisma.sOPSubcategory.findUnique({
    where: { name_categoryId: { name, categoryId: existing.categoryId } },
  });
  if (clash && clash.id !== id) return jsonError("A subcategory with that name already exists in this category");

  const oldName = existing.name;
  const [updated] = await prisma.$transaction([
    prisma.sOPSubcategory.update({ where: { id }, data: { name } }),
    // Scope by the parent category's current name so we don't
    // accidentally touch an identically-named subcategory belonging to
    // a different category.
    prisma.sOP.updateMany({
      where: {
        organizationId: orgId,
        category: existing.category.name,
        subcategory: oldName,
      },
      data: { subcategory: name },
    }),
  ]);
  return jsonSuccess(updated);
}

// DELETE: remove a category or subcategory. Two modes via query string:
//   ?force=1 — null out matching SOP references first, then delete.
//   (default)— refuse if any SOPs still point at it, returning the count
//              so the UI can warn the user and ask for confirmation.
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;
  if (!isManager(session)) return jsonError("Forbidden", 403);

  const orgId = getOrgId(session);
  const { id } = await params;
  const url = new URL(req.url);
  const typeParam = url.searchParams.get("type");
  const force = url.searchParams.get("force") === "1";
  if (!isKind(typeParam)) return jsonError("type must be 'category' or 'subcategory'");

  if (typeParam === "category") {
    const cat = await prisma.sOPCategory.findFirst({
      where: { id, organizationId: orgId },
    });
    if (!cat) return jsonError("Category not found", 404);

    const usedCount = await prisma.sOP.count({
      where: { organizationId: orgId, category: cat.name },
    });
    if (usedCount > 0 && !force) {
      return jsonError(
        `${usedCount} SOP${usedCount === 1 ? "" : "s"} still use this category. Reassign them or delete with force.`,
        409,
      );
    }

    await prisma.$transaction([
      prisma.sOP.updateMany({
        where: { organizationId: orgId, category: cat.name },
        data: { category: null, subcategory: null },
      }),
      // Cascade handles SOPSubcategory rows via the model relation.
      prisma.sOPCategory.delete({ where: { id } }),
    ]);
    return jsonSuccess({ message: "Deleted", sopsUpdated: usedCount });
  }

  // subcategory
  const sub = await prisma.sOPSubcategory.findFirst({
    where: { id },
    include: { category: true },
  });
  if (!sub) return jsonError("Subcategory not found", 404);
  if (sub.category.organizationId !== orgId) return jsonError("Forbidden", 403);

  const usedCount = await prisma.sOP.count({
    where: {
      organizationId: orgId,
      category: sub.category.name,
      subcategory: sub.name,
    },
  });
  if (usedCount > 0 && !force) {
    return jsonError(
      `${usedCount} SOP${usedCount === 1 ? "" : "s"} still use this subcategory. Reassign them or delete with force.`,
      409,
    );
  }

  await prisma.$transaction([
    prisma.sOP.updateMany({
      where: {
        organizationId: orgId,
        category: sub.category.name,
        subcategory: sub.name,
      },
      data: { subcategory: null },
    }),
    prisma.sOPSubcategory.delete({ where: { id } }),
  ]);
  return jsonSuccess({ message: "Deleted", sopsUpdated: usedCount });
}
