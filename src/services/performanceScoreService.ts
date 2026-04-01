import { prisma } from "@/lib/prisma";

interface ScoreWeights {
  kpi: number;
  manager: number;
  peer: number;
  self: number;
  sopCompliance: number;
}

interface ScoreBreakdown {
  kpiScore: number | null;
  managerRating: number | null;
  peerRating: number | null;
  selfRating: number | null;
  sopCompliance: number | null;
  kudosBonus: number;
  weights: ScoreWeights;
}

const DEFAULT_WEIGHTS: ScoreWeights = {
  kpi: 40,
  manager: 25,
  peer: 10,
  self: 5,
  sopCompliance: 20,
};

function getCurrentPeriod(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

async function getOrgWeights(organizationId: string): Promise<ScoreWeights> {
  const org = await prisma.organization.findUnique({
    where: { id: organizationId },
    select: { settings: true },
  });

  const settings = (org?.settings as Record<string, unknown>) || {};
  const sw = settings.scoreWeights as Record<string, number> | undefined;

  if (!sw) return DEFAULT_WEIGHTS;

  return {
    kpi: sw.kpi ?? DEFAULT_WEIGHTS.kpi,
    manager: sw.manager ?? DEFAULT_WEIGHTS.manager,
    peer: sw.peer ?? DEFAULT_WEIGHTS.peer,
    self: sw.self ?? DEFAULT_WEIGHTS.self,
    sopCompliance: sw.sopCompliance ?? DEFAULT_WEIGHTS.sopCompliance,
  };
}

async function calcKpiScore(userId: string): Promise<number | null> {
  const ninetyDaysAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);

  const records = await prisma.kPIRecord.findMany({
    where: {
      userId,
      score: { not: null },
      createdAt: { gte: ninetyDaysAgo },
    },
    select: { score: true },
  });

  if (records.length === 0) return null;

  const avg = records.reduce((sum, r) => sum + r.score!, 0) / records.length;
  return Math.min(Math.round((avg / 120) * 100), 100);
}

async function calcManagerRating(userId: string): Promise<number | null> {
  const review = await prisma.review.findFirst({
    where: {
      subjectId: userId,
      status: "COMPLETED",
      managerRating: { not: null },
    },
    orderBy: { updatedAt: "desc" },
    select: { managerRating: true, calibratedScore: true },
  });

  if (!review) return null;
  const rating = review.calibratedScore ?? review.managerRating;
  if (rating == null) return null;
  return Math.min(Math.round(rating), 100);
}

async function calcPeerRating(userId: string): Promise<number | null> {
  const feedback = await prisma.peerFeedback.findMany({
    where: {
      receiverId: userId,
      status: "SUBMITTED",
      rating: { not: null },
    },
    orderBy: { createdAt: "desc" },
    take: 20,
    select: { rating: true },
  });

  if (feedback.length === 0) return null;

  const avg = feedback.reduce((sum, f) => sum + f.rating!, 0) / feedback.length;
  return Math.min(Math.round(avg), 100);
}

async function calcSelfRating(userId: string): Promise<number | null> {
  const review = await prisma.review.findFirst({
    where: {
      subjectId: userId,
      selfRatings: { not: undefined },
      status: { in: ["MANAGER_REVIEW", "CALIBRATION", "COMPLETED"] },
    },
    orderBy: { updatedAt: "desc" },
    select: { selfRatings: true },
  });

  if (!review?.selfRatings) return null;

  const selfData = review.selfRatings as {
    kraRatings?: Array<{ rating?: number }>;
  };

  const kraRatings = selfData.kraRatings;
  if (!kraRatings || kraRatings.length === 0) return null;

  const validRatings = kraRatings.filter((r) => r.rating != null);
  if (validRatings.length === 0) return null;

  const avg = validRatings.reduce((sum, r) => sum + r.rating!, 0) / validRatings.length;
  return Math.min(Math.round((avg / 5) * 100), 100);
}

async function calcSopCompliance(userId: string): Promise<number | null> {
  const assignments = await prisma.sOPAssignment.findMany({
    where: { userId, status: { in: ["IN_PROGRESS", "COMPLETED"] } },
    select: { stepsTotal: true, stepsCompleted: true, score: true },
  });

  if (assignments.length === 0) return null;

  const scored = assignments.filter((a) => a.score != null);
  if (scored.length > 0) {
    const avg = scored.reduce((sum, a) => sum + a.score!, 0) / scored.length;
    return Math.min(Math.round(avg), 100);
  }

  const totalSteps = assignments.reduce((sum, a) => sum + a.stepsTotal, 0);
  const completedSteps = assignments.reduce((sum, a) => sum + a.stepsCompleted, 0);
  if (totalSteps === 0) return null;

  return Math.round((completedSteps / totalSteps) * 100);
}

