// Asking an AI teammate in Talk: the server helpers
// (docs/plans/ai-teammates-phase2.md step 6). The route is
// src/app/api/conversations/[id]/teammates/route.ts; the pure rules are
// talk-address.ts.
//
// Server-only: imports prisma.

import { Prisma } from "@/generated/prisma";
import { anyGuestHere } from "@/lib/access/guests";
import { logActivity } from "@/lib/activity";
import { stripMarkup } from "@/lib/chat-markup";
import { prisma } from "@/lib/prisma";
import { AI_UPDATE_HIDDEN_KIND, serveAiUpdate } from "@/lib/talk-updates";
import { actorLabelFor, type ActingPerson } from "./acting";
import { clampText } from "./clamp";
import { TALK_TEAMMATE_LIMITS } from "./talk-address";
import { publishToUser } from "@/lib/realtime-bus";
import { actionHref } from "./actions";
import { APPROVAL_CARD, agentAuditLine, approvalNoticeMessage, approvalNoticeTitle } from "./teammate-copy";
import { actionViewFromRow } from "./teammate-thread";

/**
 * Whether any member of the conversation is a Guest now: a teammate is never
 * asked where one reads (Decision 8). A member whose access cannot be read
 * counts as one.
 */
export async function conversationHasGuests(conversationId: string, organizationId: string): Promise<boolean> {
  const members = await prisma.conversationMember.findMany({ where: { conversationId }, select: { userId: true }, take: 2000 });
  return anyGuestHere(organizationId, members.map((m) => m.userId));
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
 * answer is posted).
 */
export async function setRequestState(messageId: string, state: Record<string, unknown>): Promise<void> {
  const json = JSON.stringify(state);
  await prisma.$executeRaw`
    UPDATE "ConversationMessage"
    SET "metadata" = jsonb_set(COALESCE("metadata", '{}'::jsonb), '{teammate}', ${json}::jsonb, true),
        "updatedAt" = now() AT TIME ZONE 'UTC'
    WHERE "id" = ${messageId}`;
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
