// GET /api/team/weekly-reviews (kept for API callers; the /team/reviews page
// reads GET /api/weekly-reviews, which adds the chain scope, names and
// paging). The direct queue: every WeeklyReview awaiting or decided by the
// caller as the person's manager. ?status=SUBMITTED|ACKNOWLEDGED|DRAFT,
// ?page=1&limit=100 (at most 200 a page) with a server total, so a caller is
// never silently cut off at the first page.
//
// Gate: the `weekly-reviews` APP_RULES row's facts (anyone with reports,
// the People team and Admin), the same as the page, instead of a copied
// access-level list.

import { NextResponse } from "next/server";
import { countReviewsForManager, listReviewsForManager } from "@/lib/weekly-review";
import { mayOpenQueue, weeklyQueueCtx } from "@/lib/people/weekly-queue.server";

export async function GET(req: Request) {
  const ctx = await weeklyQueueCtx();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!mayOpenQueue(ctx)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const url = new URL(req.url);
  const raw = url.searchParams.get("status");
  const status = raw === "DRAFT" || raw === "SUBMITTED" || raw === "ACKNOWLEDGED" ? raw : undefined;
  const pageSize = Math.min(200, Math.max(1, Number.parseInt(url.searchParams.get("limit") ?? "", 10) || 100));
  const page = Math.max(1, Number.parseInt(url.searchParams.get("page") ?? "", 10) || 1);
  const [reviews, total] = await Promise.all([
    listReviewsForManager(ctx.userId, { status, take: pageSize, skip: (page - 1) * pageSize }),
    countReviewsForManager(ctx.userId, { status }),
  ]);
  // A draft is its author's unfinished writing: listed, never read.
  return NextResponse.json({
    reviews: reviews.map((r) => (r.status === "DRAFT" ? { ...r, highlights: null, blockers: null, plan: null, kpiSnapshots: [], kraProgress: [] } : r)),
    pagination: { total, page, pageSize },
  });
}
