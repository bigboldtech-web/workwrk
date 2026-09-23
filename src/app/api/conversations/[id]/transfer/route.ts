import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { jsonError, jsonSuccess } from "@/lib/api-helpers";
import { conversationNotFound, loadConversationRole, needFullAccess, talkGate } from "@/lib/talk-gate";
import { canManageMembers } from "@/lib/talk-access";

// POST /api/conversations/[id]/transfer { userId }: hand a channel or group
// to somebody else (spec-talk.md section 2.2 Details > Members > Make owner).
//
// `Conversation.createdById` IS the owner: the column already existed and was
// only ever used as an audit stamp, so "the creator holds Full access" had no
// way to move when the creator left the company. Writing it here is what makes
// the access table's "Owner ... transferable" true rather than aspirational.
//
// The new owner must already be a member. Handing a channel to somebody
// outside it would grant Full access to a person with no row, and the next
// read would 404 for them.

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { error, gate } = await talkGate();
  if (error) return error;
  const { id } = await params;

  const ctx = await loadConversationRole(id, gate);
  if (!ctx || ctx.role === "none") return conversationNotFound();
  if (!canManageMembers(ctx.conversation, ctx.role)) return needFullAccess("transfer this conversation");
  if (ctx.conversation.type === "DM") return jsonError("A direct message has no owner", 400);

  const body = await req.json().catch(() => null);
  const userId = typeof body?.userId === "string" ? body.userId : null;
  if (!userId) return jsonError("Pick somebody to transfer this to", 400);
  if (userId === ctx.conversation.createdById) return jsonError("They already own this conversation", 400);

  const target = await prisma.conversationMember.findFirst({
    where: { conversationId: id, userId },
    select: { user: { select: { id: true, firstName: true, lastName: true } } },
  });
  if (!target) return jsonError("Add them to this conversation first", 400);

  await prisma.conversation.update({ where: { id }, data: { createdById: userId } });

  return jsonSuccess({
    ok: true,
    owner: { id: target.user.id, name: `${target.user.firstName} ${target.user.lastName}`.trim() },
  });
}
