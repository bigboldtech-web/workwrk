// GET /api/tools/categories: the categories this workspace's tools use, for
// the category picker (a category is data, not a setting).

import { prisma } from "@/lib/prisma";
import { jsonSuccess } from "@/lib/api-helpers";
import { requireTools } from "@/lib/tools/tool-server";

export async function GET() {
  const v = await requireTools();
  if ("error" in v) return v.error;
  const rows = await prisma.tool.findMany({
    where: { organizationId: v.orgId, category: { not: null } },
    select: { category: true },
    distinct: ["category"],
    orderBy: { category: "asc" },
  });
  return jsonSuccess({ categories: rows.map((r) => r.category).filter((c): c is string => Boolean(c)) });
}
