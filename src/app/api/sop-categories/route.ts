import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionOrFail, getOrgId, isManager, jsonError, jsonSuccess, LOOKUP_CACHE_HEADERS } from "@/lib/api-helpers";

// GET: List all categories with subcategories + per-name SOP counts.
//
// SOPs reference category/subcategory by *name* (strings), not FK IDs,
// so we aggregate with a groupBy over (category, subcategory) and fold
// the numbers onto each row by name match. Cheap: one extra query, and
// lets the category-manager UI show the admin how many SOPs each
// category/subcategory touches before they rename or delete it.
export async function GET() {
  const { error, session } = await getSessionOrFail();
  if (error) return error;

  const orgId = getOrgId(session);

  const [categories, sopCounts] = await Promise.all([
    prisma.sOPCategory.findMany({
      where: { organizationId: orgId },
      include: { subcategories: { orderBy: { name: "asc" } } },
      orderBy: { name: "asc" },
    }),
    prisma.sOP.groupBy({
      by: ["category", "subcategory"],
      where: { organizationId: orgId },
      _count: { _all: true },
    }),
  ]);

  // { "Marketing": { total: 12, sub: { "Email": 4, "Social": 3, _unassigned: 5 } } }
  const byName: Record<string, { total: number; sub: Record<string, number> }> = {};
  for (const row of sopCounts) {
    const cat = row.category || "_uncategorized";
    const sub = row.subcategory || "_unassigned";
    if (!byName[cat]) byName[cat] = { total: 0, sub: {} };
    byName[cat].total += row._count._all;
    byName[cat].sub[sub] = (byName[cat].sub[sub] || 0) + row._count._all;
  }

  const enriched = categories.map((c) => {
    const bucket = byName[c.name];
    return {
      ...c,
      sopCount: bucket?.total || 0,
      subcategories: c.subcategories.map((s) => ({
        ...s,
        sopCount: bucket?.sub[s.name] || 0,
      })),
    };
  });

  // Surface category strings observed on SOPs that don't have a matching
  // SOPCategory row yet (legacy / never-saved). Without this the filter
  // dropdown drops them whenever they fall off the current page.
  const savedNames = new Set(categories.map((c) => c.name));
  const ghostCategories = Object.entries(byName)
    .filter(([name]) => name !== "_uncategorized" && !savedNames.has(name))
    .map(([name, bucket]) => ({
      id: null,
      name,
      organizationId: orgId,
      sopCount: bucket.total,
      subcategories: Object.entries(bucket.sub)
        .filter(([sub]) => sub !== "_unassigned")
        .map(([sub, count]) => ({ id: null, name: sub, categoryId: null, sopCount: count })),
      unsaved: true,
    }));

  const all = [...enriched, ...ghostCategories].sort((a, b) => a.name.localeCompare(b.name));

  return jsonSuccess(all, 200, LOOKUP_CACHE_HEADERS);
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
