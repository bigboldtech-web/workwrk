import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { authenticate } from "@/lib/api-auth";

/**
 * GET /api/v1/people
 *
 * Query params:
 *   • limit        (1-200, default 50)
 *   • cursor       (user id — return records AFTER this one)
 *   • status       (ACTIVE | INACTIVE | ON_LEAVE | ...)
 *   • departmentId
 *
 * Returns people + next cursor.
 */
export async function GET(req: NextRequest) {
  const { ctx, error } = await authenticate(req, "READ");
  if (error || !ctx) return error!;

  const url = new URL(req.url);
  const limit = Math.min(Math.max(parseInt(url.searchParams.get("limit") ?? "50", 10), 1), 200);
  const cursor = url.searchParams.get("cursor");
  const status = url.searchParams.get("status");
  const departmentId = url.searchParams.get("departmentId");

  const where: Record<string, unknown> = {
    organizationId: ctx.organizationId,
    deletedAt: null,
  };
  if (status) where.status = status;
  if (departmentId) where.departmentId = departmentId;

  const rows = await prisma.user.findMany({
    where,
    take: limit + 1,
    orderBy: { createdAt: "asc" },
    ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
    select: {
      id: true,
      email: true,
      firstName: true,
      lastName: true,
      status: true,
      accessLevel: true,
      avatar: true,
      joinDate: true,
      createdAt: true,
      role: { select: { id: true, title: true } },
      department: { select: { id: true, name: true } },
      manager: { select: { id: true, firstName: true, lastName: true } },
    },
  });

  const hasMore = rows.length > limit;
  const data = hasMore ? rows.slice(0, limit) : rows;
  const nextCursor = hasMore ? data[data.length - 1].id : null;

  return Response.json({ data, nextCursor });
}

/**
 * POST /api/v1/people — invite a user into the org.
 * Body: { email, firstName, lastName, accessLevel?, roleId?, departmentId? }
 *
 * Triggers invitation creation (does NOT create a fully-activated user
 * — that happens when they accept the invite). Returns the invitation
 * token + acceptance URL for admins who want to hand it over manually.
 */
export async function POST(req: NextRequest) {
  const { ctx, error } = await authenticate(req, "WRITE");
  if (error || !ctx) return error!;

  const body = (await req.json().catch(() => ({}))) as {
    email?: string;
    firstName?: string;
    lastName?: string;
    accessLevel?: string;
    roleId?: string;
    departmentId?: string;
  };
  if (!body.email) {
    return Response.json({ error: "email required" }, { status: 400 });
  }

  const existing = await prisma.user.findFirst({
    where: { email: body.email.toLowerCase(), organizationId: ctx.organizationId },
    select: { id: true },
  });
  if (existing) return Response.json({ error: "User already in this org" }, { status: 409 });

  const token = Buffer.from(
    `${Date.now()}-${Math.random().toString(36).slice(2)}`,
  ).toString("base64url");
  const expiresAt = new Date(Date.now() + 1000 * 60 * 60 * 24 * 7); // 7 days

  const invite = await prisma.invitation.create({
    data: {
      email: body.email.toLowerCase(),
      token,
      expiresAt,
      organizationId: ctx.organizationId,
      roleId: body.roleId ?? null,
      departmentId: body.departmentId ?? null,
    },
  });

  const base = process.env.NEXTAUTH_URL ?? "http://localhost:3000";
  return Response.json(
    {
      invitation: {
        id: invite.id,
        email: invite.email,
        token,
        expiresAt,
        acceptUrl: `${base}/register?token=${token}`,
      },
    },
    { status: 201 },
  );
}
