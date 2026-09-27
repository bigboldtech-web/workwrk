// Review cycles on the server: the viewer's reach, the org's scoring
// settings, the per-person metrics a review shows, and the composite a
// calibration row carries. Every review route reads through here so the
// list, the cycle page, calibration and finalize agree on who sees whom
// and on what a score means.
//
// Server only.

import { prisma } from "@/lib/prisma";
import { viewerFromSession } from "@/lib/access/viewer";
import { getEffectiveReportTree } from "@/lib/reporting-line";
import { DEFAULT_SCORE_WEIGHTS, getScoringBands, type ScoringBand } from "@/lib/review-cadence";
import { compositeScore, ratingsTo100, scaleWords } from "./review-cycle";

export interface CycleViewerCtx {
  userId: string;
  organizationId: string;
  peopleTeamOrAdmin: boolean;
  isAgent: boolean;
  isGuest: boolean;
  /** Solid plus dotted, any depth the tree walks, self excluded. */
  chain: Set<string>;
}

export async function cycleViewerCtx(): Promise<CycleViewerCtx | null> {
  const v = await viewerFromSession();
  if (!v) return null;
  const chain = new Set((await getEffectiveReportTree(v.userId)).filter((id) => id !== v.userId));
  return {
    userId: v.userId,
    organizationId: v.organizationId,
    peopleTeamOrAdmin: v.orgRole === "OWNER" || v.orgRole === "ADMIN" || v.peopleTeam === true,
    isAgent: v.isAgent,
    isGuest: v.orgRole === "GUEST",
    chain,
  };
}

export interface OrgScoring {
  weights: { kpi: number; sopCompliance: number; behavioral: number; peer: number };
  bands: ScoringBand[];
  scale: { words: string[]; fromSettings: boolean };
}

/**
 * Settings > Scoring and reviews, read once per request: the score weights
 * (only the four the composite uses; a stale key from an older vocabulary is
 * ignored rather than summed), the performance bands and the five scale
 * words (behavioural anchors, or the built-in five).
 */
export async function orgScoring(organizationId: string): Promise<OrgScoring> {
  const org = await prisma.organization.findUnique({ where: { id: organizationId }, select: { settings: true } });
  const s = (org?.settings ?? {}) as Record<string, unknown>;
  const stored = (s.scoreWeights ?? {}) as Record<string, unknown>;
  const num = (v: unknown, d: number) => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : d);
  return {
    weights: {
      kpi: num(stored.kpi, DEFAULT_SCORE_WEIGHTS.kpi),
      sopCompliance: num(stored.sopCompliance, DEFAULT_SCORE_WEIGHTS.sopCompliance),
      behavioral: num(stored.behavioral, DEFAULT_SCORE_WEIGHTS.behavioral),
      peer: num(stored.peer, DEFAULT_SCORE_WEIGHTS.peer),
    },
    bands: getScoringBands(s),
    scale: scaleWords(s.behavioralAnchors),
  };
}

/** Whose reviews in a cycle this viewer runs: all (null) or their current chain. */
export function subjectReach(ctx: CycleViewerCtx): Set<string> | null {
  return ctx.peopleTeamOrAdmin ? null : ctx.chain;
}

export interface ReviewMetrics {
  /** Mean KPI score of records made inside the cycle window, or null. */
  avgKpiScore: number | null;
  /** Mean SOP compliance score inside the window, or null. */
  avgSopScore: number | null;
  /** Mean goal progress of the goals the person owns, or null. */
  okrAvgProgress: number | null;
}

/**
 * "What the system already knows" for one person in one cycle. Every number
 * is read inside the cycle's window, so the self review, the manager drawer
 * and the stored kpiScore can never disagree (the old GET averaged the last
 * twenty records of all time while the save averaged the window).
 */
export async function reviewMetrics(userId: string, organizationId: string, window: { start: Date; end: Date }): Promise<ReviewMetrics> {
  const [kpis, sops, okrs] = await Promise.all([
    prisma.kPIRecord.findMany({
      where: { userId, kpi: { organizationId }, createdAt: { gte: window.start, lte: window.end } },
      select: { score: true },
    }),
    prisma.sOPCompliance.findMany({
      where: { userId, createdAt: { gte: window.start, lte: window.end } },
      select: { score: true },
    }),
    prisma.oKR.findMany({ where: { organizationId, ownerId: userId }, select: { id: true } }),
  ]);
  const mean = (xs: number[]) => (xs.length ? Math.round(xs.reduce((a, b) => a + b, 0) / xs.length) : null);
  let okrAvgProgress: number | null = null;
  if (okrs.length) {
    const { computeGoalRollups, goalRollupFor } = await import("@/lib/alignment");
    const ctx = await computeGoalRollups(organizationId);
    const full = await prisma.oKR.findMany({ where: { id: { in: okrs.map((o) => o.id) } } });
    okrAvgProgress = mean(full.map((o) => goalRollupFor(ctx, o).progress ?? 0));
  }
  return {
    avgKpiScore: mean(kpis.map((r) => r.score).filter((n): n is number => typeof n === "number")),
    avgSopScore: mean(sops.map((r) => r.score).filter((n): n is number => typeof n === "number")),
    okrAvgProgress,
  };
}

