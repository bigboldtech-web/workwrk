// GET  /api/me/weekly-review               — current week's review for me (auto-creates DRAFT)
// GET  /api/me/weekly-review?history=1     — my last 24 reviews (newest first)
//
// The current-week endpoint upserts a DRAFT row if one doesn't exist
// yet, so the form always has somewhere to write. Author is always
// the current session user.

import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { getOrCreateWeeklyReview, listMyWeeklyReviews } from "@/lib/weekly-review";

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

  const review = await getOrCreateWeeklyReview({
    userId: u.id,
    organizationId: u.organizationId,
  });
  return NextResponse.json({ review });
}
