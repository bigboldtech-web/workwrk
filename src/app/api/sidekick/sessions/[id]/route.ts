// GET /api/sidekick/sessions/[id] — session + all messages
// DELETE /api/sidekick/sessions/[id] — soft-archive session
// PATCH /api/sidekick/sessions/[id] — rename / pin / unpin

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { z } from "zod";

async function ctxAndSession(id: string) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return { error: NextResponse.json({ error: "unauthorized" }, { status: 401 }) };
  const userId = (session.user as { id?: string }).id;
  if (!userId) return { error: NextResponse.json({ error: "unauthorized" }, { status: 401 }) };

  const row = await prisma.chatSession.findFirst({
    where: { id, userId, archivedAt: null },
  });
  if (!row) return { error: NextResponse.json({ error: "not found" }, { status: 404 }) };
  return { userId, session: row };
}

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const c = await ctxAndSession(id);
  if ("error" in c) return c.error;

  const messages = await prisma.chatMessage.findMany({
    where: { sessionId: id },
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      role: true,
      content: true,
      modelUsed: true,
      tokensIn: true,
      tokensOut: true,
      finishReason: true,
      createdAt: true,
    },
  });

  return NextResponse.json({
    session: {
      id: c.session.id,
      title: c.session.title,
      pinned: c.session.pinned,
      lastModel: c.session.lastModel,
      createdAt: c.session.createdAt,
    },
    messages,
  });
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const c = await ctxAndSession(id);
  if ("error" in c) return c.error;
  await prisma.chatSession.update({ where: { id }, data: { archivedAt: new Date() } });
  return NextResponse.json({ ok: true });
}

const patchSchema = z.object({
  title: z.string().max(200).optional(),
  pinned: z.boolean().optional(),
});

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const c = await ctxAndSession(id);
  if ("error" in c) return c.error;
  const body = await req.json().catch(() => null);
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "invalid body" }, { status: 400 });

  const updated = await prisma.chatSession.update({
    where: { id },
    data: {
      ...(parsed.data.title !== undefined ? { title: parsed.data.title } : {}),
      ...(parsed.data.pinned !== undefined ? { pinned: parsed.data.pinned } : {}),
    },
  });
  return NextResponse.json({ session: { id: updated.id, title: updated.title, pinned: updated.pinned } });
}
