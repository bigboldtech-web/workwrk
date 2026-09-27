// GET /api/team/attention: My team's "Needs your attention" counts
// (spec-teams-people /team Data): { weeklyReviews, kpiRecords, noKras }.
//
// The two approval counts are the SAME helpers the boot pass uses for the
// My team sidebar badge (countChainReviewsAwaiting over the chain, the PO-16
// decision, and countKpiReviewsForManager over the effective tree), so the
// card and the badge can never disagree. noKras counts the people My team
// lists (the chain, or the org for org-wide viewers) with no active KRA.
// `chainWide` says the weekly count reaches past direct reports, so the
// card's link opens the queue on its chain scope.

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { peopleCtx } from "@/lib/people/person-access.server";
import { teamScopeFor } from "@/lib/people/team-scope.server";
import { countKpiReviewsForManager } from "@/lib/kpi-record";
import { countChainReviewsAwaiting, countReviewsAwaitingManager } from "@/lib/weekly-review";

export async function GET() {
  const ctx = await peopleCtx();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (ctx.orgRole === "GUEST") return NextResponse.json({ error: "Not found" }, { status: 404 });
  const scope = await teamScopeFor(ctx);
  if (!scope.orgWide && ctx.chain.size === 0) {
    return NextResponse.json({ error: "My team shows the people who report to you. Nobody reports to you yet." }, { status: 403 });
  }
  const [chain, direct, kpiRecords, noKras] = await Promise.all([
    countChainReviewsAwaiting(ctx.userId),
    countReviewsAwaitingManager(ctx.userId),
    countKpiReviewsForManager(ctx.userId, ctx.organizationId),
    scope.ids.length
      ? prisma.user.count({ where: { id: { in: scope.ids }, kraAssignments: { none: { status: "ACTIVE" } } } })
      : Promise.resolve(0),
  ]);
  const weeklyReviews = Math.max(chain, direct);
  return NextResponse.json(
    { weeklyReviews, kpiRecords, noKras, chainWide: weeklyReviews > direct },
    { headers: { "Cache-Control": "no-store" } },
  );
}
