import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionOrFail, getOrgId, getUserId, jsonError, jsonSuccess } from "@/lib/api-helpers";

// Comms Hub — conversation list + create (docs/plans/comms-hub.md).
// Every route here is scoped twice: to the caller's org AND to
// conversations the caller is a member of. Non-members get 404s,
// never partial data.

const MEMBER_SELECT = {
  id: true,
  userId: true,
  lastReadAt: true,
  notifyLevel: true,
  user: { select: { id: true, firstName: true, lastName: true, avatar: true } },
} as const;

export async function GET() {
  const { error, session } = await getSessionOrFail();
  if (error) return error;
  const userId = getUserId(session);
  const orgId = getOrgId(session);

  const memberships = await prisma.conversationMember.findMany({
    where: { userId, conversation: { organizationId: orgId } },
    select: {
      lastReadAt: true,
      notifyLevel: true,
      conversation: {
        select: {
          id: true,
          type: true,
          name: true,
          lastMessageAt: true,
          createdById: true,
          members: { select: MEMBER_SELECT },
          messages: {
            where: { deletedAt: null },
            orderBy: { createdAt: "desc" },
            take: 1,
            select: { body: true, authorId: true, createdAt: true, metadata: true },
          },
        },
      },
    },
  });

  // Unread counts for all my conversations in ONE indexed query —
  // the sidebar polls this endpoint, so it must stay cheap.
  const unreadRows = await prisma.$queryRaw<{ conversationId: string; n: bigint }[]>`
    SELECT m."conversationId", COUNT(*)::bigint AS n
    FROM "ConversationMessage" m
    JOIN "ConversationMember" cm
      ON cm."conversationId" = m."conversationId" AND cm."userId" = ${userId}
    WHERE m."createdAt" > cm."lastReadAt"
      AND m."authorId" <> ${userId}
      AND m."deletedAt" IS NULL
    GROUP BY m."conversationId"`;
  const unread = new Map(unreadRows.map((r) => [r.conversationId, Number(r.n)]));

  const conversations = memberships
    .map((m) => ({
      ...m.conversation,
      lastMessage: m.conversation.messages[0] ?? null,
      messages: undefined,
      myLastReadAt: m.lastReadAt,
      myNotifyLevel: m.notifyLevel,
      unreadCount: unread.get(m.conversation.id) ?? 0,
    }))
    .sort((a, b) => new Date(b.lastMessageAt).getTime() - new Date(a.lastMessageAt).getTime());

  return jsonSuccess({ conversations });
}

export async function POST(req: NextRequest) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;
  const userId = getUserId(session);
  const orgId = getOrgId(session);

  const body = await req.json().catch(() => null);
  const type = body?.type === "GROUP" ? "GROUP" : "DM";
  const rawIds: unknown = body?.memberIds;
  const memberIds = Array.isArray(rawIds)
    ? [...new Set(rawIds.filter((x): x is string => typeof x === "string" && x.length > 0 && x !== userId))]
    : [];

  if (memberIds.length === 0) return jsonError("Pick at least one person", 400);
  if (type === "DM" && memberIds.length !== 1) return jsonError("A direct message has exactly one other person", 400);
  if (memberIds.length > 50) return jsonError("Too many members", 400);

  // Every member must be an active person in the caller's org.
  const valid = await prisma.user.count({
    where: { id: { in: memberIds }, organizationId: orgId, deletedAt: null },
  });
  if (valid !== memberIds.length) return jsonError("Some people could not be added", 400);

  // DMs are unique per pair — reuse the existing one instead of forking.
  if (type === "DM") {
    const existing = await prisma.conversation.findFirst({
      where: {
        organizationId: orgId,
        type: "DM",
        AND: [
          { members: { some: { userId } } },
          { members: { some: { userId: memberIds[0] } } },
        ],
      },
      select: { id: true },
    });
    if (existing) return jsonSuccess({ id: existing.id, existed: true });
  }

  const name = type === "GROUP" && typeof body?.name === "string" && body.name.trim()
    ? body.name.trim().slice(0, 80)
    : null;

  const conversation = await prisma.conversation.create({
    data: {
      organizationId: orgId,
      type,
      name,
      createdById: userId,
      members: { create: [userId, ...memberIds].map((uid) => ({ userId: uid })) },
    },
    select: { id: true },
  });

  return jsonSuccess({ id: conversation.id, existed: false }, 201);
}
