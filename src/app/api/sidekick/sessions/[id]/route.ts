// GET /api/sidekick/sessions/[id], session + all messages
// DELETE /api/sidekick/sessions/[id], soft-archive session
// PATCH /api/sidekick/sessions/[id], rename / pin / unpin

import { requireApp } from "@/lib/app-gate";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { z } from "zod";
import { ASK_AI_CHATS } from "@/lib/agents/session-guard";

async function ctxAndSession(id: string, opts: { includeArchived?: boolean } = {}) {
  // The ai app key: Guests 404, a hidden app or AI features off 403 app_off.
  const gate = await requireApp("ai");
  if ("error" in gate) return { error: gate.error };
  const session = await getServerSession(authOptions);
  if (!session?.user) return { error: NextResponse.json({ error: "unauthorized" }, { status: 401 }) };
  const userId = (session.user as { id?: string }).id;
  if (!userId) return { error: NextResponse.json({ error: "unauthorized" }, { status: 401 }) };
  // Only in the workspace the person is in now: a chat belongs to the
  // workspace it was started in, and someone removed from that workspace
  // must not keep spending its AI questions or writing into it through an
  // old chat.
  const orgId = (session.user as { organizationId?: string }).organizationId;
  if (!orgId) return { error: NextResponse.json({ error: "unauthorized" }, { status: 401 }) };

  // Ask AI's chats only: a chat with an AI teammate is not read, renamed or
  // archived here (src/lib/agents/session-guard.ts), so its id is a 404.
  const row = await prisma.chatSession.findFirst({
    where: { id, userId, organizationId: orgId, ...ASK_AI_CHATS, ...(opts.includeArchived ? {} : { archivedAt: null }) },
  });
  if (!row) return { error: NextResponse.json({ error: "not found" }, { status: 404 }) };
  return { userId, session: row };
}

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  // An archived chat still opens (from All chats > Archived), read as-is.
  const c = await ctxAndSession(id, { includeArchived: true });
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
      toolCalls: true,
      createdAt: true,
    },
  });

  return NextResponse.json({
    session: {
      id: c.session.id,
      title: c.session.title,
      pinned: c.session.pinned,
      archived: c.session.archivedAt !== null,
      lastModel: c.session.lastModel,
      productContext: c.session.productContext,
      boardContext: c.session.boardContext,
      createdAt: c.session.createdAt,
    },
    messages,
  });
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const c = await ctxAndSession(id);
  if ("error" in c) return c.error;
  // updatedAt is kept as it was: it is the chat's "Last message" time and
  // its place in the recent sort, and archiving sends no message.
  await prisma.chatSession.update({ where: { id }, data: { archivedAt: new Date(), updatedAt: c.session.updatedAt } });
  return NextResponse.json({ ok: true });
}

const patchSchema = z.object({
  title: z.string().trim().min(1).max(200).optional(),
  pinned: z.boolean().optional(),
  // Restore from All chats > Archived. Archiving stays DELETE.
  archived: z.literal(false).optional(),
});

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const c = await ctxAndSession(id, { includeArchived: true });
  if ("error" in c) return c.error;
  const body = await req.json().catch(() => null);
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "invalid body" }, { status: 400 });

  const updated = await prisma.chatSession.update({
    where: { id },
    data: {
      ...(parsed.data.title !== undefined ? { title: parsed.data.title } : {}),
      ...(parsed.data.pinned !== undefined ? { pinned: parsed.data.pinned } : {}),
      ...(parsed.data.archived === false ? { archivedAt: null } : {}),
      // Rename, pin and restore send no message, so the chat keeps its
      // "Last message" time and its place in the recent sort.
      updatedAt: c.session.updatedAt,
    },
  });
  return NextResponse.json({ session: { id: updated.id, title: updated.title, pinned: updated.pinned, archived: updated.archivedAt !== null } });
}
