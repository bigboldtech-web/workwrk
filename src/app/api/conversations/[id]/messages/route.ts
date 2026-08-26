import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionOrFail, getOrgId, getUserId, jsonError, jsonSuccess } from "@/lib/api-helpers";
import type { Prisma } from "@/generated/prisma";
import { presignGetUrl } from "@/lib/s3";
import { stripMarkup } from "@/lib/chat-markup";

// Messages — cursor-paged reads + sends. This is the hot path (the open
// pane polls GET every few seconds), so reads are one indexed query and
// sends touch exactly the rows they must.
//
// Phase 5: the after-cursor keys on updatedAt (not createdAt) so
// reactions, edits and deletes to OLD messages flow through the same
// poll; threads ride parentId; mentions and attachments ride metadata.

const PAGE = 50;
const MAX_BODY = 8000;
const MAX_ATTACHMENTS = 10;

const AUTHOR_SELECT = { id: true, firstName: true, lastName: true, avatar: true } as const;

type Membership = { id: string; conversation: { type: string; name: string | null } };

async function requireMembership(conversationId: string, userId: string, orgId: string): Promise<Membership | null> {
  return prisma.conversationMember.findFirst({
    where: { conversationId, userId, conversation: { organizationId: orgId } },
    select: { id: true, conversation: { select: { type: true, name: true } } },
  });
}

/** Outbound shaping for every read path:
 *  - "removed" messages must not leak their content through the API —
 *    body and metadata are blanked server-side, not just hidden in UI;
 *  - S3-backed attachments carry an s3Key and get a fresh presigned
 *    URL on every read (stored URLs expire after an hour). */
async function serveMessages<T extends { deletedAt: Date | null; metadata: unknown }>(rows: T[]): Promise<T[]> {
  return Promise.all(rows.map(async (m) => {
    if (m.deletedAt) return { ...m, body: "", metadata: null };
    const meta = m.metadata as { attachments?: { url: string; s3Key?: string }[] } | null;
    if (!meta?.attachments?.some((a) => a.s3Key)) return m;
    const attachments = await Promise.all(meta.attachments.map(async (a) => {
      if (!a.s3Key) return a;
      try { return { ...a, url: await presignGetUrl(a.s3Key, 3600) }; }
      catch { return a; }
    }));
    return { ...m, metadata: { ...meta, attachments } };
  }));
}

