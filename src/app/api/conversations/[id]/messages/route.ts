import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionOrFail, getOrgId, getUserId, jsonError, jsonSuccess } from "@/lib/api-helpers";

// Messages — cursor-paged reads + sends. This is the hot path (the open
// pane polls GET every few seconds), so reads are one indexed query and
// sends touch exactly the rows they must.

const PAGE = 50;
const MAX_BODY = 8000;

const AUTHOR_SELECT = { id: true, firstName: true, lastName: true, avatar: true } as const;

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;
  const { id } = await params;
  const userId = getUserId(session);

  const membership = await prisma.conversationMember.findFirst({
    where: { conversationId: id, userId, conversation: { organizationId: getOrgId(session) } },
    select: { id: true },
  });
  if (!membership) return jsonError("Conversation not found", 404);

  const { searchParams } = new URL(req.url);
  const before = searchParams.get("before"); // message id — page older history
  const after = searchParams.get("after");   // ISO timestamp — poll for new

  if (after) {
    const afterDate = new Date(after);
    if (isNaN(afterDate.getTime())) return jsonError("Bad cursor", 400);
    // gte, not gt: two messages can share a millisecond, and a gt cursor
    // would skip the second forever. The client dedupes by id.
    const messages = await prisma.conversationMessage.findMany({
      where: { conversationId: id, createdAt: { gte: afterDate } },
      orderBy: { createdAt: "asc" },
      take: 200,
      include: { author: { select: AUTHOR_SELECT } },
    });
    return jsonSuccess({ messages, hasMore: false });
  }

  let cursorDate: Date | null = null;
  if (before) {
    const anchor = await prisma.conversationMessage.findFirst({
      where: { id: before, conversationId: id },
      select: { createdAt: true },
    });
    if (!anchor) return jsonError("Bad cursor", 400);
    cursorDate = anchor.createdAt;
  }

  const page = await prisma.conversationMessage.findMany({
    where: { conversationId: id, ...(cursorDate ? { createdAt: { lt: cursorDate } } : {}) },
    orderBy: { createdAt: "desc" },
    take: PAGE + 1,
    include: { author: { select: AUTHOR_SELECT } },
  });

  const hasMore = page.length > PAGE;
  const messages = page.slice(0, PAGE).reverse(); // oldest → newest for rendering
  return jsonSuccess({ messages, hasMore });
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;
  const { id } = await params;
  const userId = getUserId(session);

  const membership = await prisma.conversationMember.findFirst({
    where: { conversationId: id, userId, conversation: { organizationId: getOrgId(session) } },
    select: { id: true, conversation: { select: { type: true, name: true } } },
  });
  if (!membership) return jsonError("Conversation not found", 404);

  const payload = await req.json().catch(() => null);
  const text = typeof payload?.body === "string" ? payload.body.trim() : "";
  const isCallCard = payload?.metadata?.kind === "call";
  if (!text && !isCallCard) return jsonError("Message can't be empty", 400);
  if (text.length > MAX_BODY) return jsonError("Message is too long", 400);

  const now = new Date();
  const [message] = await prisma.$transaction([
    prisma.conversationMessage.create({
      data: {
        conversationId: id,
        authorId: userId,
        body: text || "Started a call",
        metadata: isCallCard ? { kind: "call" } : undefined,
      },
      include: { author: { select: AUTHOR_SELECT } },
    }),
    prisma.conversation.update({ where: { id }, data: { lastMessageAt: now } }),
    prisma.conversationMember.update({ where: { id: membership.id }, data: { lastReadAt: now } }),
  ]);

  // Notify recipients through the existing bell/inbox rail — but only
  // members who opted into it, and only ONE unread notification per
  // conversation per person (no notification-per-message flood).
  try {
    const others = await prisma.conversationMember.findMany({
      where: { conversationId: id, userId: { not: userId }, notifyLevel: "all" },
      select: { userId: true },
    });
    if (others.length > 0) {
      const link = `/chat/${id}`;
      const already = await prisma.notification.findMany({
        where: { userId: { in: others.map((o) => o.userId) }, link, read: false },
        select: { userId: true },
      });
      const alreadySet = new Set(already.map((a) => a.userId));
      const fresh = others.filter((o) => !alreadySet.has(o.userId));
      if (fresh.length > 0) {
        const senderName = `${message.author.firstName} ${message.author.lastName}`.trim();
        const title = membership.conversation.type === "DM"
          ? `New message from ${senderName}`
          : `New messages in ${membership.conversation.name || "a group chat"}`;
        await prisma.notification.createMany({
          data: fresh.map((o) => ({
            userId: o.userId,
            title,
            message: isCallCard ? "📞 Started a call — tap to join" : text.slice(0, 140),
            type: "chat_message",
            link,
          })),
        });
      }
    }
  } catch (e) {
    // Notification failure must never fail the send itself.
    console.error("chat notify failed", e);
  }

  return jsonSuccess({ message }, 201);
}
