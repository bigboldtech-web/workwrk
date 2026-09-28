// GET  /api/me/weekly-review: this week's review, or null
// GET  /api/me/weekly-review?week=YYYY-MM-DD: that week's review, or null
// GET  /api/me/weekly-review?history=1: my last 24 reviews (newest first)
// POST /api/me/weekly-review: create this week's DRAFT (idempotent)
//
// NO GET WRITES. This week's DRAFT is created by the POST the page sends on
// the first save, so opening the page (or any reader) leaves no empty review
// in the manager's history. Only the current week can be created; a past
// week answers with what is there, or with `null`, read only.

import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { viewerFromSession } from "@/lib/access/viewer";
import { findWeeklyReview, getOrCreateWeeklyReview, listMyWeeklyReviews } from "@/lib/weekly-review";
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

  const review = await findWeeklyReview({ userId: u.id });
  return NextResponse.json({ review });
}

export async function POST() {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const u = session.user as { id?: string; organizationId?: string };
  if (!u.id || !u.organizationId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  // A Guest has no KRAs, no manager chain and no heartbeat to file (the page 404s them too).
  if ((await viewerFromSession())?.orgRole === "GUEST") return NextResponse.json({ error: "Not found" }, { status: 404 });
  const review = await getOrCreateWeeklyReview({ userId: u.id, organizationId: u.organizationId });
  return NextResponse.json({ review });
}
