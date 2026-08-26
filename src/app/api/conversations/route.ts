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
      starred: true,
      conversation: {
        select: {
          id: true,
          type: true,
          name: true,
          lastMessageAt: true,
          createdById: true,
          // Cap the roster: DM/group titles need a handful of people, and
          // #general would otherwise ship the whole org in every 20s poll.
          members: { select: MEMBER_SELECT, take: 8 },
          _count: { select: { members: true } },
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
      memberCount: m.conversation._count.members,
      _count: undefined,
      myLastReadAt: m.lastReadAt,
      myNotifyLevel: m.notifyLevel,
      myStarred: m.starred,
      unreadCount: unread.get(m.conversation.id) ?? 0,
    }))
    .sort((a, b) => new Date(b.lastMessageAt).getTime() - new Date(a.lastMessageAt).getTime());

  // Live huddle presence (native-calls Phase 2): one indexed query for
  // every conversation with an open call session. 12h staleness cap so a
  // missed room_finished webhook can't pin a ghost huddle forever.
  let activeCalls = new Map<string, { participants: { identity: string; name: string }[]; startedAt: Date }>();
  try {
    const convIds = conversations.map((c) => c.id);
    if (convIds.length > 0) {
      const sessions = await prisma.callSession.findMany({
        where: {
          conversationId: { in: convIds },
          endedAt: null,
          startedAt: { gt: new Date(Date.now() - 12 * 3600_000) },
        },
        select: { conversationId: true, participants: true, startedAt: true },
      });
      activeCalls = new Map(sessions
        .filter((s) => Array.isArray(s.participants) && (s.participants as unknown[]).length > 0)
        .map((s) => [s.conversationId as string, {
          participants: s.participants as { identity: string; name: string }[],
          startedAt: s.startedAt,
        }]));
    }
  } catch (e) { console.error("active call lookup failed", e); }

  const withCalls = conversations.map((c) => ({ ...c, activeCall: activeCalls.get(c.id) ?? null }));

  // Channel directory — org channels are open: everyone can see and join
  // them. Failures here must never break the conversation list.
  let channels: { id: string; name: string | null; memberCount: number; isMember: boolean }[] = [];
  try {
    channels = await channelDirectory(orgId, userId);
  } catch (e) {
    console.error("channel directory failed", e);
  }

  return jsonSuccess({ conversations: withCalls, channels });
}

/** Org-open channel list. Also lazily seeds #general (whole org joined)
 *  and auto-joins people who joined the org after the seed. */
async function channelDirectory(orgId: string, userId: string) {
  let rows = await prisma.conversation.findMany({
    where: { organizationId: orgId, type: "CHANNEL" },
    select: {
      id: true,
      name: true,
      _count: { select: { members: true } },
      members: { where: { userId }, select: { id: true } },
    },
    orderBy: { createdAt: "asc" },
  });

  const general = rows.find((r) => (r.name ?? "").toLowerCase() === "general");
  if (!general) {
    // First run for this org: create #general with every active person in
    // it. Advisory lock + re-check so two simultaneous first loads can't
    // seed duplicate channels.
    await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${"seed-general:" + orgId}))`;
      const exists = await tx.conversation.findFirst({
        where: { organizationId: orgId, type: "CHANNEL", name: { equals: "general", mode: "insensitive" } },
        select: { id: true },
      });
      if (exists) return;
      const people = await tx.user.findMany({
        where: { organizationId: orgId, deletedAt: null },
        select: { id: true },
      });
      await tx.conversation.create({
        data: {
          organizationId: orgId,
          type: "CHANNEL",
          name: "general",
          createdById: userId,
          // Channels stay quiet in the bell (Slack parity — mentions come
          // in Phase 5). Unread badges still work.
          members: { create: people.map((u) => ({ userId: u.id, notifyLevel: "mentions" })) },
        },
      });
    });
    rows = await prisma.conversation.findMany({
      where: { organizationId: orgId, type: "CHANNEL" },
      select: {
        id: true,
        name: true,
        _count: { select: { members: true } },
        members: { where: { userId }, select: { id: true } },
      },
      orderBy: { createdAt: "asc" },
    });
  } else if (general.members.length === 0) {
    // Joined the org after the seed — everyone belongs in #general.
    await prisma.conversationMember.createMany({
      data: [{ conversationId: general.id, userId, notifyLevel: "mentions" }],
      skipDuplicates: true,
    });
    general.members = [{ id: "joined" }];
    general._count.members += 1;
  }

  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    memberCount: r._count.members,
    isMember: r.members.length > 0,
  }));
}

export async function POST(req: NextRequest) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;
  const userId = getUserId(session);
  const orgId = getOrgId(session);

  const body = await req.json().catch(() => null);
  const type = body?.type === "GROUP" ? "GROUP" : body?.type === "CHANNEL" ? "CHANNEL" : "DM";

  if (type === "CHANNEL") {
    const name = typeof body?.name === "string" ? body.name.trim().replace(/^#/, "").slice(0, 60) : "";
    if (!name) return jsonError("Channels need a name", 400);
    const clash = await prisma.conversation.findFirst({
      where: { organizationId: orgId, type: "CHANNEL", name: { equals: name, mode: "insensitive" } },
      select: { id: true },
    });
    if (clash) return jsonSuccess({ id: clash.id, existed: true });
    const channel = await prisma.conversation.create({
      data: {
        organizationId: orgId,
        type: "CHANNEL",
        name,
        createdById: userId,
        members: { create: [{ userId, notifyLevel: "mentions" }] },
      },
      select: { id: true },
    });
    return jsonSuccess({ id: channel.id, existed: false }, 201);
  }

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
