// GET /api/sidekick/sessions  — list my chat sessions
// POST /api/sidekick/sessions — start a new session (returns the id)

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
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { id: true, organizationId: true } });
  if (!user?.organizationId) return { error: NextResponse.json({ error: "no organization" }, { status: 400 }) };
  return { userId: user.id, orgId: user.organizationId };
}

export async function GET() {
  const c = await ctx();
  if ("error" in c) return c.error;
  const sessions = await prisma.chatSession.findMany({
    where: { organizationId: c.orgId, userId: c.userId, archivedAt: null },
    select: {
      id: true,
      title: true,
      pinned: true,
      lastModel: true,
      totalTokensIn: true,
      totalTokensOut: true,
      createdAt: true,
      updatedAt: true,
    },
    orderBy: [{ pinned: "desc" }, { updatedAt: "desc" }],
    take: 100,
  });
  return NextResponse.json({ sessions });
}

const createSchema = z.object({
  title: z.string().max(200).optional(),
});

export async function POST(req: Request) {
  const c = await ctx();
  if ("error" in c) return c.error;
  const body = await req.json().catch(() => ({}));
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "invalid body" }, { status: 400 });

  const session = await prisma.chatSession.create({
    data: {
      organizationId: c.orgId,
      userId: c.userId,
      title: parsed.data.title ?? null,
    },
    select: { id: true, title: true, createdAt: true },
  });
  return NextResponse.json({ session });
}
