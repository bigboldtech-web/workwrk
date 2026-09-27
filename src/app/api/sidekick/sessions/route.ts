// GET /api/sidekick/sessions, list my chat sessions
// POST /api/sidekick/sessions, start a new session (returns the id)

import { requireApp } from "@/lib/app-gate";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { z } from "zod";

async function ctx() {
  // The ai app key: Guests 404, a hidden app or AI features off 403 app_off.
  const gate = await requireApp("ai");
  if ("error" in gate) return { error: gate.error };
  const session = await getServerSession(authOptions);
  if (!session?.user) return { error: NextResponse.json({ error: "unauthorized" }, { status: 401 }) };
  const userId = (session.user as { id?: string }).id;
  if (!userId) return { error: NextResponse.json({ error: "unauthorized" }, { status: 401 }) };
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { id: true, organizationId: true } });
  if (!user?.organizationId) return { error: NextResponse.json({ error: "no organization" }, { status: 400 }) };
  return { userId: user.id, orgId: user.organizationId };
}

/**
 * GET /api/sidekick/sessions
 *   ?archived=1   the viewer's archived chats instead of the live ones
 *   ?pinned=1     pinned only
 *   ?q=           title contains (case-insensitive)
 *   ?sort=        recent (default: pinned first, then newest) | title (A to Z)
 *   ?take=        page size, 1 to 100 (default 100)
 *   ?cursor=      the id to continue after (from nextCursor)
 *
 * { sessions: [{ id, title, pinned, archived, messageCount, lastModel,
 *   createdAt, updatedAt }], total, nextCursor, restarted }. Always the
 * viewer's own: nobody, the Owner included, reads another person's chats.
 *
 * A chat with no messages is not listed: a session is created just before
 * its first message is sent, so a send that never reached the server (the
 * network dropped, the stream failed to open) would otherwise leave an empty
 * "Untitled chat" row. The row itself is kept; it only drops out of lists.
 *
 * A cursor that no longer names a row in this list (the chat was archived,
 * restored or emptied since the page was read) restarts at the first page
 * and says so with restarted: true, so a footer never reads a count with no
 * rows beneath it.
 */
export async function GET(req: Request) {
  const c = await ctx();
  if ("error" in c) return c.error;
  const sp = new URL(req.url).searchParams;
  const archived = sp.get("archived") === "1";
  const pinnedOnly = sp.get("pinned") === "1";
  const q = (sp.get("q") ?? "").trim().slice(0, 200);
  const take = Math.min(100, Math.max(1, parseInt(sp.get("take") ?? "100", 10) || 100));
  const cursor = sp.get("cursor");
  const byTitle = sp.get("sort") === "title";

  const where = {
    organizationId: c.orgId,
    userId: c.userId,
    archivedAt: archived ? { not: null } : null,
    ...(pinnedOnly ? { pinned: true } : {}),
    ...(q ? { title: { contains: q, mode: "insensitive" as const } } : {}),
    messages: { some: {} },
  };
  const cursorValid = cursor
    ? (await prisma.chatSession.count({ where: { ...where, id: cursor } })) > 0
    : false;
  const [rows, total] = await Promise.all([
    prisma.chatSession.findMany({
      where,
      select: {
        id: true,
        title: true,
        pinned: true,
        lastModel: true,
        archivedAt: true,
        totalTokensIn: true,
        totalTokensOut: true,
        createdAt: true,
        updatedAt: true,
        _count: { select: { messages: true } },
      },
      orderBy: byTitle
        ? [{ title: { sort: "asc", nulls: "last" } }, { id: "desc" }]
        : [{ pinned: "desc" }, { updatedAt: "desc" }, { id: "desc" }],
      take: take + 1,
      ...(cursor && cursorValid ? { cursor: { id: cursor }, skip: 1 } : {}),
    }),
    prisma.chatSession.count({ where }),
  ]);
  const page = rows.slice(0, take);
  const nextCursor = rows.length > take ? page[page.length - 1]?.id ?? null : null;
  return NextResponse.json({
    sessions: page.map(({ _count, archivedAt, ...s }) => ({ ...s, archived: archivedAt !== null, messageCount: _count.messages })),
    total,
    nextCursor,
    restarted: Boolean(cursor) && !cursorValid,
  });
}

const createSchema = z.object({
  title: z.string().max(200).nullish(),
  agentSlug: z.string().max(64).nullish(),
  // Board-level context, when the session is opened from an app
  // surface (e.g. /crm/pipeline → Sidekick link), the caller passes
  // the product slug and current board key so the runtime can scope
  // tools + system prompt without asking the user "which board?".
  // Nullish: a page with one path segment (/home, /inbox) has a product but
  // no board, and the panel sends null for the missing half.
  productContext: z.string().max(80).nullish(),
  boardContext: z.string().max(80).nullish(),
});

export async function POST(req: Request) {
  const c = await ctx();
  if ("error" in c) return c.error;
  const body = await req.json().catch(() => ({}));
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "invalid body" }, { status: 400 });

  // Resolve optional agent, must belong to the same org + be enabled.
  let agentId: string | null = null;
  let inheritedTitle: string | null = null;
  if (parsed.data.agentSlug) {
    const agent = await prisma.agent.findFirst({
      where: { organizationId: c.orgId, slug: parsed.data.agentSlug, status: "ENABLED" },
      select: { id: true, name: true },
    });
    if (!agent) return NextResponse.json({ error: "agent not found or not enabled" }, { status: 404 });
    agentId = agent.id;
    inheritedTitle = `Chat with ${agent.name}`;
  }

  const session = await prisma.chatSession.create({
    data: {
      organizationId: c.orgId,
      userId: c.userId,
      title: parsed.data.title ?? inheritedTitle,
      agentId,
      productContext: parsed.data.productContext ?? null,
      boardContext: parsed.data.boardContext ?? null,
    },
    select: {
      id: true, title: true, agentId: true,
      productContext: true, boardContext: true,
      createdAt: true,
    },
  });
  return NextResponse.json({ session });
}
