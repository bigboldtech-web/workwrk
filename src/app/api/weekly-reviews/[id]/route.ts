// GET /api/weekly-reviews/[id]
//
// Read a single review. Access: the subject (always) or the recorded
// manager (always). Other viewers get 404. Phase 5c may widen this
// to "anyone in the reporting chain above the subject" for director
// rollups; today we keep it strict.

import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { getReviewForViewer } from "@/lib/weekly-review";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const u = session.user as { id?: string };
  if (!u.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const review = await getReviewForViewer(id, u.id);
  if (!review) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ review });
}
