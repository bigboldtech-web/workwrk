// Call-session lifecycle helpers (native-calls Phase 2).
//
// Sessions are created at token mint and maintained by webhooks — but
// webhooks are at-least-once and a mint can be abandoned, so mint time
// is also when the lifecycle SELF-HEALS:
//   - an open row older than 12h is a dead call (missed room_finished):
//     close it and start fresh;
//   - an open row with an EMPTY roster is an abandoned mint: reuse it,
//     but reset startedAt so the presence reads (which cap on startedAt)
//     see the new call as new;
//   - an open row with people in it is a LIVE call: join it untouched.

import { prisma } from "@/lib/prisma";

const DEAD_AFTER_MS = 12 * 3600_000;

export async function ensureCallSession(params: {
  organizationId: string;
  roomName: string;
  conversationId?: string | null;
  meetingId?: string | null;
}): Promise<void> {
  const { organizationId, roomName, conversationId = null, meetingId = null } = params;
  const open = await prisma.callSession.findFirst({
    where: { roomName, endedAt: null },
    orderBy: { startedAt: "desc" },
    select: { id: true, startedAt: true, participants: true },
  });
  if (open && open.startedAt.getTime() < Date.now() - DEAD_AFTER_MS) {
    await prisma.callSession.updateMany({ where: { roomName, endedAt: null }, data: { endedAt: new Date() } });
  } else if (open) {
    const roster = Array.isArray(open.participants) ? (open.participants as unknown[]) : [];
    if (roster.length === 0) {
      // Abandoned mint reused for a NEW call — restart its clock.
      await prisma.callSession.update({ where: { id: open.id }, data: { startedAt: new Date(), lastSeenAt: new Date() } });
    }
    return;
  }
  await prisma.callSession.create({ data: { organizationId, roomName, conversationId, meetingId } });
}
