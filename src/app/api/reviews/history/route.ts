import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionOrFail, getOrgId, jsonError, jsonSuccess } from "@/lib/api-helpers";

// GET: Get review history for a user across all cycles
export async function GET(req: NextRequest) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;

  const orgId = getOrgId(session);
  const userId = new URL(req.url).searchParams.get("userId");

  if (!userId) return jsonError("userId required");

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
      period: `${r.cycle.startDate ? new Date(r.cycle.startDate).toLocaleDateString("en-US", { month: "short", year: "numeric" }) : ""} - ${r.cycle.endDate ? new Date(r.cycle.endDate).toLocaleDateString("en-US", { month: "short", year: "numeric" }) : ""}`,
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
