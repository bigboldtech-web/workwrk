import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { jsonError, jsonSuccess } from "@/lib/api-helpers";
import { requireConversation } from "@/lib/talk-gate";
import { canPost } from "@/lib/talk-access";
import { presignGetUrl } from "@/lib/s3";
import { publishToConversation } from "@/lib/realtime-bus";
import { afterMessageSent, insertConversationMessage } from "@/lib/talk-post";

// Messages: cursor-paged reads plus sends. This is the hot path (the open
// pane polls GET every few seconds), so reads are one indexed query and
// sends touch exactly the rows they must.
//
// Phase 5: the after-cursor keys on updatedAt (not createdAt) so
// reactions, edits and deletes to OLD messages flow through the same
// poll; threads ride parentId; mentions and attachments ride metadata.
//
// PHASE 4 ACCESS. Both verbs now stand behind requireConversation, which
// reads the viewer's ROLE rather than a bare ConversationMember row. Two
// real faults went with that change: an Owner or Admin holding Full access
// on a public channel they had not joined used to get the whole page and a
// 404 from this route, so the feed showed "Couldn't load messages" beside a
// live message box; and POST never looked at archivedAt, so a stale tab
// could write into a channel the product presents as frozen.

const PAGE = 50;
const MAX_BODY = 8000;
const MAX_ATTACHMENTS = 10;

const AUTHOR_SELECT = { id: true, firstName: true, lastName: true, avatar: true } as const;

/** The composer's key for one message: its optimistic row's id ("temp-<ms>-<rand>"). */
const CLIENT_ID = /^[A-Za-z0-9_-]{8,64}$/;

/**
 * The message this author already sent here with this key, served exactly as
 * a read serves it (a removed one blanked, attachments freshly signed), or
 * null when there is none.
 */
async function alreadySent(conversationId: string, authorId: string, clientId: string) {
  const row = await prisma.conversationMessage.findFirst({
    where: { conversationId, authorId, clientId },
    include: { author: { select: AUTHOR_SELECT } },
  });
  if (!row) return null;
  const replyCount = await prisma.conversationMessage.count({ where: { parentId: row.id, deletedAt: null } });
  const [served] = await serveMessages([{ ...row, replyCount }]);
  return served;
}

/**
 * The answer to a send whose key already landed: the first send's message.
 * A removed one is refused instead (the person's words stay in their
 * "Not sent" row, never swapped for a blank). The cheap after-commit steps,
 * the nudge to open panes and a reply's parent touch, run again: both are
 * safe twice, and the first send may have died before reaching them. The
 * Inbox fan-out runs once, on the first send.
 */
async function answerDuplicate(conversationId: string, sent: NonNullable<Awaited<ReturnType<typeof alreadySent>>>) {
  if (sent.deletedAt) return jsonError("This message was removed after it was sent.", 409);
  publishToConversation(conversationId, { type: "message", conversationId });
  if (sent.parentId) {
    await prisma.conversationMessage.update({ where: { id: sent.parentId }, data: { updatedAt: new Date() } }).catch(() => {});
  }
  return jsonSuccess({ message: sent, duplicate: true }, 200);
}

/** Outbound shaping for every read path:
 *  - "removed" messages must not leak their content through the API:
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

/** What the feed's thread chip needs for one parent: "3 replies, last reply
 *  2h ago" and the two faces beside it (spec-talk section 2.2). One indexed
 *  read over the whole page's replies rather than a groupBy plus N lookups. */
export type ReplyMeta = { count: number; lastReplyAt: string; authorIds: string[] };

async function replyMeta(conversationId: string, parentIds: string[]): Promise<Map<string, ReplyMeta>> {
  const out = new Map<string, ReplyMeta>();
  if (parentIds.length === 0) return out;
  const rows = await prisma.conversationMessage.findMany({
    where: { conversationId, parentId: { in: parentIds }, deletedAt: null },
    orderBy: [{ createdAt: "asc" }],
    select: { parentId: true, authorId: true, createdAt: true },
  });
  for (const r of rows) {
    if (!r.parentId) continue;
    const cur = out.get(r.parentId) ?? { count: 0, lastReplyAt: r.createdAt.toISOString(), authorIds: [] };
    cur.count += 1;
    cur.lastReplyAt = r.createdAt.toISOString();
    if (!cur.authorIds.includes(r.authorId) && cur.authorIds.length < 3) cur.authorIds.push(r.authorId);
    out.set(r.parentId, cur);
  }
  return out;
}

