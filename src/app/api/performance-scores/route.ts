import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionOrFail, getOrgId, jsonError, jsonSuccess } from "@/lib/api-helpers";
import { getScoreHistory, getLatestScore, calculatePerformanceScore } from "@/services/performanceScoreService";

// GET: Fetch performance scores
// ?userId=xxx — single user's history
// ?top=10 — top performers for current period
export async function GET(req: NextRequest) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;

  const orgId = getOrgId(session);
  const url = new URL(req.url);
  const userId = url.searchParams.get("userId");
  const top = url.searchParams.get("top");
  const limit = parseInt(url.searchParams.get("limit") || "6", 10);

  if (userId) {
    // Verify user belongs to org
    const user = await prisma.user.findFirst({
      where: { id: userId, organizationId: orgId },
      select: { id: true },
    });
    if (!user) return jsonError("User not found", 404);

    const [latest, history] = await Promise.all([
      getLatestScore(userId),
      getScoreHistory(userId, limit),
    ]);

    return jsonSuccess({ latest, history });
  }

  if (top) {
    const topN = parseInt(top, 10) || 10;
    const period = new Date().toISOString().slice(0, 7);

    const scores = await prisma.performanceScore.findMany({
      where: { organizationId: orgId, period },
      orderBy: { score: "desc" },
      take: topN,
      include: {
        user: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            avatar: true,
            role: { select: { title: true } },
            department: { select: { name: true } },
          },
        },
      },
    });

    return jsonSuccess(
      scores.map((s) => ({
        userId: s.userId,
        name: `${s.user.firstName} ${s.user.lastName}`,
        role: s.user.role?.title || "No role",
        department: s.user.department?.name || "",
        avatar: s.user.avatar,
        score: s.score,
        breakdown: s.breakdown,
        period: s.period,
      }))
    );
  }

  // Default: top N scores for current period. Cap at 500 to keep the
  // response bounded as orgs grow; callers that need pagination should use
  // the `top=` or `userId=` modes above.
  const period = new Date().toISOString().slice(0, 7);
  const defaultLimit = Math.min(parseInt(url.searchParams.get("limit") || "100", 10), 500);
  const scores = await prisma.performanceScore.findMany({
    where: { organizationId: orgId, period },
    orderBy: { score: "desc" },
    take: defaultLimit,
    include: {
      user: {
        select: {
          id: true,
          firstName: true,
          lastName: true,
          department: { select: { name: true } },
        },
      },
    },
  });

  return jsonSuccess(scores);
}

// POST: Manually trigger recalculation for a user
export async function POST(req: NextRequest) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;

  const orgId = getOrgId(session);
  const body = await req.json();
  const { userId } = body;

  if (!userId) return jsonError("userId is required");

  const user = await prisma.user.findFirst({
    where: { id: userId, organizationId: orgId },
    select: { id: true },
  });
  if (!user) return jsonError("User not found", 404);

  const result = await calculatePerformanceScore(userId, orgId);
  return jsonSuccess(result);
}
