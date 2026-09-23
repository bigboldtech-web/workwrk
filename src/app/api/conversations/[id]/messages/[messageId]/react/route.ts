import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { Prisma } from "@/generated/prisma";
import { jsonError, jsonSuccess } from "@/lib/api-helpers";
import { requireConversation } from "@/lib/talk-gate";
import { canReact } from "@/lib/talk-access";
import { REACTION_EMOJI } from "@/lib/emoji-data";

// Toggle a reaction. Reactions live in the message's metadata as
// { reactions: { "👍": [userId, ...] } }. The row is locked FOR UPDATE
// inside a transaction so two simultaneous toggles can't lose each
// other's update; the write bumps updatedAt so the poll propagates it.

// The allowlist is IMPORTED, not repeated. Before Phase 4 it was a literal
// here and a different literal in the client picker, and they disagreed:
// this list accepted clap, and no client surface could send it. One list,
// one test (src/lib/emoji-data.test.ts asserts the picker can produce every
// member of it), so the two cannot drift apart again.
const ALLOWED: readonly string[] = REACTION_EMOJI;

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string; messageId: string }> }) {
  const { id, messageId } = await params;
  // canReact is `comment` or better AND not archived: an archived channel is
  // read-only for everyone, and that has to be true of the API too, not just
  // of the buttons the page chooses to draw.
  const { error, ctx } = await requireConversation(id, { floor: "comment", allow: canReact, what: "react here" });
  if (error) return error;
  const userId = ctx.viewer.userId;

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