/** The shape every read path hangs on a top-level message. */
function withReplies<T extends { id: string }>(rows: T[], meta: Map<string, ReplyMeta>) {
  return rows.map((m) => {
    const r = meta.get(m.id);
    return {
      ...m,
      replyCount: r?.count ?? 0,
      lastReplyAt: r?.lastReplyAt ?? null,
      replyAuthorIds: r?.authorIds ?? [],
    };
  });
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  // Read needs `view`: an archived channel still reads, and a Full holder who
  // is not a member (an Admin on a public channel) reads rather than 404s.
  const { error } = await requireConversation(id, { floor: "view" });
  if (error) return error;

  const { searchParams } = new URL(req.url);
  const before = searchParams.get("before");  // message id: page older history
  const after = searchParams.get("after");    // ISO timestamp: poll for changes
  const parent = searchParams.get("parent");  // message id: a thread's replies
  const around = searchParams.get("around");  // message id: open AT a message

  // ?around=<messageId> is what makes ?m= work: a search hit, a mention
  // notification or a copied link lands on ONE message that may be a thousand
  // rows back, and before this the feed simply opened at the bottom and the
  // highlight had nothing to highlight. It answers the page containing that
  // message plus context on both sides, and says whether there is more in
  // either direction so the feed knows which way it may still page.
  if (around) {
    const anchor = await prisma.conversationMessage.findFirst({
      where: { id: around, conversationId: id },
      select: { id: true, createdAt: true, parentId: true },
    });
    if (!anchor) return jsonError("Message not found", 404);
    // A reply opens its thread's parent in context, not the reply itself:
    // the main feed holds top-level messages only.
    const feedAnchor = anchor.parentId
      ? await prisma.conversationMessage.findFirst({
          where: { id: anchor.parentId, conversationId: id },
          select: { id: true, createdAt: true },
        })
      : { id: anchor.id, createdAt: anchor.createdAt };
    if (!feedAnchor) return jsonError("Message not found", 404);

    const HALF = 25;
    const [olderDesc, newerAsc] = await Promise.all([
      prisma.conversationMessage.findMany({
        where: { conversationId: id, parentId: null, createdAt: { lt: feedAnchor.createdAt } },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: HALF + 1,
        include: { author: { select: AUTHOR_SELECT } },
      }),
      prisma.conversationMessage.findMany({
        where: { conversationId: id, parentId: null, createdAt: { gte: feedAnchor.createdAt } },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        take: HALF + 1,
        include: { author: { select: AUTHOR_SELECT } },
      }),
    ]);
    const hasMore = olderDesc.length > HALF;          // older history above
    const hasNewer = newerAsc.length > HALF;          // unread tail below
    const window = [...olderDesc.slice(0, HALF).reverse(), ...newerAsc.slice(0, HALF)];
    const counts = await replyMeta(id, window.map((m) => m.id));
    const served = await serveMessages(window);
    return jsonSuccess({
      messages: withReplies(served, counts),
      hasMore,
      hasNewer,
      // Which message to scroll to and paint: the reply when it was a reply,
      // so the thread chip under the parent is the thing that glows.
      anchorId: feedAnchor.id,
      threadParentId: anchor.parentId ?? null,
    });
  }

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
    // one timestamp (the migration backfilled identical updatedAt values,
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
    const counts = await replyMeta(id, messages.filter((m) => !m.parentId).map((m) => m.id));
    const served = await serveMessages(messages);
    const last = messages[messages.length - 1];
    return jsonSuccess({
      messages: withReplies(served, counts),
      // 200 rows means there may be more in this poll, so the client re-polls
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
  const counts = await replyMeta(id, window.map((m) => m.id));
  const served = await serveMessages(window);
  const messages = withReplies(served.reverse(), counts);
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
      // S3 object key: reads re-presign from this; local uploads omit it.
      ...(typeof a?.s3Key === "string" && a.s3Key ? { s3Key: a.s3Key.slice(0, 512) } : {}),
    });
  }
  return out;
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  // canPost is the pure predicate: `edit` or better AND not archived. A stale
  // tab that still shows a message box now gets one 403 with a sentence,
  // rather than writing into a frozen conversation.
  const { error, ctx } = await requireConversation(id, { floor: "edit", allow: canPost, what: "post here" });
  if (error) return error;
  const userId = ctx.viewer.userId;
  const membershipId = ctx.membershipId;
  const conversationFacts = { type: ctx.conversation.type, name: ctx.conversation.name };

  const payload = await req.json().catch(() => null);
  const text = typeof payload?.body === "string" ? payload.body.trim() : "";
  const isCallCard = payload?.metadata?.kind === "call";
  const attachments = payload?.metadata?.attachments !== undefined ? cleanAttachments(payload.metadata.attachments) : [];
  if (attachments === null) return jsonError("Bad attachments", 400);
  if (!text && !isCallCard && attachments.length === 0) return jsonError("Message can't be empty", 400);
  if (text.length > MAX_BODY) return jsonError("Message is too long", 400);

  // The sender's key for this one composed message. Retry, or a keepalive
  // send that landed while the tab thought it had failed, sends it again:
  // the answer is the message the first send made, never a second copy and
  // never a second ring for everyone in the conversation.
  const clientId = typeof payload?.clientId === "string" && CLIENT_ID.test(payload.clientId) ? payload.clientId : null;
  if (clientId) {
    const sent = await alreadySent(id, userId, clientId);
    if (sent) return answerDuplicate(id, sent);
  }

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

  // The write and everything after it are src/lib/talk-post.ts, shared with
  // the scheduled AI updates, so a message is stored, announced and rung one
  // way whoever sends it.
  const now = new Date();
  const posted = await insertConversationMessage({
    conversationId: id,
    authorId: userId,
    membershipId,
    body: text || (isCallCard ? "Started a call" : ""),
    parentId,
    metadata,
    clientId,
    now,
  });
  if (!posted.ok) {
    // Two sends with one key at once: the second insert loses on the unique
    // index and is answered with the first one's message.
    const sent = clientId ? await alreadySent(id, userId, clientId) : null;
    if (sent) return answerDuplicate(id, sent);
    throw posted.error;
  }
  const message = posted.message;

  await afterMessageSent({
    conversationId: id,
    conversation: conversationFacts,
    message,
    authorId: userId,
    text,
    mentions,
    parentId,
    isCallCard,
    now,
  });

  return jsonSuccess({ message: { ...message, replyCount: 0 } }, 201);
}
