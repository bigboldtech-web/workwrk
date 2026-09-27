// GET /api/team/weekly-reviews (kept for API callers; the /team/reviews page
// reads GET /api/weekly-reviews, which adds the chain scope, names and
// paging). The direct queue: every WeeklyReview awaiting or decided by the
// caller as the person's manager. ?status=SUBMITTED|ACKNOWLEDGED|DRAFT.
//
// Gate: the `weekly-reviews` APP_RULES row's facts (anyone with reports,
// the People team and Admin), the same as the page, instead of a copied
// access-level list.

import { NextResponse } from "next/server";
import { listReviewsForManager } from "@/lib/weekly-review";
import { mayOpenQueue, weeklyQueueCtx } from "@/lib/people/weekly-queue.server";

export async function GET(req: Request) {
  const ctx = await weeklyQueueCtx();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!mayOpenQueue(ctx)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const url = new URL(req.url);
  const raw = url.searchParams.get("status");
  const status = raw === "DRAFT" || raw === "SUBMITTED" || raw === "ACKNOWLEDGED" ? raw : undefined;
  const reviews = await listReviewsForManager(ctx.userId, { status, take: 100 });
  // A draft is its author's unfinished writing: listed, never read.
  return NextResponse.json({
    reviews: reviews.map((r) => (r.status === "DRAFT" ? { ...r, highlights: null, blockers: null, plan: null, kpiSnapshots: [], kraProgress: [] } : r)),
  });
}
