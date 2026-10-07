// Asking an AI teammate in Talk: the server helpers
// (docs/plans/ai-teammates-phase2.md step 6). The route is
// src/app/api/conversations/[id]/teammates/route.ts; the pure rules are
// talk-address.ts.
//
// Server-only: imports prisma.

import { Prisma } from "@/generated/prisma";
import { anyGuestHere } from "@/lib/access/guests";
import { RULE_1_DENIED_STATUSES } from "@/lib/access/resolve";
import { logActivity } from "@/lib/activity";
import { stripMarkup } from "@/lib/chat-markup";
import { prisma } from "@/lib/prisma";
import { AI_UPDATE_HIDDEN_KIND, readableByAll, serveAiUpdate } from "@/lib/talk-updates";
import { actorLabelFor, type ActingPerson } from "./acting";
import { clampText } from "./clamp";
import { TALK_TEAMMATE_LIMITS } from "./talk-address";
import { publishToUser } from "@/lib/realtime-bus";
import { actionHref } from "./actions";
import { APPROVAL_CARD, agentAuditLine, approvalNoticeMessage, approvalNoticeTitle } from "./teammate-copy";
import { actionViewFromRow } from "./teammate-thread";


/**
 * Who reads the conversation, read once and bounded (review round 8: the
 * Guest check paged through every member of a channel of any size, on every
 * composer refresh, before the refusals that need no read). At most
 * maxReaders + 1 members are read, in no order (the index answers it): more
 * than maxReaders is refused anyway, so neither who they are nor whether one
 * is a Guest is read. Else the Guest check runs once over them all, a read
 * that fails counting as a Guest, and `ids` are those who can sign in now
 * (a member deactivated or deleted reads nothing, and is left off an
 * answer's readers so nobody let back in later reads it; review round 5).
 */
export async function conversationAudience(conversationId: string, organizationId: string): Promise<{ ids: string[]; tooMany: boolean; hasGuests: boolean }> {
  const rows = await prisma.conversationMember.findMany({
    where: { conversationId },
    select: { userId: true },
    take: TALK_TEAMMATE_LIMITS.maxReaders + 1,
  });
  if (rows.length > TALK_TEAMMATE_LIMITS.maxReaders) return { ids: [], tooMany: true, hasGuests: false };
  const members = [...new Set(rows.map((r) => r.userId))];
  if (members.length === 0) return { ids: [], tooMany: false, hasGuests: false };
  const [hasGuests, users] = await Promise.all([
    anyGuestHere(organizationId, members).catch(() => true),
    prisma.user.findMany({ where: { id: { in: members } }, select: { id: true, status: true, deletedAt: true } }),
  ]);
  const canSignIn = new Set(users.filter((u) => !u.deletedAt && !RULE_1_DENIED_STATUSES.has(String(u.status))).map((u) => u.id));
  return { ids: members.filter((id) => canSignIn.has(id)), tooMany: false, hasGuests };
}

/**
 * What the conversation said before the request, as the person may read it
 * (an AI update they are not a reader of is left out, as read_talk does),
 * oldest first: for a top-level request the 30 top-level messages before it,
 * in a thread its parent and the replies before it. Plain text, 500
 * characters each, 12,000 in all (the newest kept when it is too long).
 */
export async function talkContext(a: {
  conversationId: string;
  parentId: string | null;
  before: Date;
  beforeId: string;
  person: Pick<ActingPerson, "userId">;
  /**
   * Everyone who reads the conversation now (the answer's readers to be). A
   * message only some of them may read (an AI update, an earlier teammate's
   * answer, kept for who was there) is left out: else the new answer, read by
   * them all, could carry it to someone outside its list (review round 2).
   */
  readers: readonly string[];
}): Promise<Array<{ from: string; text: string }>> {
  const select = { id: true, body: true, metadata: true, createdAt: true, author: { select: { firstName: true, lastName: true, email: true } } } as const;
  const earlier: Prisma.ConversationMessageWhereInput = { OR: [{ createdAt: { lt: a.before } }, { createdAt: a.before, id: { lt: a.beforeId } }] };
  const rows = a.parentId
    ? [
        ...(await prisma.conversationMessage.findMany({ where: { id: a.parentId, conversationId: a.conversationId, deletedAt: null }, select })),
        ...(
          await prisma.conversationMessage.findMany({
            where: { conversationId: a.conversationId, parentId: a.parentId, deletedAt: null, AND: [earlier] },
            orderBy: [{ createdAt: "desc" }, { id: "desc" }],
            take: TALK_TEAMMATE_LIMITS.contextMessages,
            select,
          })
        ).reverse(),
      ]
    : (
        await prisma.conversationMessage.findMany({
          where: { conversationId: a.conversationId, parentId: null, deletedAt: null, AND: [earlier] },
          orderBy: [{ createdAt: "desc" }, { id: "desc" }],
          take: TALK_TEAMMATE_LIMITS.contextMessages,
          select,
        })
      ).reverse();
  const lines = rows
    .filter((x) => readableByAll(x.metadata, a.readers))
    .map((x) => serveAiUpdate(x, a.person.userId))
    .filter((x) => (x.metadata as { kind?: unknown } | null)?.kind !== AI_UPDATE_HIDDEN_KIND)
    .map((x) => ({
      from: `${x.author.firstName ?? ""} ${x.author.lastName ?? ""}`.trim() || x.author.email,
      text: clampText(stripMarkup(x.body).replace(/\s+/g, " ").trim(), TALK_TEAMMATE_LIMITS.messageChars),
    }))
    .filter((x) => x.text.length > 0);
  // The newest are the ones the request follows: drop the oldest past the total.
  const out: Array<{ from: string; text: string }> = [];
  let total = 0;
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    total += lines[i].text.length + lines[i].from.length;
    if (total > TALK_TEAMMATE_LIMITS.contextChars) break;
    out.unshift(lines[i]);
  }
  return out;
}

