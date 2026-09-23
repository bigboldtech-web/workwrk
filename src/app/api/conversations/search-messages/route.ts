import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { Prisma } from "@/generated/prisma";
import { jsonError, jsonSuccess } from "@/lib/api-helpers";
import { talkGate } from "@/lib/talk-gate";

// Message search across MY conversations. One indexed-join query, capped.
//
// PHASE 4 adds the three parameters the conversation Search panel needs
// (spec-talk.md section 2.2 Right panel > Search):
//
//   conversationId  scope the search to the conversation I am standing in
//   files=1         only messages that carry an attachment
//   from=<userId>   only messages by one person
//
// The membership filter is unchanged and is the whole security model here: a
// message is reachable only through a conversation with a row for me, so a
// `conversationId` I am not in returns nothing rather than 403ing, which is
// the same answer an id that does not exist gives.

export async function GET(req: NextRequest) {
  const { error, gate } = await talkGate();
  if (error) return error;

  const { searchParams } = new URL(req.url);
  const q = (searchParams.get("q") ?? "").trim();
  const conversationId = searchParams.get("conversationId");
  const filesOnly = searchParams.get("files") === "1";
  const from = searchParams.get("from");

  // With a filter on, an empty query is a legitimate search ("every file in
  // this channel"); without one it is not, because that is the whole history.
  const filtered = filesOnly || Boolean(from);
  if (!filtered && q.length < 2) return jsonError("Type at least 2 characters", 400);
  if (q.length > 200) return jsonError("Query too long", 400);

  const rows = await prisma.conversationMessage.findMany({
    where: {
      deletedAt: null,
      ...(q.length >= 2 ? { body: { contains: q, mode: "insensitive" as const } } : {}),
      ...(from ? { authorId: from } : {}),
      // An attachment lives inside metadata, so "has a file" is a JSON-path
      // question. Prisma cannot ask "array is non-empty" on a JSON column, so
      // this narrows to rows that have metadata at all and the flattening
      // below drops the ones whose metadata holds only mentions.
      ...(filesOnly ? { metadata: { not: Prisma.DbNull } } : {}),
      conversation: {
        organizationId: gate.organizationId,
        members: { some: { userId: gate.userId } },
        ...(conversationId ? { id: conversationId } : {}),
      },
    },
    orderBy: { createdAt: "desc" },
    take: filesOnly ? 120 : 20,
    select: {
      id: true,
      body: true,
      createdAt: true,
      parentId: true,
      metadata: true,
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

  const results = rows
    .filter((r) => {
      if (!filesOnly) return true;
      const meta = r.metadata as { attachments?: unknown[] } | null;
      return Array.isArray(meta?.attachments) && meta.attachments.length > 0;
    })
    .slice(0, 20)
    .map((r) => {
      const meta = r.metadata as { attachments?: { name?: string }[] } | null;
      return {
        messageId: r.id,
        conversationId: r.conversation.id,
        conversationType: r.conversation.type,
        conversationName: r.conversation.name,
        members: r.conversation.members,
        author: r.author,
        snippet: r.body.length > 160 ? r.body.slice(0, 160) + "…" : r.body,
        attachmentNames: Array.isArray(meta?.attachments)
          ? meta.attachments.map((a) => a?.name ?? "File").slice(0, 3)
          : [],
        createdAt: r.createdAt,
        inThread: Boolean(r.parentId),
      };
    });

  return jsonSuccess({ results });
}
