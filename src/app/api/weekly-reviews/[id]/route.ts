// GET /api/weekly-reviews/[id]: one weekly review for the /team/reviews
// drawer and the employee's own page. Readers: the subject, the recorded
// manager, anyone above the subject in the tree (solid or dotted), the
// People team and Admin, and whoever decided it. Anyone else gets 404, so a
// review's existence is never confirmed.
//
// KRA and KPI names come back with the ids (PO-9). A draft's body is
// returned to its author only: to anyone else a draft is "not submitted".

import { NextResponse } from "next/server";
import { readWeeklyReview, weeklyQueueCtx } from "@/lib/people/weekly-queue.server";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await weeklyQueueCtx();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  const review = await readWeeklyReview(ctx, id);
  if (!review) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ review }, { headers: { "Cache-Control": "no-store" } });
}
