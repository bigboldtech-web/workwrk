import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionAndModule, getOrgId, getUserId, jsonSuccess } from "@/lib/api-helpers";

// Messages that mention me, for Talk home's Mentions view (spec-talk
// section 2.1 Data).
//
// The spec calls these "the `mention` notification rows joined to messages".
// They are read off the MESSAGE instead, because a notification row carries
// only a conversation link and no message id (see the createMany in
// api/conversations/[id]/messages/route.ts), so a notification join cannot
// answer "which message" and the view's whole job is to open one message in
// context. The mention list is written into `metadata.mentions` by the same
// send path that writes the notification, so the two cannot disagree.
//
// Read state is the conversation's own lastReadAt, which is the number the
// sidebar and the Unread view already show, so the three counts agree.
//
// Scoped twice like every conversation route: the caller's organization AND
// a live membership. Leaving a channel takes its mentions with it.

const PAGE = 30;
const MAX_PAGE = 100;

type MentionRow = {
  id: string;
  body: string;
  authorId: string;
  createdAt: Date;
  conversationId: string;
  conversationType: string;
  conversationName: string | null;
  authorFirstName: string | null;
  authorLastName: string | null;
  authorAvatar: string | null;
  unread: boolean;
};

export async function GET(req: NextRequest) {
  const { error, session } = await getSessionAndModule("workwrk-talk");
  if (error) return error;
  const userId = getUserId(session);
  const orgId = getOrgId(session);

  const rawCursor = Number(req.nextUrl.searchParams.get("cursor") ?? "0");
  const offset = Number.isFinite(rawCursor) && rawCursor > 0 ? Math.min(Math.floor(rawCursor), 5000) : 0;
  const rawLimit = Number(req.nextUrl.searchParams.get("limit") ?? PAGE);
  const limit = Number.isFinite(rawLimit) && rawLimit > 0 ? Math.min(Math.floor(rawLimit), MAX_PAGE) : PAGE;

  const rows = await prisma.$queryRaw<MentionRow[]>`
    SELECT
      m.id               AS "id",
      m.body             AS "body",
      m."authorId"       AS "authorId",
      m."createdAt"      AS "createdAt",
      m."conversationId" AS "conversationId",
      c.type::text       AS "conversationType",
      c.name             AS "conversationName",
      u."firstName"      AS "authorFirstName",
      u."lastName"       AS "authorLastName",
      u.avatar           AS "authorAvatar",
      (m."createdAt" > cm."lastReadAt") AS "unread"
    FROM "ConversationMessage" m
    JOIN "ConversationMember" cm
      ON cm."conversationId" = m."conversationId" AND cm."userId" = ${userId}
    JOIN "Conversation" c
      ON c.id = m."conversationId" AND c."organizationId" = ${orgId}
    LEFT JOIN "User" u ON u.id = m."authorId"
    WHERE m."deletedAt" IS NULL
      AND m."authorId" <> ${userId}
      AND m.metadata -> 'mentions' @> ${JSON.stringify(userId)}::jsonb
    ORDER BY m."createdAt" DESC
    LIMIT ${limit + 1} OFFSET ${offset}`;

  const page = rows.slice(0, limit);
  const mentions = page.map((r) => ({
    message: {
      id: r.id,
      body: r.body,
      authorId: r.authorId,
      createdAt: r.createdAt,
      unread: r.unread,
      author: {
        id: r.authorId,
        firstName: r.authorFirstName,
        lastName: r.authorLastName,
        avatar: r.authorAvatar,
      },
    },
    conversation: { id: r.conversationId, type: r.conversationType, name: r.conversationName },
  }));

  return jsonSuccess({ mentions, next: rows.length > limit ? String(offset + limit) : null });
}
