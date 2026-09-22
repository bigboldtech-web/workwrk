import { prisma } from "@/lib/prisma";
import { getSessionAndModule, getOrgId, getUserId, jsonSuccess } from "@/lib/api-helpers";

// "Mark all as read" on Talk home (spec-talk section 2.1 toolbar).
//
// The same two writes POST /api/conversations/[id]/read does, done once for
// every conversation I am a member of: bump lastReadAt, and clear the unread
// bell rows that pointed at those conversations. Nothing is deleted and no
// message is touched, so re-running it is a no-op.
//
// Scoped to the caller's organization AND the caller's own memberships, so it
// can never clear somebody else's unreads.

export async function POST() {
  const { error, session } = await getSessionAndModule("workwrk-talk");
  if (error) return error;
  const userId = getUserId(session);
  const orgId = getOrgId(session);

  const memberships = await prisma.conversationMember.findMany({
    where: { userId, conversation: { organizationId: orgId } },
    select: { id: true, conversationId: true },
  });
  if (memberships.length === 0) return jsonSuccess({ ok: true, marked: 0 });

  const now = new Date();
  const links = memberships.flatMap((m) => [`/tlk/${m.conversationId}`, `/room/${m.conversationId}`, `/chat/${m.conversationId}`]);

  await Promise.all([
    prisma.conversationMember.updateMany({
      where: { id: { in: memberships.map((m) => m.id) } },
      data: { lastReadAt: now },
    }),
    prisma.notification.updateMany({
      where: { userId, link: { in: links }, read: false },
      data: { read: true },
    }),
  ]);

  return jsonSuccess({ ok: true, marked: memberships.length });
}
