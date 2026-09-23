import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { Prisma } from "@/generated/prisma";
import { jsonSuccess } from "@/lib/api-helpers";
import { conversationNotFound, loadConversationRole, talkGate } from "@/lib/talk-gate";
import { presignGetUrl } from "@/lib/s3";

// GET /api/conversations/[id]/files?cursor=: the Files section of the Details
// panel (spec-talk.md section 2.2).
//
// Attachments live inside `ConversationMessage.metadata`, so there is no file
// table to page: this reads the messages that carry one and flattens them.
// The read is capped and cursor-paged on the message id rather than loading a
// conversation's whole history to find twenty files.
//
// S3-backed attachments are re-presigned on every read, exactly as the message
// feed does, because a stored URL expires after an hour. A soft-deleted
// message contributes nothing: its attachments went with it.

const PAGE = 20;

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { error, gate } = await talkGate();
  if (error) return error;
  const { id } = await params;

  const ctx = await loadConversationRole(id, gate);
  if (!ctx || ctx.role === "none") return conversationNotFound();

  const { searchParams } = new URL(req.url);
  const cursor = searchParams.get("cursor");

  const anchor = cursor
    ? await prisma.conversationMessage.findFirst({ where: { id: cursor, conversationId: id }, select: { createdAt: true } })
    : null;

  // Scan a bounded window of message rows rather than the whole conversation.
  // A message with no attachment costs one row here and nothing downstream.
  const rows = await prisma.conversationMessage.findMany({
    where: {
      conversationId: id,
      deletedAt: null,
      ...(anchor ? { createdAt: { lt: anchor.createdAt } } : {}),
      // Prisma spells "this JSON column is not SQL NULL" as DbNull, not null.
      metadata: { not: Prisma.DbNull },
    },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: 200,
    select: {
      id: true,
      createdAt: true,
      metadata: true,
      author: { select: { id: true, firstName: true, lastName: true, avatar: true } },
    },
  });

  type Flat = {
    messageId: string;
    name: string;
    url: string;
    type: string;
    size: number;
    createdAt: Date;
    author: { id: string; name: string; avatar: string | null };
  };

  const flat: Flat[] = [];
  let lastScanned: string | null = null;
  for (const row of rows) {
    lastScanned = row.id;
    const meta = row.metadata as { attachments?: { url: string; name?: string; type?: string; size?: number; s3Key?: string }[] } | null;
    if (!Array.isArray(meta?.attachments)) continue;
    for (const a of meta.attachments) {
      let url = a.url;
      if (a.s3Key) {
        try { url = await presignGetUrl(a.s3Key, 3600); } catch { /* the stored URL is the fallback */ }
      }
      flat.push({
        messageId: row.id,
        name: a.name ?? "File",
        url,
        type: a.type ?? "application/octet-stream",
        size: typeof a.size === "number" ? a.size : 0,
        createdAt: row.createdAt,
        author: {
          id: row.author.id,
          name: `${row.author.firstName} ${row.author.lastName}`.trim(),
          avatar: row.author.avatar,
        },
      });
    }
    if (flat.length >= PAGE) break;
  }

  return jsonSuccess({
    files: flat.slice(0, PAGE),
    // More only when the window was actually full: a short scan reached the
    // beginning of the conversation and there is nothing further back.
    next: rows.length === 200 && lastScanned ? lastScanned : null,
  });
}