async function calcKudosBonus(userId: string): Promise<number> {
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

  const count = await prisma.kudos.count({
    where: {
      receiverId: userId,
      createdAt: { gte: thirtyDaysAgo },
    },
  });

  return Math.min(Math.floor(count / 2), 5);
}

export async function calculatePerformanceScore(
  userId: string,
  organizationId: string
): Promise<{ score: number; breakdown: ScoreBreakdown }> {
  const weights = await getOrgWeights(organizationId);

  const [kpiScore, managerRating, peerRating, selfRating, sopCompliance, kudosBonus] =
    await Promise.all([
      calcKpiScore(userId),
      calcManagerRating(userId),
      calcPeerRating(userId),
      calcSelfRating(userId),
      calcSopCompliance(userId),
      calcKudosBonus(userId),
    ]);

  const breakdown: ScoreBreakdown = {
    kpiScore,
    managerRating,
    peerRating,
    selfRating,
    sopCompliance,
    kudosBonus,
    weights,
  };

  const components: { value: number; weight: number }[] = [];
  if (kpiScore != null) components.push({ value: kpiScore, weight: weights.kpi });
  if (managerRating != null) components.push({ value: managerRating, weight: weights.manager });
  if (peerRating != null) components.push({ value: peerRating, weight: weights.peer });
  if (selfRating != null) components.push({ value: selfRating, weight: weights.self });
  if (sopCompliance != null) components.push({ value: sopCompliance, weight: weights.sopCompliance });

  let compositeScore = 0;
  if (components.length > 0) {
    const totalWeight = components.reduce((sum, c) => sum + c.weight, 0);
    compositeScore = Math.round(
      components.reduce((sum, c) => sum + (c.value * c.weight) / totalWeight, 0)
    );
  }

  compositeScore += kudosBonus;
  compositeScore = Math.min(Math.max(compositeScore, 0), 100);

  const period = getCurrentPeriod();

  await prisma.performanceScore.upsert({
    where: { userId_period: { userId, period } },
    create: {
      userId,
      period,
      score: compositeScore,
      breakdown: JSON.parse(JSON.stringify(breakdown)),
      organizationId,
      calculatedAt: new Date(),
    },
    update: {
      score: compositeScore,
      breakdown: JSON.parse(JSON.stringify(breakdown)),
      calculatedAt: new Date(),
    },
  });

  return { score: compositeScore, breakdown };
}

export function triggerRecalculation(userId: string, organizationId: string): void {
  calculatePerformanceScore(userId, organizationId).catch((err) => {
    console.error(`Performance score recalculation failed for user ${userId}:`, err);
  });
}

export async function recalculateAllScores(organizationId: string): Promise<void> {
  const users = await prisma.user.findMany({
    where: { organizationId, deletedAt: null, status: { not: "INACTIVE" } },
    select: { id: true },
  });

  await Promise.all(
    users.map((u) => calculatePerformanceScore(u.id, organizationId))
  );
}

export async function getScoreHistory(
  userId: string,
  limit: number = 6
): Promise<Array<{ period: string; score: number; breakdown: ScoreBreakdown; calculatedAt: Date }>> {
  const scores = await prisma.performanceScore.findMany({
    where: { userId },
    orderBy: { period: "desc" },
    take: limit,
    select: { period: true, score: true, breakdown: true, calculatedAt: true },
  });

  return scores.reverse().map((s) => ({
    period: s.period,
    score: s.score,
    breakdown: s.breakdown as unknown as ScoreBreakdown,
    calculatedAt: s.calculatedAt,
  }));
}

export async function getLatestScore(
  userId: string
): Promise<{ score: number; breakdown: ScoreBreakdown; period: string; calculatedAt: Date } | null> {
  const latest = await prisma.performanceScore.findFirst({
    where: { userId },
    orderBy: { period: "desc" },
    select: { period: true, score: true, breakdown: true, calculatedAt: true },
  });

  if (!latest) return null;

  return {
    period: latest.period,
    score: latest.score,
    breakdown: latest.breakdown as unknown as ScoreBreakdown,
    calculatedAt: latest.calculatedAt,
  };
}

export async function getTopPerformers(
  organizationId: string,
  limit: number = 10
): Promise<Array<{ userId: string; score: number; period: string }>> {
  const period = getCurrentPeriod();

  const scores = await prisma.performanceScore.findMany({
    where: { organizationId, period },
    orderBy: { score: "desc" },
    take: limit,
    select: { userId: true, score: true, period: true },
  });

  return scores;
}
