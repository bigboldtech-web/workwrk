import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { authenticate } from "@/lib/api-auth";

/** GET /api/v1/kras — list; POST — create. */
export async function GET(req: NextRequest) {
  const { ctx, error } = await authenticate(req, "READ");
  if (error || !ctx) return error!;
  const url = new URL(req.url);
  const limit = Math.min(Math.max(parseInt(url.searchParams.get("limit") ?? "50", 10), 1), 200);
  const cursor = url.searchParams.get("cursor");
  const roleId = url.searchParams.get("roleId");

  const where: Record<string, unknown> = { organizationId: ctx.organizationId };
  if (roleId) where.roleId = roleId;

  const rows = await prisma.kRA.findMany({
    where,
    take: limit + 1,
    orderBy: { createdAt: "asc" },
    ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
    select: {
      id: true,
      name: true,
      description: true,
      category: true,
      roleId: true,
      role: { select: { id: true, title: true } },
      createdAt: true,
      _count: { select: { kpis: true, assignments: true } },
    },
  });
  const hasMore = rows.length > limit;
  const data = hasMore ? rows.slice(0, limit) : rows;
  return Response.json({
    data,
    nextCursor: hasMore ? data[data.length - 1].id : null,
  });
}

export async function POST(req: NextRequest) {
  const { ctx, error } = await authenticate(req, "WRITE");
  if (error || !ctx) return error!;
  const body = (await req.json().catch(() => ({}))) as {
    name?: string;
    description?: string;
    category?: string;
    roleId?: string;
  };
  if (!body.name?.trim()) return Response.json({ error: "name required" }, { status: 400 });

  const kra = await prisma.kRA.create({
    data: {
      name: body.name.trim().slice(0, 150),
      description: body.description?.slice(0, 500) ?? null,
      category: body.category?.slice(0, 80) ?? null,
      roleId: body.roleId ?? null,
      organizationId: ctx.organizationId,
    },
    select: {
      id: true,
      name: true,
      description: true,
      category: true,
      roleId: true,
      createdAt: true,
    },
  });
  return Response.json(kra, { status: 201 });
}
