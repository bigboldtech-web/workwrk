// POST /api/conversations/[id]/rotate-call — revoke guest call links.
// Bumping callEpoch rotates the derived room name, which kills every
// previously shared guest link for this conversation's huddles. The
// only revocation DMs and #general have (they can't be left, so the
// epoch never rotates on its own), and an explicit kill switch for
// groups/channels when a link leaks. Any member may pull it.

import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionOrFail, getOrgId, getUserId, jsonError, jsonSuccess } from "@/lib/api-helpers";
import { chatGuestCode, chatRoomName } from "@/lib/meeting-room";

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

  const updated = await prisma.conversation.update({
    where: { id },
    data: { callEpoch: { increment: 1 } },
    select: { callEpoch: true },
  });

  const base = process.env.NEXTAUTH_URL || "https://workwrk.com";
  return jsonSuccess({
    call: {
      room: chatRoomName(id, updated.callEpoch),
      guestUrl: `${base}/meet/${chatGuestCode(id, updated.callEpoch)}`,
    },
  });
}
