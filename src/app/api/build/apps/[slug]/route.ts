// GET /api/build/apps/[slug] — load app + rows
// PATCH — rename / change description
// DELETE — soft-archive (status=ARCHIVED)

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { z } from "zod";

async function ctx() {
  const session = await getServerSession(authOptions);
  if (!session?.user) return { error: NextResponse.json({ error: "unauthorized" }, { status: 401 }) };
  const userId = (session.user as { id?: string }).id;
  if (!userId) return { error: NextResponse.json({ error: "unauthorized" }, { status: 401 }) };
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { id: true, organizationId: true, accessLevel: true } });
  if (!user?.organizationId) return { error: NextResponse.json({ error: "no organization" }, { status: 400 }) };
  return { userId: user.id, orgId: user.organizationId, accessLevel: user.accessLevel };
}

export async function GET(_req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const c = await ctx();
  if ("error" in c) return c.error;
  const app = await prisma.app.findFirst({
    where: { organizationId: c.orgId, slug, status: { not: "ARCHIVED" } },
  });
  if (!app) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json({ app });
}

const patchSchema = z.object({
  name: z.string().min(1).max(80).optional(),
  description: z.string().max(400).optional(),
});

export async function PATCH(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const c = await ctx();
  if ("error" in c) return c.error;
  const existing = await prisma.app.findFirst({ where: { organizationId: c.orgId, slug } });
  if (!existing) return NextResponse.json({ error: "not found" }, { status: 404 });

  const body = await req.json().catch(() => null);
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "invalid body" }, { status: 400 });

  const app = await prisma.app.update({
    where: { id: existing.id },
    data: {
      ...(parsed.data.name !== undefined ? { name: parsed.data.name } : {}),
      ...(parsed.data.description !== undefined ? { description: parsed.data.description } : {}),
    },
  });
  return NextResponse.json({ app });
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const c = await ctx();
  if ("error" in c) return c.error;
  if (c.accessLevel !== "SUPER_ADMIN" && c.accessLevel !== "COMPANY_ADMIN") {
    return NextResponse.json({ error: "admin only" }, { status: 403 });
  }
  const existing = await prisma.app.findFirst({ where: { organizationId: c.orgId, slug } });
  if (!existing) return NextResponse.json({ error: "not found" }, { status: 404 });
  await prisma.app.update({ where: { id: existing.id }, data: { status: "ARCHIVED" } });
  return NextResponse.json({ ok: true });
}
