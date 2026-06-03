// Team alignment — manager rollup for /team/alignment.
//
// One DB pass per surface, then aggregate in memory. Includes both
// solid reports (User.managerId) and dotted-line reports (Phase 1's
// UserDottedLine table) so matrix orgs see the right scope.
//
// Three slices:
//   - KRAs per report (active KRAAssignments)
//   - KPI compliance: for each report, % of their current-period KPIs
//     that are SUBMITTED or APPROVED.
//   - SOP read-rate: for each report, % of their SOPAssignments that
//     are COMPLETED.

import { prisma } from "@/lib/prisma";
import { getEffectiveReportTree } from "@/lib/reporting-line";
import { weekStartFor } from "@/lib/weekly-review";

export interface TeamMember {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  avatar: string | null;
  via: "solid" | "dotted";
  // Aggregates
  activeKras: Array<{ id: string; name: string; weightage: number }>;
  kpis: {
    total: number;
    submitted: number;
    approved: number;
    pending: number;
    rejected: number;
    /** Compliance % = (submitted + approved) / total. 100 if total=0. */
    compliancePct: number;
  };
  sops: {
    total: number;
    completed: number;
    mandatoryPending: number;
    /** Read-rate % = completed / total. 100 if total=0. */
    readRatePct: number;
  };
  weeklyReview: {
    /** This week's review for the member (Phase 5b). null = no row yet. */
    id: string | null;
    status: "DRAFT" | "SUBMITTED" | "ACKNOWLEDGED" | null;
    managerStatus: "PENDING" | "APPROVED" | "CHANGES_REQUESTED" | null;
  };
}

export interface TeamAlignment {
  managerId: string;
  generatedAt: string; // ISO
  members: TeamMember[];
  totals: {
    reportCount: number;
    activeKras: number;
    avgKpiCompliancePct: number;
    avgSopReadRatePct: number;
  };
}

export async function getTeamAlignment(args: {
  managerId: string;
  organizationId: string;
}): Promise<TeamAlignment> {
  const { managerId, organizationId } = args;

  // 1. Resolve solid + dotted reports (excluding the manager).
  const effective = await getEffectiveReportTree(managerId, { maxDepth: 6 });
  const reportIds = effective.filter((id) => id !== managerId);

  if (reportIds.length === 0) {
    return {
      managerId,
      generatedAt: new Date().toISOString(),
      members: [],
      totals: { reportCount: 0, activeKras: 0, avgKpiCompliancePct: 0, avgSopReadRatePct: 0 },
    };
  }

  // 2. Mark which reports come via dotted-line so the UI can label them.
  const dotted = await prisma.userDottedLine.findMany({
    where: { managerId, userId: { in: reportIds } },
    select: { userId: true },
  });
  const dottedSet = new Set(dotted.map((d) => d.userId));

  // 3. Fetch reports' core profile.
  const users = await prisma.user.findMany({
    where: { id: { in: reportIds }, organizationId, deletedAt: null },
    select: { id: true, firstName: true, lastName: true, email: true, avatar: true },
    orderBy: [{ firstName: "asc" }, { lastName: "asc" }],
  });
  const validIds = users.map((u) => u.id);

  const periodStart = weekStartFor();
  // 4. Bulk-fetch aggregates in parallel.
  const [kraAssignments, kpiRecords, sopAssignments, weeklyReviews] = await Promise.all([
    prisma.kRAAssignment.findMany({
      where: { userId: { in: validIds }, status: "ACTIVE" },
      include: { kra: { select: { id: true, name: true } } },
    }),
    prisma.kPIRecord.findMany({
      where: { userId: { in: validIds } },
      select: { userId: true, status: true },
    }),
    prisma.sOPAssignment.findMany({
      where: { userId: { in: validIds } },
      select: { userId: true, status: true, mandatory: true },
    }),
    prisma.weeklyReview.findMany({
      where: { userId: { in: validIds }, periodStart },
      select: { id: true, userId: true, status: true, managerStatus: true },
    }),
  ]);

  const reviewByUser = new Map(weeklyReviews.map((r) => [r.userId, r] as const));

  // 5. Index aggregates per user.
  const krasByUser = new Map<string, TeamMember["activeKras"]>();
  for (const a of kraAssignments) {
    const arr = krasByUser.get(a.userId) ?? [];
    arr.push({ id: a.kra.id, name: a.kra.name, weightage: a.weightage });
    krasByUser.set(a.userId, arr);
  }

  const kpisByUser = new Map<string, TeamMember["kpis"]>();
  for (const r of kpiRecords) {
    const cur = kpisByUser.get(r.userId) ?? { total: 0, submitted: 0, approved: 0, pending: 0, rejected: 0, compliancePct: 0 };
    cur.total += 1;
    if (r.status === "SUBMITTED") cur.submitted += 1;
    else if (r.status === "APPROVED") cur.approved += 1;
    else if (r.status === "REJECTED") cur.rejected += 1;
    else cur.pending += 1;
    kpisByUser.set(r.userId, cur);
  }

  const sopsByUser = new Map<string, TeamMember["sops"]>();
  for (const s of sopAssignments) {
    const cur = sopsByUser.get(s.userId) ?? { total: 0, completed: 0, mandatoryPending: 0, readRatePct: 0 };
    cur.total += 1;
    if (s.status === "COMPLETED") cur.completed += 1;
    else if (s.mandatory) cur.mandatoryPending += 1;
    sopsByUser.set(s.userId, cur);
  }

  // 6. Assemble per-member rollup.
  const members: TeamMember[] = users.map((u) => {
    const kpis = kpisByUser.get(u.id) ?? { total: 0, submitted: 0, approved: 0, pending: 0, rejected: 0, compliancePct: 0 };
    kpis.compliancePct = kpis.total > 0
      ? Math.round(((kpis.submitted + kpis.approved) / kpis.total) * 100)
      : 100;

    const sops = sopsByUser.get(u.id) ?? { total: 0, completed: 0, mandatoryPending: 0, readRatePct: 0 };
    sops.readRatePct = sops.total > 0
      ? Math.round((sops.completed / sops.total) * 100)
      : 100;

    const wr = reviewByUser.get(u.id);
    return {
      id: u.id,
      firstName: u.firstName,
      lastName: u.lastName,
      email: u.email,
      avatar: u.avatar,
      via: dottedSet.has(u.id) ? "dotted" : "solid",
      activeKras: krasByUser.get(u.id) ?? [],
      kpis,
      sops,
      weeklyReview: {
        id: wr?.id ?? null,
        status: wr?.status ?? null,
        managerStatus: wr?.managerStatus ?? null,
      },
    };
  });

  const totalKras = members.reduce((acc, m) => acc + m.activeKras.length, 0);
  const avgKpiCompliancePct = members.length > 0
    ? Math.round(members.reduce((acc, m) => acc + m.kpis.compliancePct, 0) / members.length)
    : 0;
  const avgSopReadRatePct = members.length > 0
    ? Math.round(members.reduce((acc, m) => acc + m.sops.readRatePct, 0) / members.length)
    : 0;

  return {
    managerId,
    generatedAt: new Date().toISOString(),
    members,
    totals: {
      reportCount: members.length,
      activeKras: totalKras,
      avgKpiCompliancePct,
      avgSopReadRatePct,
    },
  };
}
