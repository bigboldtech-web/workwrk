import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionOrFail, getOrgId, getUserId, jsonError, jsonSuccess } from "@/lib/api-helpers";
import { isPeopleTeamOrAdmin } from "@/lib/people/review-cycle-access";
import { isInReportTree } from "@/lib/reporting-line";

// GET: Get review history for a user across all cycles
export async function GET(req: NextRequest) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;

  const orgId = getOrgId(session);
  const userId = new URL(req.url).searchParams.get("userId");

  if (!userId) return jsonError("userId required");

  // Phase 6 (an IDOR): any signed-in colleague could read anyone's completed
  // reviews, outcomes and score history. Performance data is people data:
  // the person themself, anyone above them in the chain, the People team
  // and Admin. Anyone else gets the same 404 as a person who does not exist.
  const callerId = getUserId(session);
  if (
    userId !== callerId &&
    !(await isPeopleTeamOrAdmin(session)) &&
    !(await isInReportTree(callerId, userId))
  ) {
    return jsonError("Not found", 404);
  }

  const reviews = await prisma.review.findMany({
    where: {
      subjectId: userId,
      status: "COMPLETED",
      cycle: { organizationId: orgId },
    },
    include: {
      cycle: { select: { name: true, type: true, startDate: true, endDate: true } },
      reviewer: { select: { firstName: true, lastName: true } },
    },
    orderBy: { createdAt: "desc" },
  });

  // Get performance score history
  const scoreHistory = await prisma.performanceScore.findMany({
    where: { userId, organizationId: orgId },
    orderBy: { period: "desc" },
    take: 12,
  });

  return jsonSuccess({
    reviews: reviews.map((r) => ({
      id: r.id,
      cycleName: r.cycle.name,
      cycleType: r.cycle.type,
      // The raw bounds, so a client renders them through formatDate in the
      // viewer's own order; `period` stays for any existing reader.
      startDate: r.cycle.startDate,
      endDate: r.cycle.endDate,
      period: `${r.cycle.startDate ? new Date(r.cycle.startDate).toLocaleDateString("en-US", { month: "short", year: "numeric" }) : ""} to ${r.cycle.endDate ? new Date(r.cycle.endDate).toLocaleDateString("en-US", { month: "short", year: "numeric" }) : ""}`,
      overallScore: r.overallScore || r.calibratedScore || r.compositeScore,
      outcome: r.outcome,
      reviewerName: r.reviewer ? `${r.reviewer.firstName} ${r.reviewer.lastName}` : "",
      completedAt: r.updatedAt,
    })),
    scoreHistory: scoreHistory.map((s) => ({
      period: s.period,
      score: s.score,
      breakdown: s.breakdown,
    })),
  });
}
