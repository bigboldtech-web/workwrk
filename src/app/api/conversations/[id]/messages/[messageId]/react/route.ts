import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { Prisma } from "@/generated/prisma";
import { getSessionOrFail, getOrgId, getUserId, jsonError, jsonSuccess } from "@/lib/api-helpers";

// Toggle a reaction. Reactions live in the message's metadata as
// { reactions: { "👍": [userId, ...] } }. The row is locked FOR UPDATE
// inside a transaction so two simultaneous toggles can't lose each
// other's update; the write bumps updatedAt so the poll propagates it.

const ALLOWED = ["👍", "❤️", "😂", "🎉", "👀", "✅", "😮", "🙏", "🙌", "👏"];

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string; messageId: string }> }) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;
  const { id, messageId } = await params;
  const userId = getUserId(session);

  const member = await prisma.conversationMember.findFirst({
    where: { conversationId: id, userId, conversation: { organizationId: getOrgId(session) } },
    select: { id: true },
  });
  if (!member) return jsonError("Conversation not found", 404);

  const payload = await req.json().catch(() => null);
  const emoji = typeof payload?.emoji === "string" ? payload.emoji : "";
  if (!ALLOWED.includes(emoji)) return jsonError("Unsupported reaction", 400);

  const reactions = await prisma.$transaction(async (tx) => {
    const rows = await tx.$queryRaw<{ metadata: unknown; deletedAt: Date | null }[]>`
      SELECT "metadata", "deletedAt" FROM "ConversationMessage"
      WHERE "id" = ${messageId} AND "conversationId" = ${id}
      FOR UPDATE`;
    if (rows.length === 0 || rows[0].deletedAt) return null;

    const meta = (rows[0].metadata && typeof rows[0].metadata === "object" ? rows[0].metadata : {}) as Record<string, unknown>;
    const all = (meta.reactions && typeof meta.reactions === "object" ? meta.reactions : {}) as Record<string, string[]>;
    const users = Array.isArray(all[emoji]) ? all[emoji] : [];
    const next = users.includes(userId) ? users.filter((u) => u !== userId) : [...users, userId];
    if (next.length > 0) all[emoji] = next; else delete all[emoji];
    const newMeta = { ...meta, reactions: all };
    if (Object.keys(all).length === 0) delete (newMeta as Record<string, unknown>).reactions;

    await tx.conversationMessage.update({
      where: { id: messageId },
      data: { metadata: newMeta as Prisma.InputJsonValue },
    });
    return all;
  });

  if (reactions === null) return jsonError("Message not found", 404);
  return jsonSuccess({ reactions });
}