/**
 * Write the request's state into its message (metadata.teammate) in one
 * statement, so a reaction written at the same moment keeps its own keys
 * (Decision 30 covers the worst case: a "stale" line under a message whose
 * answer is posted). Its time is the app's clock, as every other write to
 * the row: the feed pages on updatedAt, and a database clock behind the
 * app's would put the change behind a cursor already past it.
 */
export async function setRequestState(messageId: string, state: Record<string, unknown>): Promise<void> {
  const json = JSON.stringify(state);
  await prisma.$executeRaw`
    UPDATE "ConversationMessage"
    SET "metadata" = jsonb_set(COALESCE("metadata", '{}'::jsonb), '{teammate}', ${json}::jsonb, true),
        "updatedAt" = ${new Date()}
    WHERE "id" = ${messageId}`;
}

/**
 * Whether the answer was posted where it was asked, on the teammate's own row
 * in the person's chat (meta.origin.postedMessageId: the Talk message, or
 * null when nothing was posted). The history then never tells the model it
 * posted what it did not (review round 2). A notice: never throws.
 */
export async function recordTalkOutcome(chatMessageId: string, postedMessageId: string | null): Promise<void> {
  try {
    await prisma.$executeRaw`
      UPDATE "ChatMessage"
      SET "meta" = jsonb_set("meta", '{origin,postedMessageId}', ${JSON.stringify(postedMessageId)}::jsonb, true)
      WHERE "id" = ${chatMessageId} AND jsonb_typeof("meta" -> 'origin') = 'object'`;
  } catch (err) {
    console.error(`[agents] talk outcome of ${chatMessageId} not saved: ${err instanceof Error ? err.message.split("\n").pop() : String(err)}`);
  }
}

/**
 * The audit line for an answer a teammate posted where the person asked it
 * ("Chief of Staff (for Max Chen): Answered in #proof"), the same row shape
 * as every other write it makes for the person (executor.ts auditAgentAction).
 */
export async function auditTalkAnswer(a: {
  person: Pick<ActingPerson, "userId" | "organizationId" | "name">;
  agent: { id: string; slug: string; name: string };
  what: string;
  conversationId: string;
  messageId: string;
  runId: string;
}): Promise<void> {
  await logActivity({
    type: "agent.talk_answer",
    actorId: a.person.userId,
    actorType: "agent",
    actorLabel: actorLabelFor(a.agent, a.person),
    actingForId: a.person.userId,
    organizationId: a.person.organizationId,
    description: agentAuditLine(a.agent.name, a.person.name, a.what),
    targetId: a.conversationId,
    targetType: "conversation",
    metadata: { agentId: a.agent.id, agentSlug: a.agent.slug, messageId: a.messageId, runId: a.runId, via: "talk" },
    severity: "info",
  });
}

/**
 * One Inbox row for what a Talk turn asked for, pointing at its first card
 * in the person's chat with the teammate (as a routine's: routines-server.ts
 * noticeApprovals; Decision 27). A notice: never throws.
 */
export async function noticeTalkApprovals(userId: string, agent: { slug: string; name: string }, ids: readonly string[], place: string): Promise<void> {
  try {
    const first = await prisma.agentAction.findFirst({
      where: { id: ids[0], actingForId: userId },
      select: { id: true, toolName: true, risk: true, status: true, preview: true, createdAt: true, expiresAt: true },
    });
    const title = first ? actionViewFromRow(first).preview.title : APPROVAL_CARD.untitled;
    await prisma.notification.create({
      data: { userId, type: "agent_approval", title: approvalNoticeTitle(agent.name), message: approvalNoticeMessage(ids.length, place, title), link: actionHref(agent.slug, ids[0]) },
    });
    publishToUser(userId, { type: "notification" });
  } catch (err) {
    console.error(`[agents] talk approval notice not written: ${err instanceof Error ? err.message.split("\n").pop() : String(err)}`);
  }
}
