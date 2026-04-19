import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { authenticate } from "@/lib/api-auth";

/** GET /api/v1/sops — list published (and optionally drafts) SOPs. */
export async function GET(req: NextRequest) {
  const { ctx, error } = await authenticate(req, "READ");
  if (error || !ctx) return error!;
  const url = new URL(req.url);
  const limit = Math.min(Math.max(parseInt(url.searchParams.get("limit") ?? "50", 10), 1), 200);
  const cursor = url.searchParams.get("cursor");
  const status = url.searchParams.get("status"); // PUBLISHED, DRAFT, IN_REVIEW, ARCHIVED
  const category = url.searchParams.get("category");
  const sopType = url.searchParams.get("sopType"); // WRITTEN, RECORDED, CHECKLIST, etc.

  const where: Record<string, unknown> = { organizationId: ctx.organizationId };
  if (status) where.status = status;
  else where.status = "PUBLISHED"; // default — API callers get the active catalogue
  if (category) where.category = category;
  if (sopType) where.sopType = sopType;

  const rows = await prisma.sOP.findMany({
    where,
    take: limit + 1,
    orderBy: { updatedAt: "desc" },
    ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
    select: {
      id: true,
      title: true,
      description: true,
      category: true,
      subcategory: true,
      sopType: true,
      version: true,
      status: true,
      kraId: true,
      publishedAt: true,
      createdAt: true,
      updatedAt: true,
      _count: { select: { compliance: true, assignments: true } },
    },
  });
  const hasMore = rows.length > limit;
  const data = hasMore ? rows.slice(0, limit) : rows;
  return Response.json({
    data,
    nextCursor: hasMore ? data[data.length - 1].id : null,
  });
}
