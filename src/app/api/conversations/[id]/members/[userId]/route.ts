import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { jsonError, jsonSuccess } from "@/lib/api-helpers";
import { conversationNotFound, loadConversationRole, needFullAccess, talkGate } from "@/lib/talk-gate";
import { canManageMembers, isGeneralChannel } from "@/lib/talk-access";

// DELETE /api/conversations/[id]/members/[userId]: remove somebody from a
// channel or a group (spec-talk.md section 2.2 Details > Members).
//
// Full access only, which in practice is the creator plus Owners and Admins on
// a public channel. Two refusals are deliberate and are not "extra safety":
//
//   1. The LAST Full holder cannot be removed. A channel whose only owner has
//      been removed is a channel nobody can rename, archive or restore, and
//      the product has no way to hand it back.
//   2. Removing yourself is Leave, not Remove, and Leave already exists with
//      its own epoch bump. Two doors to one act is how the two drift.
//
// The epoch bump is the same one Leave does: it rotates the derived call room
// so a removed member's captured room name cannot rejoin a future call.

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string; userId: string }> }) {
  const { error, gate } = await talkGate();
  if (error) return error;
  const { id, userId } = await params;

  const ctx = await loadConversationRole(id, gate);
  if (!ctx || ctx.role === "none") return conversationNotFound();
  if (!canManageMembers(ctx.conversation, ctx.role)) return needFullAccess("remove people");

  if (userId === gate.userId) {
    return jsonError("Use Leave to remove yourself", 400);
  }

  // #general refuses removal for the same reason it refuses Leave: the channel
  // directory re-adds everybody in the organization on the next load, so the
  // removal would last one poll and silently wipe that person's read state on
  // the way. An honest refusal beats a removal that undoes itself.
  if (isGeneralChannel(ctx.conversation)) {
    return jsonError("Everyone's in #general and can't be removed from it", 400);
  }

  const target = await prisma.conversationMember.findFirst({
    where: { conversationId: id, userId },
    select: { id: true },
  });
  if (!target) return jsonError("That person isn't in this conversation", 404);

  if (ctx.conversation.createdById === userId) {
    return jsonError("Transfer this conversation to somebody else before removing its owner", 400);
  }

  await prisma.$transaction([
    prisma.conversationMember.delete({ where: { id: target.id } }),
    prisma.conversation.update({ where: { id }, data: { callEpoch: { increment: 1 } } }),
  ]);

  return jsonSuccess({ ok: true });
}
