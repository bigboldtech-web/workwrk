// The write half of posting one Talk message, shared by the composer's route
// (POST /api/conversations/[id]/messages) and the scheduled AI updates
// (src/lib/talk-updates-server.ts), so a message is stored, announced and
// rung exactly one way whoever sends it.
//
// The CALLER decides who may post (requireConversation for a person at the
// keyboard; the same talkRole/canPost over a gate built for the author on a
// server run), validates the body, the mentions and the thread parent, and
// answers a repeated clientId. This file only does what happens once that is
// settled:
//
//   insertConversationMessage  the message, the conversation's lastMessageAt,
//                              the author's own read cursor (when they are a
//                              member and at the keyboard), and closed rows
//                              re-opened for every member, in ONE transaction
//   afterMessageSent           the realtime nudge, a thread parent's touch,
//                              and the Inbox notifications, which never fail
//                              the send
//
// Server-only: imports prisma.

import { prisma } from "@/lib/prisma";
import type { Prisma } from "@/generated/prisma";
import { stripMarkup } from "@/lib/chat-markup";
import { publishToConversation, publishToUser } from "@/lib/realtime-bus";
import { inboxKeyForMessage, inboxRecordOf, inboxRowEnabled } from "@/lib/inbox-notify-keys";

export const MESSAGE_AUTHOR_SELECT = { id: true, firstName: true, lastName: true, avatar: true } as const;

function createMessage(data: Prisma.ConversationMessageUncheckedCreateInput) {
  return prisma.conversationMessage.create({ data, include: { author: { select: MESSAGE_AUTHOR_SELECT } } });
}

export type PostedMessage = Awaited<ReturnType<typeof createMessage>>;

export async function insertConversationMessage(args: {
  conversationId: string;
  authorId: string;
  /**
   * The author's own membership row, whose read cursor moves to now: only
   * for a person at the keyboard. A scheduled post passes null, so it never
   * marks as read what its author has not read.
   */
  membershipId: string | null;
  body: string;
  parentId: string | null;
  metadata: Record<string, unknown>;
  clientId: string | null;
  now: Date;
}): Promise<{ ok: true; message: PostedMessage } | { ok: false; duplicate: true; error: unknown }> {
  const { conversationId: id, now } = args;
  try {
    const [message] = await prisma.$transaction([
      createMessage({
        conversationId: id,
        authorId: args.authorId,
        body: args.body,
        parentId: args.parentId,
        metadata: Object.keys(args.metadata).length > 0 ? (args.metadata as Prisma.InputJsonValue) : undefined,
        clientId: args.clientId,
      }),
      prisma.conversation.update({ where: { id }, data: { lastMessageAt: now } }),
      // A Full holder who is not a member (an Admin on a public channel) has no
      // row to stamp; everybody else marks their own read cursor.
      ...(args.membershipId
        ? [prisma.conversationMember.update({ where: { id: args.membershipId }, data: { lastReadAt: now } })]
        : []),
      // New activity re-opens closed (hidden) sidebars for every member.
      // Slack's rule: closing is tidy-up, never a way to miss messages.
      // Inside the send transaction: the reappear invariant is not
      // best-effort (fleet finding: a detached promise could fail silently).
      prisma.conversationMember.updateMany({
        where: { conversationId: id, hidden: true },
        data: { hidden: false },
      }),
    ]);
    return { ok: true, message: message as PostedMessage };
  } catch (err) {
    // Two sends with one key at once: the second insert loses on the unique
    // index, and the caller answers with the first one's message.
    if (args.clientId && (err as { code?: string })?.code === "P2002") return { ok: false, duplicate: true, error: err };
    throw err;
  }
}

