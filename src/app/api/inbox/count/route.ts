// /api/inbox/count — lightweight unread-notification count for the topbar
// bell badge. Counts the signed-in user's unread Notification rows,
// honoring the same snooze visibility filter the notifications panel uses
// so the badge and the panel never disagree. Cheap COUNT on the
// @@index([userId, read]) — no list fetch, so the topbar poll stays snappy.

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionOrFail, getUserId } from "@/lib/api-helpers";

export async function GET() {
  const { error, session } = await getSessionOrFail();
  if (error) return error;

  const userId = getUserId(session);
  const now = new Date();

  // Visible = not snoozed, or snooze window has elapsed. Mirrors
  // /api/notifications so the badge count matches the panel's unreadCount.
  const unread = await prisma.notification.count({
    where: {
      userId,
      read: false,
      OR: [{ snoozedUntil: null }, { snoozedUntil: { lte: now } }],
    },
  });

  // `total` is the badge number; `unread` is an explicit alias for clarity.
  return NextResponse.json(
    { total: unread, unread },
    { headers: { "Cache-Control": "private, max-age=10" } },
  );
}