/** Mean SOP compliance per person inside a window (for calibration rows). */
export async function sopScoresFor(userIds: string[], window: { start: Date; end: Date }): Promise<Map<string, number>> {
  if (!userIds.length) return new Map();
  const rows = await prisma.sOPCompliance.groupBy({
    by: ["userId"],
    where: { userId: { in: userIds }, createdAt: { gte: window.start, lte: window.end }, score: { not: null } },
    _avg: { score: true },
  });
  return new Map(rows.filter((r) => r._avg.score != null).map((r) => [r.userId, Math.round(r._avg.score as number)] as const));
}

export interface CalibrationRowInput {
  kpiScore: number | null;
  managerRating: number | null;
  selfRatings: unknown;
  peerRatings: Array<number | null>;
  sopScore: number | null;
}

/** The numbers one calibration row shows, and its composite from the org's weights. */
export function calibrationNumbers(r: CalibrationRowInput, weights: OrgScoring["weights"]): {
  kpi: number | null;
  self: number | null;
  manager: number | null;
  peer: number | null;
  sop: number | null;
  composite: number | null;
} {
  const sr = (r.selfRatings ?? {}) as { kraRatings?: Array<{ rating?: unknown }> };
  const self = ratingsTo100((sr.kraRatings ?? []).map((k) => (typeof k.rating === "number" ? k.rating : null)));
  const peer = ratingsTo100(r.peerRatings);
  const composite = compositeScore({ kpi: r.kpiScore, sopCompliance: r.sopScore, behavioral: r.managerRating, peer }, weights);
  return { kpi: r.kpiScore, self, manager: r.managerRating, peer, sop: r.sopScore, composite };
}

/**
 * A cycle's people count and completion over a set of review rows, one
 * grouped query (never the whole review list shipped to the client).
 */
export async function cycleCounts(cycleIds: string[], reviewsWhere?: object): Promise<Map<string, { total: number; selfDone: number; managerDone: number; calibrated: number; completed: number }>> {
  const out = new Map<string, { total: number; selfDone: number; managerDone: number; calibrated: number; completed: number }>();
  if (!cycleIds.length) return out;
  const rows = await prisma.review.groupBy({
    by: ["cycleId", "status"],
    where: { cycleId: { in: cycleIds }, ...(reviewsWhere ?? {}) },
    _count: { _all: true },
  });
  const calibrated = await prisma.review.groupBy({
    by: ["cycleId"],
    where: { cycleId: { in: cycleIds }, calibratedScore: { not: null }, ...(reviewsWhere ?? {}) },
    _count: { _all: true },
  });
  for (const id of cycleIds) out.set(id, { total: 0, selfDone: 0, managerDone: 0, calibrated: 0, completed: 0 });
  for (const r of rows) {
    const c = out.get(r.cycleId)!;
    const n = r._count._all;
    c.total += n;
    if (r.status !== "PENDING") c.selfDone += n;
    if (r.status === "MANAGER_REVIEW" || r.status === "CALIBRATION" || r.status === "COMPLETED") c.managerDone += n;
    if (r.status === "COMPLETED") c.completed += n;
  }
  for (const r of calibrated) out.get(r.cycleId)!.calibrated = r._count._all;
  return out;
}

/**
 * Who may be asked for peer feedback on a subject: people who work with
 * them (their department, their office, the people who share their
 * manager, their manager, their direct reports), active and in the org,
 * never the subject. The peers picker lists this and the request route
 * enforces it, so the list and the write can never disagree. (Space
 * membership is the access engine's store and is not read here.)
 */
export async function peerCandidateWhere(
  organizationId: string,
  subject: { id: string; managerId: string | null; departmentId: string | null; officeId?: string | null },
): Promise<import("@/generated/prisma").Prisma.UserWhereInput> {
  const or: import("@/generated/prisma").Prisma.UserWhereInput[] = [{ managerId: subject.id }];
  if (subject.managerId) or.push({ id: subject.managerId }, { managerId: subject.managerId });
  if (subject.departmentId) or.push({ departmentId: subject.departmentId });
  if (subject.officeId) or.push({ officeId: subject.officeId });
  return { organizationId, deletedAt: null, status: "ACTIVE", id: { not: subject.id }, OR: or };
}
