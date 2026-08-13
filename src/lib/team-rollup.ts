// Director rollup — walks the reporting tree one level deeper than
// the manager-rollup helper (Phase 4c) and groups by sub-manager.
//
// Layout:
//   - Director has direct + dotted reports.
//   - For each direct report that themselves has reports → "sub-team".
//   - Reports without their own reports → "direct ICs".
//
// Aggregated metrics per sub-team:
//   activeKras, avgKpiCompliancePct, avgSopReadRatePct, weeklyReview
//   submission % (this week), weekly review approved % (this week).
//
// Top-line totals roll up across every IC in the entire tree.

import { prisma } from "@/lib/prisma";
import { getAllDirectReports } from "@/lib/reporting-line";
import { currentPeriodKey } from "@/lib/person-alignment";
import { weekStartFor } from "@/lib/weekly-review";

export interface SubManager {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  avatar: string | null;
  via: "solid" | "dotted";
  /** This manager's own weekly review status (they're also a report
   *  of the director). null = no row yet. */
  ownReview: {
    status: "DRAFT" | "SUBMITTED" | "ACKNOWLEDGED" | null;
    managerStatus: "PENDING" | "APPROVED" | "CHANGES_REQUESTED" | null;
  };
}

export interface SubTeamMetrics {
  reportCount: number;
  activeKras: number;
  /** null = no measured members. */
  avgKpiCompliancePct: number | null;
  avgSopReadRatePct: number | null;
  /** % of reports who have a SUBMITTED-or-ACKNOWLEDGED weekly review for this week. */
  weeklyReviewSubmittedPct: number;
  /** % of reports whose this-week review has managerStatus=APPROVED. */
  weeklyReviewApprovedPct: number;
}

export interface SubTeam {
  manager: SubManager;
  metrics: SubTeamMetrics;
}

export interface DirectIcSummary {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  avatar: string | null;
  via: "solid" | "dotted";
  /** null = no records to measure — renders as "—", never a fake 100%. */
  kpiCompliancePct: number | null;
  sopReadRatePct: number | null;
  weeklyReview: { status: "DRAFT" | "SUBMITTED" | "ACKNOWLEDGED" | null; managerStatus: "PENDING" | "APPROVED" | "CHANGES_REQUESTED" | null };
}

export interface DirectorRollup {
  directorId: string;
  generatedAt: string;
  subTeams: SubTeam[];
  directIcs: DirectIcSummary[];
  totals: {
    subTeamCount: number;
    directIcCount: number;
    aggregateReportCount: number;
    /** null = no measured members. */
    avgKpiCompliancePct: number | null;
    avgSopReadRatePct: number | null;
    weeklyReviewSubmittedPct: number;
    weeklyReviewApprovedPct: number;
  };
}

interface PerUserAggregates {
  activeKras: number;
  /** null = no records to measure — renders as "—", never a fake 100%. */
  kpiCompliancePct: number | null;
  sopReadRatePct: number | null;
  weeklyReview: {
    status: "DRAFT" | "SUBMITTED" | "ACKNOWLEDGED" | null;
    managerStatus: "PENDING" | "APPROVED" | "CHANGES_REQUESTED" | null;
  };
}