/** Reply counts for a set of top-level message ids — one groupBy. */
async function replyCounts(conversationId: string, parentIds: string[]): Promise<Map<string, number>> {
  if (parentIds.length === 0) return new Map();
  const rows = await prisma.conversationMessage.groupBy({
    by: ["parentId"],
    where: { conversationId, parentId: { in: parentIds }, deletedAt: null },
    _count: { _all: true },
  });
  return new Map(rows.filter((r) => r.parentId).map((r) => [r.parentId as string, r._count._all]));
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;
  const { id } = await params;
  const userId = getUserId(session);

  const membership = await requireMembership(id, userId, getOrgId(session));
  if (!membership) return jsonError("Conversation not found", 404);

  const { searchParams } = new URL(req.url);
  const before = searchParams.get("before");  // message id — page older history
  const after = searchParams.get("after");    // ISO timestamp — poll for changes
  const parent = searchParams.get("parent");  // message id — a thread's replies

  if (parent) {
    const parentMsg = await prisma.conversationMessage.findFirst({
      where: { id: parent, conversationId: id },
      include: { author: { select: AUTHOR_SELECT } },
    });
    if (!parentMsg) return jsonError("Thread not found", 404);
    const replies = await prisma.conversationMessage.findMany({
      where: { conversationId: id, parentId: parent },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      take: 200,
      include: { author: { select: AUTHOR_SELECT } },
    });
    const [servedParent] = await serveMessages([parentMsg]);
    const servedReplies = await serveMessages(replies);
    return jsonSuccess({
      parent: { ...servedParent, replyCount: replies.filter((r) => !r.deletedAt).length },
      messages: servedReplies,
    });
  }

  if (after) {
    const afterDate = new Date(after);
    if (isNaN(afterDate.getTime())) return jsonError("Bad cursor", 400);
    // Keyset cursor (updatedAt, id): strictly-after rows plus same-instant
    // rows with a higher id. Guarantees progress even when many rows share
    // one timestamp (the migration backfilled identical updatedAt values —
    // a plain gte cursor could livelock on 200 equal rows and never reach
    // newer messages), and same-millisecond writes can't be skipped.
    const afterId = searchParams.get("afterId") ?? "";
    const messages = await prisma.conversationMessage.findMany({
      where: {
        conversationId: id,
        OR: [
          { updatedAt: { gt: afterDate } },
          { updatedAt: afterDate, id: { gt: afterId } },
        ],
      },
      orderBy: [{ updatedAt: "asc" }, { id: "asc" }],
      take: 200,
      include: { author: { select: AUTHOR_SELECT } },
    });
    const counts = await replyCounts(id, messages.filter((m) => !m.parentId).map((m) => m.id));
    const served = await serveMessages(messages);
    const last = messages[messages.length - 1];
    return jsonSuccess({
      messages: served.map((m) => ({ ...m, replyCount: counts.get(m.id) ?? 0 })),
      // 200 rows means there may be more same-poll — the client re-polls
      // immediately from the new cursor instead of waiting a full tick.
      more: messages.length === 200,
      cursor: last ? { ts: last.updatedAt.toISOString(), id: last.id } : null,
    });
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

  // The main feed shows top-level messages only; replies live in threads.
  const page = await prisma.conversationMessage.findMany({
    where: { conversationId: id, parentId: null, ...(cursorDate ? { createdAt: { lt: cursorDate } } : {}) },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: PAGE + 1,
    include: { author: { select: AUTHOR_SELECT } },
  });

  const hasMore = page.length > PAGE;
  const window = page.slice(0, PAGE);
  const counts = await replyCounts(id, window.map((m) => m.id));
  const served = await serveMessages(window);
  const messages = served.reverse().map((m) => ({ ...m, replyCount: counts.get(m.id) ?? 0 }));
  return jsonSuccess({ messages, hasMore });
}

/* ── validation helpers for metadata riders ─────────────────────── */

function cleanAttachments(raw: unknown): { url: string; name: string; type: string; size: number; s3Key?: string }[] | null {
  if (!Array.isArray(raw)) return null;
  if (raw.length > MAX_ATTACHMENTS) return null;
  const out: { url: string; name: string; type: string; size: number; s3Key?: string }[] = [];
  for (const a of raw) {
    const url = typeof a?.url === "string" ? a.url.slice(0, 2048) : "";
    if (!url || !(url.startsWith("/") || url.startsWith("https://") || url.startsWith("http://"))) return null;
    out.push({
      url,
      name: (typeof a?.name === "string" ? a.name : "file").slice(0, 200),
      type: (typeof a?.type === "string" ? a.type : "application/octet-stream").slice(0, 100),
      size: Number.isFinite(a?.size) ? Math.max(0, Math.floor(a.size)) : 0,
      // S3 object key — reads re-presign from this; local uploads omit it.
      ...(typeof a?.s3Key === "string" && a.s3Key ? { s3Key: a.s3Key.slice(0, 512) } : {}),
    });
  }
  return out;
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;
  const { id } = await params;
  const userId = getUserId(session);
  const orgId = getOrgId(session);

  const membership = await requireMembership(id, userId, orgId);
  if (!membership) return jsonError("Conversation not found", 404);

  const payload = await req.json().catch(() => null);
  const text = typeof payload?.body === "string" ? payload.body.trim() : "";
  const isCallCard = payload?.metadata?.kind === "call";
  const attachments = payload?.metadata?.attachments !== undefined ? cleanAttachments(payload.metadata.attachments) : [];
  if (attachments === null) return jsonError("Bad attachments", 400);
  if (!text && !isCallCard && attachments.length === 0) return jsonError("Message can't be empty", 400);
  if (text.length > MAX_BODY) return jsonError("Message is too long", 400);

  // Mentions: only people who are actually in this conversation count.
  let mentions: string[] = [];
  if (Array.isArray(payload?.metadata?.mentions) && payload.metadata.mentions.length > 0) {
    const candidate: string[] = [...new Set<string>(
      (payload.metadata.mentions as unknown[]).filter((x): x is string => typeof x === "string"),
    )].slice(0, 50);
    const valid = await prisma.conversationMember.findMany({
      where: { conversationId: id, userId: { in: candidate } },
      select: { userId: true },
    });
    mentions = valid.map((v) => v.userId).filter((uid) => uid !== userId);
  }

  // Thread replies: parent must be a top-level message in THIS conversation.
  let parentId: string | null = null;
  if (typeof payload?.parentId === "string" && payload.parentId) {
    const parent = await prisma.conversationMessage.findFirst({
      where: { id: payload.parentId, conversationId: id, parentId: null },
      select: { id: true },
    });
    if (!parent) return jsonError("That thread no longer exists", 400);
    parentId = parent.id;
  }

  const metadata: Record<string, unknown> = {};
  if (isCallCard) metadata.kind = "call";
  if (attachments.length > 0) metadata.attachments = attachments;
  if (mentions.length > 0) metadata.mentions = mentions;

  const now = new Date();
  const [message] = await prisma.$transaction([
    prisma.conversationMessage.create({
      data: {
        conversationId: id,
        authorId: userId,
        body: text || (isCallCard ? "Started a call" : ""),
        parentId,
        metadata: Object.keys(metadata).length > 0 ? (metadata as Prisma.InputJsonValue) : undefined,
      },
      include: { author: { select: AUTHOR_SELECT } },
    }),
    prisma.conversation.update({ where: { id }, data: { lastMessageAt: now } }),
    prisma.conversationMember.update({ where: { id: membership.id }, data: { lastReadAt: now } }),
    // New activity re-opens closed (hidden) sidebars for every member —
    // Slack's rule: closing is tidy-up, never a way to miss messages.
    // Inside the send transaction: the reappear invariant is not
    // best-effort (fleet finding — a detached promise could fail silently).
    prisma.conversationMember.updateMany({
      where: { conversationId: id, hidden: true },
      data: { hidden: false },
    }),
  ]);

  // A reply changes its parent's reply count — touch the parent so every
  // open pane's updatedAt poll re-delivers it with fresh counts.
  if (parentId) {
    await prisma.conversationMessage.update({ where: { id: parentId }, data: { updatedAt: now } }).catch(() => {});
  }

  // Bell notifications. Three tiers, all deduped to ONE unread row per
  // conversation per person:
  //   mentions        → always ring (unless hard-muted) — "mention" type
  //   thread parent   → the person you replied to gets a ring
  //   notifyLevel all → the ordinary DM/group ring
  try {
    const link = `/tlk/${id}`;
    const senderName = `${message.author.firstName} ${message.author.lastName}`.trim();
    const convoLabel = membership.conversation.type === "DM"
      ? senderName
      : membership.conversation.type === "CHANNEL"
        ? `#${membership.conversation.name ?? "channel"}`
        : (membership.conversation.name || "a group chat");

    const members = await prisma.conversationMember.findMany({
      where: { conversationId: id, userId: { not: userId } },
      select: { userId: true, notifyLevel: true },
    });
    const mentionSet = new Set(mentions);

    let parentAuthorId: string | null = null;
    if (parentId) {
      const parent = await prisma.conversationMessage.findFirst({
        where: { id: parentId },
        select: { authorId: true },
      });
      if (parent && parent.authorId !== userId) parentAuthorId = parent.authorId;
    }

    const targets = members.filter((m) =>
      m.notifyLevel !== "mute" &&
      (mentionSet.has(m.userId) || m.userId === parentAuthorId || m.notifyLevel === "all"),
    );

    if (targets.length > 0) {
      const already = await prisma.notification.findMany({
        where: { userId: { in: targets.map((t) => t.userId) }, link, read: false },
        select: { userId: true },
      });
      const alreadySet = new Set(already.map((a) => a.userId));
      const fresh = targets.filter((t) => !alreadySet.has(t.userId));
      if (fresh.length > 0) {
        const preview = isCallCard
          ? "📞 Started a call — tap to join"
          : text ? stripMarkup(text.slice(0, 300)).slice(0, 140) : "📎 Sent an attachment";
        await prisma.notification.createMany({
          data: fresh.map((t) => ({
            userId: t.userId,
            title: mentionSet.has(t.userId)
              ? `${senderName} mentioned you in ${convoLabel}`
              : t.userId === parentAuthorId
                ? `${senderName} replied to your message in ${convoLabel}`
                : membership.conversation.type === "DM"
                  ? `New message from ${senderName}`
                  : `New messages in ${convoLabel}`,
            message: preview,
            type: mentionSet.has(t.userId) ? "mention" : "chat_message",
            link,
          })),
        });
      }
    }
  } catch (e) {
    // Notification failure must never fail the send itself.
    console.error("chat notify failed", e);
  }

  return jsonSuccess({ message: { ...message, replyCount: 0 } }, 201);
}
