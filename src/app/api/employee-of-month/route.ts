import { prisma } from "@/lib/prisma";
import { getSessionOrFail, getOrgId, isManager, jsonError, jsonSuccess } from "@/lib/api-helpers";
import { getCurrentPeriod, getLastPeriod } from "@/lib/kpi-utils";
import { NextRequest } from "next/server";

// Auto-calculate Employee of the Month from performance scores
async function calculateEOM(orgId: string, period: string) {
  // Check if already calculated
  const existing = await prisma.employeeOfMonth.findUnique({
    where: { period_organizationId: { period, organizationId: orgId } },
    include: { user: { select: { id: true, firstName: true, lastName: true, avatar: true, department: { select: { name: true } }, role: { select: { title: true } } } } },
  });
  if (existing) return existing;

  // Find top performer for this period
  const topScore = await prisma.performanceScore.findFirst({
    where: { organizationId: orgId, period },
    orderBy: { score: "desc" },
    include: { user: { select: { id: true, firstName: true, lastName: true, avatar: true, department: { select: { name: true } }, role: { select: { title: true } } } } },
  });

  if (!topScore) {
    // Fallback: try KPI records for this period
    const kpiRecords = await prisma.kPIRecord.findMany({
      where: { period, kpi: { organizationId: orgId }, score: { not: null } },
      select: { userId: true, score: true },
    });

    if (kpiRecords.length === 0) return null;

    // Group by user and average
    const userScores = new Map<string, number[]>();
    kpiRecords.forEach((r) => {
      if (!userScores.has(r.userId)) userScores.set(r.userId, []);
      if (r.score != null) userScores.get(r.userId)!.push(r.score);
    });

    let bestUserId = "";
    let bestAvg = 0;
    userScores.forEach((scores, userId) => {
      const avg = scores.reduce((a, b) => a + b, 0) / scores.length;
      if (avg > bestAvg) { bestAvg = avg; bestUserId = userId; }
    });

    if (!bestUserId) return null;

    const eom = await prisma.employeeOfMonth.create({
      data: {
        userId: bestUserId,
        period,
        score: Math.round(bestAvg),
        breakdown: { source: "kpi_average", kpiCount: userScores.get(bestUserId)?.length },
        organizationId: orgId,
      },
      include: { user: { select: { id: true, firstName: true, lastName: true, avatar: true, department: { select: { name: true } }, role: { select: { title: true } } } } },
    });
    return eom;
  }

  const eom = await prisma.employeeOfMonth.create({
    data: {
      userId: topScore.userId,
      period,
      score: topScore.score,
      breakdown: topScore.breakdown as any,
      organizationId: orgId,
    },
    include: { user: { select: { id: true, firstName: true, lastName: true, avatar: true, department: { select: { name: true } }, role: { select: { title: true } } } } },
  });
  return eom;
}

export async function GET(req: NextRequest) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;

  const orgId = getOrgId(session);
  const url = new URL(req.url);
  const requestedPeriod = url.searchParams.get("period");

  // Try last month first (most complete data), then current
  const lastPeriod = getLastPeriod();
  const currentPeriod = getCurrentPeriod();
  const period = requestedPeriod || lastPeriod;

  let eom = await calculateEOM(orgId, period);

  // If no data for last month, try current
  if (!eom && !requestedPeriod) {
    eom = await calculateEOM(orgId, currentPeriod);
  }

  // Also get history
  const history = await prisma.employeeOfMonth.findMany({
    where: { organizationId: orgId },
    include: { user: { select: { id: true, firstName: true, lastName: true, avatar: true, department: { select: { name: true } } } } },
    orderBy: { period: "desc" },
    take: 6,
  });

  return jsonSuccess({ current: eom, history });
}

// POST: Manager override
export async function POST(req: NextRequest) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;
  if (!isManager(session)) return jsonError("Forbidden", 403);

  const orgId = getOrgId(session);
  const body = await req.json();
  const { userId, period } = body;

  if (!userId || !period) return jsonError("userId and period required");

  const eom = await prisma.employeeOfMonth.upsert({
    where: { period_organizationId: { period, organizationId: orgId } },
    create: {
      userId,
      period,
      score: 0,
      method: "manager_override",
      overriddenBy: (session.user as any).id,
      organizationId: orgId,
    },
    update: {
      userId,
      method: "manager_override",
      overriddenBy: (session.user as any).id,
    },
    include: { user: { select: { id: true, firstName: true, lastName: true } } },
  });

  return jsonSuccess(eom);
}