async function aggregateForUserIds(userIds: string[], organizationId: string): Promise<Map<string, PerUserAggregates>> {
  const out = new Map<string, PerUserAggregates>();
  for (const id of userIds) {
    out.set(id, {
      activeKras: 0,
      kpiCompliancePct: null,
      sopReadRatePct: null,
      weeklyReview: { status: null, managerStatus: null },
    });
  }
  if (userIds.length === 0) return out;

  const periodStart = weekStartFor();
  const [kras, kpis, sops, reviews] = await Promise.all([
    prisma.kRAAssignment.groupBy({
      by: ["userId"],
      where: { userId: { in: userIds }, status: "ACTIVE", kra: { organizationId } },
      _count: { userId: true },
    }),
    prisma.kPIRecord.findMany({
      // Current canonical period only — the same window /team/alignment
      // and /people/me measure, so the two surfaces agree per person.
      where: { userId: { in: userIds }, period: currentPeriodKey(), kpi: { organizationId } },
      select: { userId: true, status: true },
    }),
    prisma.sOPAssignment.findMany({
      where: { userId: { in: userIds }, sop: { organizationId } },
      select: { userId: true, status: true },
    }),
    prisma.weeklyReview.findMany({
      where: { userId: { in: userIds }, periodStart },
      select: { userId: true, status: true, managerStatus: true },
    }),
  ]);

  for (const k of kras) {
    const cur = out.get(k.userId)!;
    cur.activeKras = k._count.userId;
  }

  const kpiBuckets = new Map<string, { total: number; ok: number }>();
  for (const r of kpis) {
    const b = kpiBuckets.get(r.userId) ?? { total: 0, ok: 0 };
    b.total += 1;
    if (r.status === "SUBMITTED" || r.status === "APPROVED") b.ok += 1;
    kpiBuckets.set(r.userId, b);
  }
  for (const [uid, b] of kpiBuckets) {
    const cur = out.get(uid)!;
    cur.kpiCompliancePct = b.total > 0 ? Math.round((b.ok / b.total) * 100) : null;
  }

  const sopBuckets = new Map<string, { total: number; done: number }>();
  for (const s of sops) {
    const b = sopBuckets.get(s.userId) ?? { total: 0, done: 0 };
    b.total += 1;
    if (s.status === "COMPLETED") b.done += 1;
    sopBuckets.set(s.userId, b);
  }
  for (const [uid, b] of sopBuckets) {
    const cur = out.get(uid)!;
    cur.sopReadRatePct = b.total > 0 ? Math.round((b.done / b.total) * 100) : null;
  }

  for (const r of reviews) {
    const cur = out.get(r.userId)!;
    cur.weeklyReview = { status: r.status, managerStatus: r.managerStatus };
  }

  return out;
}

