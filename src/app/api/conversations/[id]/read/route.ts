import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionOrFail, getOrgId, getUserId, jsonError, jsonSuccess } from "@/lib/api-helpers";

// Mark a conversation read: bump my lastReadAt and clear the bell
// notifications that pointed here. Called when the pane is open and
// focused — cheap enough to fire on every burst of incoming messages.

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;
  const { id } = await params;
  const userId = getUserId(session);

  const membership = await prisma.conversationMember.findFirst({
    where: { conversationId: id, userId, conversation: { organizationId: getOrgId(session) } },
    select: { id: true },
  });
  if (!membership) return jsonError("Conversation not found", 404);

  await Promise.all([
    prisma.conversationMember.update({ where: { id: membership.id }, data: { lastReadAt: new Date() } }),
    prisma.notification.updateMany({
      where: { userId, link: { in: [`/tlk/${id}`, `/room/${id}`, `/chat/${id}`] }, read: false },
      data: { read: true },
    }),
  ]);

  return jsonSuccess({ ok: true });
}
