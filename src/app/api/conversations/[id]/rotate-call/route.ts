// POST /api/conversations/[id]/rotate-call: revoke guest call links.
// Bumping callEpoch rotates the derived room name, which kills every
// previously shared guest link for this conversation's calls. The
// only revocation DMs and #general have (they can't be left, so the
// epoch never rotates on its own), and an explicit kill switch for
// groups and channels when a link leaks.
//
// TWO THINGS THIS ROUTE OWES ITS CALLER, both of which it used to skip:
//
//   * Full access, checked. Resetting the link invalidates every copy every
//     member has handed out; canResetGuestLink says who may do that, and an
//     archived conversation says nobody. Before this any member of an
//     archived channel could silently kill its outstanding invitations.
//   * The new expiry. GET /api/conversations/[id] answers guestExpiresAt and
//     the Details panel prints "until {date}" from it. Returning only the URL
//     left the person who had just reset the link knowing LESS about it than
//     before they touched it.

import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { jsonSuccess } from "@/lib/api-helpers";
import { requireConversation } from "@/lib/talk-gate";
import { canResetGuestLink } from "@/lib/talk-access";
import { CHAT_GUEST_CODE_TTL_MS, chatGuestCode, chatRoomName } from "@/lib/meeting-room";

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { error } = await requireConversation(id, {
    floor: "full",
    allow: canResetGuestLink,
    what: "reset the guest link",
  });
  if (error) return error;

  const updated = await prisma.conversation.update({
    where: { id },
    data: { callEpoch: { increment: 1 } },
    select: { callEpoch: true },
  });

  const base = process.env.NEXTAUTH_URL || "https://workwrk.com";
  const guestExpiresAt = Date.now() + CHAT_GUEST_CODE_TTL_MS;
  return jsonSuccess({
    call: {
      room: chatRoomName(id, updated.callEpoch),
      guestUrl: `${base}/meet/${chatGuestCode(id, updated.callEpoch, guestExpiresAt)}`,
      guestExpiresAt: new Date(guestExpiresAt).toISOString(),
    },
  });
}
