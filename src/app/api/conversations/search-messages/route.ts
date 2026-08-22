import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionOrFail, getOrgId, getUserId, jsonError, jsonSuccess } from "@/lib/api-helpers";

// Basic chat search: recent messages across MY conversations matching a
// substring. One indexed-join query, capped at 20 rows — good enough to
// find "that thing someone said last week" without a search engine.

export async function GET(req: NextRequest) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;
  const userId = getUserId(session);
  const orgId = getOrgId(session);

  const { searchParams } = new URL(req.url);
  const q = (searchParams.get("q") ?? "").trim();
  if (q.length < 2) return jsonError("Type at least 2 characters", 400);
  if (q.length > 200) return jsonError("Query too long", 400);

  const rows = await prisma.conversationMessage.findMany({
    where: {
      deletedAt: null,
      body: { contains: q, mode: "insensitive" },
      conversation: {
        organizationId: orgId,
        members: { some: { userId } },
      },
    },
    orderBy: { createdAt: "desc" },
    take: 20,
    select: {
      id: true,
      body: true,
      createdAt: true,
      parentId: true,
      author: { select: { id: true, firstName: true, lastName: true } },
      conversation: {
        select: {
          id: true,
          type: true,
          name: true,
          members: {
            select: { userId: true, user: { select: { id: true, firstName: true, lastName: true, avatar: true } } },
            take: 4,
          },
        },
      },
    },
  });

  const results = rows.map((r) => ({
    messageId: r.id,
    conversationId: r.conversation.id,
    conversationType: r.conversation.type,
    conversationName: r.conversation.name,
    members: r.conversation.members,
    author: r.author,
    snippet: r.body.length > 160 ? r.body.slice(0, 160) + "…" : r.body,
    createdAt: r.createdAt,
    inThread: Boolean(r.parentId),
  }));

  return jsonSuccess({ results });
}
