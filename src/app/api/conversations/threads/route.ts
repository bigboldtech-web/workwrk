import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionAndModule, getOrgId, getUserId, jsonSuccess } from "@/lib/api-helpers";

// Threads I am in, for Talk home's Threads view (spec-talk section 2.1 Data).
//
// "A thread I am in" is exactly two things, and this is the union of both:
//   1. a thread where I wrote a reply, and
//   2. a thread hanging off a message I wrote.
//
// It is one raw query rather than four Prisma round trips because
// ConversationMessage has no self relation for replies (schema line 5714 is a
// bare nullable parentId, deliberately, so threads cost no migration churn),
// and because this list is polled. Everything is scoped twice, the way every
// other conversation route is: to the caller's organization AND to the
// conversations the caller is actually a member of. A thread in a channel you
// left does not appear even if your reply is still in it.
//
// Paging is an offset cursor rather than a keyed one: the sort key is
// MAX(reply.createdAt) over a GROUP BY, which no index can seek into, and the
// list is capped at a few pages in practice. `next` is null at the end.

const PAGE = 30;
const MAX_PAGE = 100;

type ThreadRow = {
  id: string;
  body: string;
  authorId: string;
  createdAt: Date;
  deletedAt: Date | null;
  conversationId: string;
  conversationType: string;
  conversationName: string | null;
  authorFirstName: string | null;
  authorLastName: string | null;
  authorAvatar: string | null;
  replyCount: number;
  unreadReplies: number;
  lastReplyAt: Date | null;
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

  // One extra row tells us whether a next page exists without a COUNT.
  const rows = await prisma.$queryRaw<ThreadRow[]>`
    WITH my_convos AS (
      SELECT cm."conversationId" AS cid, cm."lastReadAt" AS last_read
      FROM "ConversationMember" cm
      JOIN "Conversation" c ON c.id = cm."conversationId"
      WHERE cm."userId" = ${userId} AND c."organizationId" = ${orgId}
    ),
    my_threads AS (
      SELECT DISTINCT r."parentId" AS parent_id
      FROM "ConversationMessage" r
      JOIN my_convos mc ON mc.cid = r."conversationId"
      WHERE r."parentId" IS NOT NULL
        AND r."deletedAt" IS NULL
        AND r."authorId" = ${userId}
      UNION
      SELECT DISTINCT r."parentId" AS parent_id
      FROM "ConversationMessage" r
      JOIN "ConversationMessage" p ON p.id = r."parentId"
      JOIN my_convos mc ON mc.cid = r."conversationId"
      WHERE r."parentId" IS NOT NULL
        AND r."deletedAt" IS NULL
        AND p."authorId" = ${userId}
    )
    SELECT
      p.id                       AS "id",
      p.body                     AS "body",
      p."authorId"               AS "authorId",
      p."createdAt"              AS "createdAt",
      p."deletedAt"              AS "deletedAt",
      p."conversationId"         AS "conversationId",
      c.type::text               AS "conversationType",
      c.name                     AS "conversationName",
      u."firstName"              AS "authorFirstName",
      u."lastName"               AS "authorLastName",
      u.avatar                   AS "authorAvatar",
      COUNT(r.id)::int           AS "replyCount",
      COUNT(r.id) FILTER (
        WHERE r."createdAt" > mc.last_read AND r."authorId" <> ${userId}
      )::int                     AS "unreadReplies",
      MAX(r."createdAt")         AS "lastReplyAt"
    FROM my_threads mt
    JOIN "ConversationMessage" p ON p.id = mt.parent_id
    JOIN "Conversation" c        ON c.id = p."conversationId"
    JOIN my_convos mc            ON mc.cid = p."conversationId"
    LEFT JOIN "User" u           ON u.id = p."authorId"
    LEFT JOIN "ConversationMessage" r
      ON r."parentId" = p.id AND r."deletedAt" IS NULL
    GROUP BY p.id, c.type, c.name, u."firstName", u."lastName", u.avatar, mc.last_read
    ORDER BY MAX(r."createdAt") DESC NULLS LAST, p."createdAt" DESC
    LIMIT ${limit + 1} OFFSET ${offset}`;

  const page = rows.slice(0, limit);
  const threads = page.map((r) => ({
    parent: {
      id: r.id,
      // A removed parent keeps its thread reachable but never leaks its text,
      // the same blanking the messages route does on every read path.
      body: r.deletedAt ? "" : r.body,
      authorId: r.authorId,
      createdAt: r.createdAt,
      deleted: Boolean(r.deletedAt),
      author: {
        id: r.authorId,
        firstName: r.authorFirstName,
        lastName: r.authorLastName,
        avatar: r.authorAvatar,
      },
    },
    conversation: { id: r.conversationId, type: r.conversationType, name: r.conversationName },
    replyCount: r.replyCount,
    unreadReplies: r.unreadReplies,
    lastReplyAt: r.lastReplyAt,
  }));

  return jsonSuccess({ threads, next: rows.length > limit ? String(offset + limit) : null });
}
