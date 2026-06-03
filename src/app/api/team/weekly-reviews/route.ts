// GET /api/team/weekly-reviews
//
// Manager queue: every WeeklyReview where the caller is the recorded
// manager. Optionally filter via ?status=SUBMITTED|ACKNOWLEDGED|DRAFT.
// Manager+ access level required (mirrors /team/alignment).

import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { listReviewsForManager } from "@/lib/weekly-review";

const MANAGER_LEVELS = new Set([
  "SUPER_ADMIN", "COMPANY_ADMIN", "C_LEVEL", "VP", "DIRECTOR",
  "MANAGER", "TEAM_LEAD", "HR",
]);

export async function GET(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const u = session.user as { id?: string; accessLevel?: string; organizationId?: string };
  if (!u.id || !u.organizationId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!MANAGER_LEVELS.has(u.accessLevel ?? "EMPLOYEE")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const url = new URL(req.url);
  const raw = url.searchParams.get("status");
  const status = raw === "DRAFT" || raw === "SUBMITTED" || raw === "ACKNOWLEDGED" ? raw : undefined;
  const reviews = await listReviewsForManager(u.id, { status });
  return NextResponse.json({ reviews });
}
