import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionOrFail, getOrgId, getUserId, jsonError, jsonSuccess, isManager } from "@/lib/api-helpers";
import { logActivity } from "@/lib/activity";
import { parsePaginationParams, paginatedResult, skipTake } from "@/lib/pagination";

export async function GET(req: NextRequest) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;

  const { searchParams } = new URL(req.url);
  const category = searchParams.get("category");
  const status = searchParams.get("status");
  const kraId = searchParams.get("kraId");
  const pagination = parsePaginationParams(req);

  const where: any = { organizationId: getOrgId(session) };
  if (category) where.category = category;
  if (status) where.status = status;
  if (kraId) where.kraId = kraId;
  if (pagination.search) {
    where.OR = [
      { title: { contains: pagination.search, mode: "insensitive" } },
      { description: { contains: pagination.search, mode: "insensitive" } },
    ];
  }

  const [sops, total] = await Promise.all([
    prisma.sOP.findMany({
      where,
      select: {
        id: true, title: true, description: true, category: true, subcategory: true,
        sopType: true, version: true, status: true, shareToken: true,
        createdAt: true, updatedAt: true, publishedAt: true,
        _count: { select: { compliance: true } },
        kra: { select: { id: true, name: true } },
      },
      orderBy: { updatedAt: "desc" },
      ...skipTake(pagination),
    }),
    prisma.sOP.count({ where }),
  ]);

  return jsonSuccess(paginatedResult(sops, total, pagination));
}

export async function POST(req: NextRequest) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;
  if (!isManager(session)) return jsonError("Forbidden", 403);

  const body = await req.json();
  const { title, description, category, subcategory, content, kraId, sopType } = body;

  if (!title) return jsonError("SOP title is required");

  const sop = await prisma.sOP.create({
    data: {
      title,
      description,
      category,
      subcategory: subcategory || null,
      sopType: sopType || "WRITTEN",
      content: content || { steps: [] },
      organizationId: getOrgId(session),
      ...(kraId ? { kraId } : {}),
    },
  });

  logActivity({
    type: "sop_created",
    actorId: getUserId(session),
    organizationId: getOrgId(session),
    description: `Created SOP "${title}"`,
    targetId: sop.id,
    targetType: "sop",
    metadata: { category },
  });

  return jsonSuccess(sop, 201);
}
