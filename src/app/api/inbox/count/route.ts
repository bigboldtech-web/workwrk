// GET /api/inbox/count: the ONE unread number.
//
// Spec: docs/plans/ui-refresh/spec-work-home.md section 1 (the Inbox sidebar
// row) and section 2 (/inbox, Data): "kept as the ONE unread counter for the
// sidebar badge, the top-bar bell and the Home widget; it is rebuilt to count
// through `inbox-kinds.ts` so 'unread' means the same thing as the Primary and
// Other tabs, and it keeps its snooze filter. No `?count=1` mode is added to
// `/api/notifications`: two counters for one badge is the bug, not the fix."
//
// Before this there were three of them. This route, `/api/notifications`'s
// `unreadCount`, and `/api/boot`'s `counts.inboxUnread` each ran the identical
// COUNT in a different file with a different cache header, and the Inbox tabs
// computed a fourth from the 50-row page payload, which could not agree with
// any of them past 50 unread rows. They now all read `unreadWhere` from
// `inbox-query.ts`, which is the same clause the Primary and Other tabs are
// built from, so the badge and the tabs are the same question asked once.

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionOrFail, getUserId } from "@/lib/api-helpers";
import { tabUnreadWhere, unreadWhere, withClearedAtFallback } from "@/lib/inbox-query";

export async function GET() {
  const { error, session } = await getSessionOrFail();
  if (error) return error;

  const userId = getUserId(session);
  const now = new Date();

  // Two counts rather than one so the bell can show the Primary number beside
  // the total without a second round trip; `total` stays the badge number and
  // keeps the shape every existing caller reads.
  const [unread, primary] = await withClearedAtFallback(() =>
    Promise.all([
      prisma.notification.count({ where: unreadWhere(userId, now) }),
      // The tab now lists read rows too, so the PILL's number is the tab's
      // unread count, not its total. Badge = Primary unread + Other unread.
      prisma.notification.count({ where: tabUnreadWhere("primary", userId, now) }),
    ]),
  );

  return NextResponse.json(
    { total: unread, unread, primary, other: Math.max(0, unread - primary) },
    { headers: { "Cache-Control": "private, max-age=10" } },
  );
}
