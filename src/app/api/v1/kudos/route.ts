import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { authenticate } from "@/lib/api-auth";
import { kudosAftermath } from "@/lib/kudos-give";

/**
 * GET /api/v1/kudos — feed, paginated.
 * Query: limit, cursor, receiverId, giverId
 */
export async function GET(req: NextRequest) {
  const { ctx, error } = await authenticate(req, "READ");
  if (error || !ctx) return error!;

  const url = new URL(req.url);
  const limit = Math.min(Math.max(parseInt(url.searchParams.get("limit") ?? "50", 10), 1), 200);
  const cursor = url.searchParams.get("cursor");
  const receiverId = url.searchParams.get("receiverId");
  const giverId = url.searchParams.get("giverId");

  const where: Record<string, unknown> = { organizationId: ctx.organizationId };
  if (receiverId) where.receiverId = receiverId;
  if (giverId) where.giverId = giverId;

  const rows = await prisma.kudos.findMany({
    where,
    take: limit + 1,
    orderBy: { createdAt: "desc" },
    ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
    select: {
      id: true,
      message: true,
      companyValue: true,
      giverId: true,
      receiverId: true,
      createdAt: true,
      giver: { select: { id: true, firstName: true, lastName: true } },
      receiver: { select: { id: true, firstName: true, lastName: true } },
    },
  });
  const hasMore = rows.length > limit;
  const data = hasMore ? rows.slice(0, limit) : rows;
  return Response.json({
    data,
    nextCursor: hasMore ? data[data.length - 1].id : null,
  });
}

/**
 * POST /api/v1/kudos — give kudos.
 * Body: { giverId, receiverId, message, companyValue? }
 * Fires everything a kudos does (kudosAftermath): the person thanked is
 * told and emailed, it is logged, their score is recalculated, Slack, and
 * webhook "kudos.created".
 */
export async function POST(req: NextRequest) {
  const { ctx, error } = await authenticate(req, "WRITE");
  if (error || !ctx) return error!;

  const body = (await req.json().catch(() => ({}))) as {
    giverId?: string;
    receiverId?: string;
    message?: string;
    companyValue?: string;
  };
  if (!body.giverId || !body.receiverId || !body.message?.trim()) {
    return Response.json(
      { error: "giverId, receiverId, and message are required" },
      { status: 400 },
    );
  }
  if (body.giverId === body.receiverId) {
    return Response.json({ error: "Cannot give kudos to yourself" }, { status: 400 });
  }

  // Both users must be in the caller's org, and not removed from it.
  const [giver, receiver] = await Promise.all([
    prisma.user.findFirst({
      where: { id: body.giverId, organizationId: ctx.organizationId, deletedAt: null },
      select: { id: true, firstName: true, lastName: true },
    }),
    prisma.user.findFirst({
      where: { id: body.receiverId, organizationId: ctx.organizationId, deletedAt: null },
      select: { id: true, firstName: true, lastName: true, email: true },
    }),
  ]);
  if (!giver || !receiver) return Response.json({ error: "User not found" }, { status: 404 });

  const kudos = await prisma.kudos.create({
    data: {
      giverId: body.giverId,
      receiverId: body.receiverId,
      message: body.message.trim().slice(0, 500),
      companyValue: body.companyValue?.trim().slice(0, 40) ?? null,
      organizationId: ctx.organizationId,
    },
    select: {
      id: true,
      message: true,
      companyValue: true,
      giverId: true,
      receiverId: true,
      createdAt: true,
    },
  });

  // After the answer, so the public API answers as fast as it always has.
  void kudosAftermath({ organizationId: ctx.organizationId, kudos, giver, receiver }).catch(() => {});

  return Response.json(kudos, { status: 201 });
}