export async function afterMessageSent(args: {
  conversationId: string;
  conversation: { type: "DM" | "GROUP" | "CHANNEL"; name: string | null };
  message: PostedMessage;
  authorId: string;
  /** The message's own words, for the notification preview. */
  text: string;
  mentions: string[];
  parentId: string | null;
  isCallCard: boolean;
  now: Date;
  /**
   * Ring only these people (a scheduled AI update rings only the readers it
   * was checked against). Absent: every member, as for any message.
   */
  onlyUserIds?: readonly string[];
  /**
   * Who the notice names as sending it, in place of the author's name: a
   * teammate's answer posted as the person ("Chief of Staff for Ola Owner"),
   * which the person never read before it went out (review round 7).
   */
  senderLabel?: string;
}): Promise<void> {
  const { conversationId: id, conversation: conversationFacts, message, authorId: userId, text, parentId, isCallCard, now } = args;

  // Real-time: nudge every member's open SSE stream to refetch this thread
  // (trigger-only; the body is re-fetched through the redaction path).
  publishToConversation(id, { type: "message", conversationId: id });

  // A reply changes its parent's reply count, so touch the parent and every
  // open pane's updatedAt poll re-delivers it with fresh counts.
  if (parentId) {
    await prisma.conversationMessage.update({ where: { id: parentId }, data: { updatedAt: now } }).catch(() => {});
  }

  // Bell notifications. Three tiers, all deduped to ONE unread row per
  // conversation per person:
  //   mentions        always ring (unless hard-muted), as type "mention"
  //   thread parent   the person you replied to gets a ring
  //   notifyLevel all the ordinary DM or channel ring
  //
  // On top of the per-conversation level sits the person's own Inbox choice
  // (My settings > Notifications > Inbox): home.notifications.inbox.dm,
  // .channel and .calls. Absent means on, so nobody who has never opened
  // that page loses a notification. A MENTION is never suppressed by it:
  // "Direct messages off" is about volume, not about being ignored.
  try {
    const link = `/tlk/${id}`;
    const senderName = args.senderLabel?.trim() || `${message.author.firstName} ${message.author.lastName}`.trim();
    const convoLabel = conversationFacts.type === "DM"
      ? senderName
      : conversationFacts.type === "CHANNEL"
        ? `#${conversationFacts.name ?? "channel"}`
        : (conversationFacts.name || "a group chat");

    const onlySet = args.onlyUserIds ? new Set(args.onlyUserIds) : null;
    const members = (await prisma.conversationMember.findMany({
      where: { conversationId: id, userId: { not: userId } },
      select: { userId: true, notifyLevel: true },
    })).filter((m) => !onlySet || onlySet.has(m.userId));
    const mentionSet = new Set(args.mentions);

    // One read for the whole roster rather than one per person. The key and
    // the "absent means on" rule live in src/lib/inbox-notify-keys.ts, which
    // the settings page reads too, so a row cannot be labelled one thing and
    // gated on another.
    const inboxKey = inboxKeyForMessage(conversationFacts.type, isCallCard);
    const prefRows = members.length > 0
      ? await prisma.userPreference.findMany({
          where: { userId: { in: members.map((m) => m.userId) } },
          select: { userId: true, home: true },
        }).catch(() => [] as Array<{ userId: string; home: unknown }>)
      : [];
    const inboxOff = new Set<string>();
    for (const row of prefRows) {
      if (!inboxRowEnabled(inboxRecordOf(row.home), inboxKey)) inboxOff.add(row.userId);
    }

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
      (mentionSet.has(m.userId) || m.userId === parentAuthorId || m.notifyLevel === "all") &&
      (mentionSet.has(m.userId) || !inboxOff.has(m.userId)),
    );

    // A CALL IS NOT A BELL ROW (spec-talk.md section 4 step 10: "call_incoming
    // never lands as a row; it is the ring"). The live answer is the incoming
    // call card, and the durable record is the call card message in the
    // conversation, which keeps its roster and its duration. A notification
    // about a call that rang out twenty minutes ago cannot be acted on.
    if (targets.length > 0 && !isCallCard) {
      // Priority targets (mentioned, or the person you replied to) always
      // get their own notification, because an earlier plain unread must never
      // swallow a mention. Only ordinary "all"-tier targets dedup against
      // an existing unread row for this conversation.
      const isPriority = (uid: string) => mentionSet.has(uid) || uid === parentAuthorId;
      const already = await prisma.notification.findMany({
        where: { userId: { in: targets.map((t) => t.userId) }, link, read: false },
        select: { userId: true },
      });
      const alreadySet = new Set(already.map((a) => a.userId));
      const fresh = targets.filter((t) => isPriority(t.userId) || !alreadySet.has(t.userId));
      if (fresh.length > 0) {
        const preview = text ? stripMarkup(text.slice(0, 300)).slice(0, 140) : "Sent an attachment";
        await prisma.notification.createMany({
          data: fresh.map((t) => ({
            userId: t.userId,
            title: mentionSet.has(t.userId)
              ? `${senderName} mentioned you in ${convoLabel}`
              : t.userId === parentAuthorId
                ? `${senderName} replied to your message in ${convoLabel}`
                : conversationFacts.type === "DM"
                  ? `New message from ${senderName}`
                  : `New messages in ${convoLabel}`,
            message: preview,
            // Three kinds, because the Inbox routes by type string and a DM
            // is addressed to you while a channel's ambient ring is not
            // (src/lib/inbox-kinds.ts is the routing table): a mention is
            // Primary and in the Mentions tab, a DM is Primary, a channel or
            // group message is Other.
            type: mentionSet.has(t.userId)
              ? "mention"
              : conversationFacts.type === "DM"
                ? "chat_message_dm"
                : "chat_message",
            link,
          })),
        });
        // Real-time: ping each notified user's stream so their bell/ring
        // updates instantly (trigger-only; they refetch their own rows).
        for (const t of fresh) publishToUser(t.userId, { type: "notification" });
      }
    }
  } catch (e) {
    // Notification failure must never fail the send itself.
    console.error("chat notify failed", e);
  }
}
