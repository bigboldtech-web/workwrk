// GET  /api/me/weekly-review: this week's review (auto-creates a DRAFT)
// GET  /api/me/weekly-review?week=YYYY-MM-DD: that week's review, or null
// GET  /api/me/weekly-review?history=1: my last 24 reviews (newest first)
//
// ONLY THE CURRENT WEEK AUTO-CREATES. The page's week pills (spec-work-home
// section 2, /me/weekly-review) let a person click back through eight weeks; if
// every one of those reads created a DRAFT, one visit would leave eight empty
// reviews in their manager's history. A past week answers with what is there,
// or with `null`, and the page renders the empty week read-only.

import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getOrCreateWeeklyReview, listMyWeeklyReviews } from "@/lib/weekly-review";
import { isCurrentWeek, parseWeekKey, weekKey } from "@/lib/weeks";

export async function GET(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const u = session.user as { id?: string; organizationId?: string };
  if (!u.id || !u.organizationId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const url = new URL(req.url);
  if (url.searchParams.get("history") === "1") {
    const reviews = await listMyWeeklyReviews(u.id, { take: 24 });
    return NextResponse.json({ reviews });
  }

  const asked = parseWeekKey(url.searchParams.get("week"));
  if (asked && !isCurrentWeek(weekKey(asked))) {
    // A past (or future) week: read only.
    const row = await prisma.weeklyReview.findUnique({
      where: { userId_periodStart: { userId: u.id, periodStart: asked } },
    });
    return NextResponse.json({ review: row ?? null, week: weekKey(asked) });
  }

  const review = await getOrCreateWeeklyReview({
    userId: u.id,
    organizationId: u.organizationId,
  });
  return NextResponse.json({ review });
}