export async function getDirectorRollup(args: {
  directorId: string;
  organizationId: string;
}): Promise<DirectorRollup> {
  const { directorId, organizationId } = args;

  // 1. Director's direct reports (solid + dotted, one level).
  const directIds = await getAllDirectReports(directorId);
  if (directIds.length === 0) {
    return {
      directorId,
      generatedAt: new Date().toISOString(),
      subTeams: [],
      directIcs: [],
      totals: {
        subTeamCount: 0,
        directIcCount: 0,
        aggregateReportCount: 0,
        avgKpiCompliancePct: null,
        avgSopReadRatePct: null,
        weeklyReviewSubmittedPct: 0,
        weeklyReviewApprovedPct: 0,
      },
    };
  }

  // 2. Classify direct reports — manager (has reports) vs IC.
  const directReportsOfDirects = await prisma.user.findMany({
    where: {
      managerId: { in: directIds },
      organizationId,
      deletedAt: null,
    },
    select: { id: true, managerId: true },
  });
  const reportsBySubManager = new Map<string, string[]>();
  for (const r of directReportsOfDirects) {
    if (!r.managerId) continue;
    const arr = reportsBySubManager.get(r.managerId) ?? [];
    arr.push(r.id);
    reportsBySubManager.set(r.managerId, arr);
  }

  // 3. Mark dotted reports of the director.
  const dottedDirects = await prisma.userDottedLine.findMany({
    where: { managerId: directorId, userId: { in: directIds } },
    select: { userId: true },
  });
  const dottedSet = new Set(dottedDirects.map((d) => d.userId));

  // 4. Pull direct reports' profile.
  const directs = await prisma.user.findMany({
    where: { id: { in: directIds }, organizationId, deletedAt: null },
    select: { id: true, firstName: true, lastName: true, email: true, avatar: true },
  });
  const directById = new Map(directs.map((d) => [d.id, d] as const));

  const subManagerIds: string[] = [];
  const directIcIds: string[] = [];
  for (const d of directs) {
    if ((reportsBySubManager.get(d.id) ?? []).length > 0) subManagerIds.push(d.id);
    else directIcIds.push(d.id);
  }

  // 5. Aggregate per-user for everyone we'll mention (direct ICs +
  //    every sub-manager's reports + the sub-managers themselves —
  //    we need the sub-managers' own weekly-review status to surface
  //    on the tile).
  const allReportIds = Array.from(new Set([
    ...directIcIds,
    ...subManagerIds,
    ...Array.from(reportsBySubManager.values()).flat(),
  ]));
  const agg = await aggregateForUserIds(allReportIds, organizationId);

  // 6. Build sub-team rollups.
  const subTeams: SubTeam[] = subManagerIds.map((subId) => {
    const profile = directById.get(subId)!;
    const reports = reportsBySubManager.get(subId) ?? [];

    let kras = 0;
    // Sum only MEASURED members — null (no data) must not count as perfect.
    let kpiSum = 0, kpiN = 0, sopSum = 0, sopN = 0, reviewedCount = 0, approvedCount = 0;
    for (const rid of reports) {
      const a = agg.get(rid)!;
      kras += a.activeKras;
      if (a.kpiCompliancePct != null) { kpiSum += a.kpiCompliancePct; kpiN += 1; }
      if (a.sopReadRatePct != null) { sopSum += a.sopReadRatePct; sopN += 1; }
      if (a.weeklyReview.status === "SUBMITTED" || a.weeklyReview.status === "ACKNOWLEDGED") reviewedCount += 1;
      if (a.weeklyReview.managerStatus === "APPROVED") approvedCount += 1;
    }
    const n = reports.length;
    const subManagerAgg = agg.get(subId);
    return {
      manager: {
        id: profile.id,
        firstName: profile.firstName,
        lastName: profile.lastName,
        email: profile.email,
        avatar: profile.avatar,
        via: dottedSet.has(subId) ? "dotted" : "solid",
        ownReview: subManagerAgg?.weeklyReview ?? { status: null, managerStatus: null },
      },
      metrics: {
        reportCount: n,
        activeKras: kras,
        avgKpiCompliancePct: kpiN > 0 ? Math.round(kpiSum / kpiN) : null,
        avgSopReadRatePct: sopN > 0 ? Math.round(sopSum / sopN) : null,
        weeklyReviewSubmittedPct: n > 0 ? Math.round((reviewedCount / n) * 100) : 0,
        weeklyReviewApprovedPct: n > 0 ? Math.round((approvedCount / n) * 100) : 0,
      },
    };
  });

  // 7. Direct ICs (reports of the director with no reports of their own).
  const directIcs: DirectIcSummary[] = directIcIds.map((id) => {
    const profile = directById.get(id)!;
    const a = agg.get(id)!;
    return {
      id: profile.id,
      firstName: profile.firstName,
      lastName: profile.lastName,
      email: profile.email,
      avatar: profile.avatar,
      via: dottedSet.has(id) ? "dotted" : "solid",
      kpiCompliancePct: a.kpiCompliancePct,
      sopReadRatePct: a.sopReadRatePct,
      weeklyReview: a.weeklyReview,
    };
  });

  // 8. Top-line totals across all ICs in the tree (direct + sub-team).
  const allIcIds = [
    ...directIcIds,
    ...Array.from(reportsBySubManager.values()).flat(),
  ];
  let aggregateKpi = 0, aggregateKpiN = 0, aggregateSop = 0, aggregateSopN = 0, aggregateReviewed = 0, aggregateApproved = 0;
  for (const id of allIcIds) {
    const a = agg.get(id)!;
    if (a.kpiCompliancePct != null) { aggregateKpi += a.kpiCompliancePct; aggregateKpiN += 1; }
    if (a.sopReadRatePct != null) { aggregateSop += a.sopReadRatePct; aggregateSopN += 1; }
    if (a.weeklyReview.status === "SUBMITTED" || a.weeklyReview.status === "ACKNOWLEDGED") aggregateReviewed += 1;
    if (a.weeklyReview.managerStatus === "APPROVED") aggregateApproved += 1;
  }
  const totalIcs = allIcIds.length;
  return {
    directorId,
    generatedAt: new Date().toISOString(),
    subTeams,
    directIcs,
    totals: {
      subTeamCount: subTeams.length,
      directIcCount: directIcs.length,
      aggregateReportCount: totalIcs,
      avgKpiCompliancePct: aggregateKpiN > 0 ? Math.round(aggregateKpi / aggregateKpiN) : null,
      avgSopReadRatePct: aggregateSopN > 0 ? Math.round(aggregateSop / aggregateSopN) : null,
      weeklyReviewSubmittedPct: totalIcs > 0 ? Math.round((aggregateReviewed / totalIcs) * 100) : 0,
      weeklyReviewApprovedPct: totalIcs > 0 ? Math.round((aggregateApproved / totalIcs) * 100) : 0,
    },
  };
}
