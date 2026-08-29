import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionAndModule, getOrgId, getUserId, jsonError, jsonSuccess } from "@/lib/api-helpers";

// Edit and delete your OWN messages. Deletes are soft (deletedAt) — the
// row keeps its place so threads and history stay coherent, and the body
// is preserved for the org's audit trail (data-integrity mandate).

const MAX_BODY = 8000;
const AUTHOR_SELECT = { id: true, firstName: true, lastName: true, avatar: true } as const;

async function findOwnMessage(messageId: string, conversationId: string, userId: string, orgId: string) {
  const member = await prisma.conversationMember.findFirst({
    where: { conversationId, userId, conversation: { organizationId: orgId } },
    select: { id: true },
  });
  if (!member) return null;
  return prisma.conversationMessage.findFirst({
    where: { id: messageId, conversationId, authorId: userId },
    select: { id: true, deletedAt: true, parentId: true },
  });
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string; messageId: string }> }) {
  const { error, session } = await getSessionAndModule("workwrk-talk");
  if (error) return error;
  const { id, messageId } = await params;
  const userId = getUserId(session);

  const own = await findOwnMessage(messageId, id, userId, getOrgId(session));
  if (!own) return jsonError("Message not found", 404);
  if (own.deletedAt) return jsonError("Removed messages can't be edited", 400);

  const payload = await req.json().catch(() => null);
  const text = typeof payload?.body === "string" ? payload.body.trim() : "";
  if (!text) return jsonError("Message can't be empty", 400);
  if (text.length > MAX_BODY) return jsonError("Message is too long", 400);

  const message = await prisma.conversationMessage.update({
    where: { id: messageId },
    data: { body: text, editedAt: new Date() },
    include: { author: { select: AUTHOR_SELECT } },
  });
  return jsonSuccess({ message });
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string; messageId: string }> }) {
  const { error, session } = await getSessionAndModule("workwrk-talk");
  if (error) return error;
  const { id, messageId } = await params;
  const userId = getUserId(session);

  const own = await findOwnMessage(messageId, id, userId, getOrgId(session));
  if (!own) return jsonError("Message not found", 404);

  const message = await prisma.conversationMessage.update({
    where: { id: messageId },
    data: { deletedAt: new Date() },
    include: { author: { select: AUTHOR_SELECT } },
  });
  // Deleting a reply changes the parent's reply count — re-deliver it.
  if (own.parentId) {
    await prisma.conversationMessage.update({ where: { id: own.parentId }, data: { updatedAt: new Date() } }).catch(() => {});
  }
  return jsonSuccess({ message });
}
