// One person's live alignment picture — the shared read-side builder
// behind GET /api/people/[id]/alignment (manager inspection) and
// GET /api/me/alignment (the employee door). One builder so both doors
// always show the same numbers.
//
//  - kras: the KRAs + KPI gauges this person holds (KRAAssignment, seeded
//    from their role's templates by src/lib/alignment-assign.ts). Each KPI
//    carries THIS PERSON's latest usable reading (their own KPIRecords —
//    a gauge is read per-person), its health against the healthy line,
//    and their current-period record with its approval status. A KPI with
//    no targetValue reports "no_target": no line is invented.
//  - okrs: the person's objectives for the requested cycle (default =
//    current quarter) — goals they OWN plus goals whose audience resolves
//    to them (assigned directly, or through their department / role;
//    GoalAssignee resolution happens at read time, so it always reflects
//    today's org chart). KR→KPI links resolved and derived
//    currentValue/progress. A shared goal stays ONE record with one
//    scoreboard — appearing on several people's pages is the same row.

import { prisma } from "@/lib/prisma";
import type { Prisma } from "@/generated/prisma";
import {
  enrichKeyResultGroups,
  kpiDirection,
  kpiHealth,
  KPI_ORDER,
  KR_KPI_SELECT,
  latestKpiValues,
  rollUpOkrProgress,
} from "@/lib/alignment";

export function currentQuarterLabel(): string {
  const d = new Date();
  return `Q${Math.floor(d.getMonth() / 3) + 1} ${d.getFullYear()}`;
}

/** Canonical KPIRecord period key for "now": "YYYY-MM". */
export function currentPeriodKey(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

export async function buildPersonAlignment(
  orgId: string,
  userId: string,
  opts: { quarter?: string | null } = {},
) {
  const quarter = opts.quarter || currentQuarterLabel();
  const currentPeriod = currentPeriodKey();

  // Audience membership is resolved NOW (dept/role refs, never a frozen
  // list): only an ACTIVE, non-deleted person inherits dept/role goals.
  const person = await prisma.user.findUnique({
    where: { id: userId },
    select: { departmentId: true, roleId: true, status: true, deletedAt: true },
  });
  const isActive = person?.status === "ACTIVE" && !person.deletedAt;
  const goalOr: Prisma.OKRWhereInput[] = [
    { ownerId: userId },
    { assignees: { some: { userId } } },
  ];
  if (isActive && person?.departmentId) {
    goalOr.push({ assignees: { some: { departmentId: person.departmentId } } });
  }
  if (isActive && person?.roleId) {
    goalOr.push({ assignees: { some: { roleId: person.roleId } } });
  }

  const [assignments, okrs] = await Promise.all([
    prisma.kRAAssignment.findMany({
      where: { userId, status: "ACTIVE", kra: { organizationId: orgId } },
      select: {
        id: true,
        weightage: true,
        period: true,
        kra: {
          select: {
            id: true,
            name: true,
            description: true,
            category: true,
            roleId: true,
            role: { select: { id: true, title: true } },
            kpis: {
              select: {
                id: true, name: true, description: true, unit: true, type: true,
                frequency: true, targetValue: true, targetLabel: true,
                lowerIsBetter: true, direction: true, ownership: true, isNorthStar: true,
              },
              orderBy: KPI_ORDER,
            },
          },
        },
      },
      orderBy: { createdAt: "asc" },
    }),
    prisma.oKR.findMany({
      where: { organizationId: orgId, quarter, OR: goalOr },
      include: {
        keyResults: {
          include: { kpi: { select: KR_KPI_SELECT } },
          orderBy: { createdAt: "asc" },
        },
      },
      orderBy: [{ position: "asc" }, { createdAt: "desc" }],
    }),
  ]);

  // This person's latest usable reading per gauge (their own records only)
  // plus their current-period record — "what have I achieved, what still
  // needs my number this month, where is it in the approval loop."
  const kpiIds = assignments.flatMap((a) => a.kra.kpis.map((k) => k.id));
  const [latest, currentRecords] = await Promise.all([
    latestKpiValues(kpiIds, { userId }),
    kpiIds.length > 0
      ? prisma.kPIRecord.findMany({
          where: { userId, period: currentPeriod, kpiId: { in: kpiIds } },
          select: {
            id: true, kpiId: true, period: true, actualValue: true,
            targetValue: true, score: true, status: true, notes: true, managerNotes: true,
          },
        })
      : Promise.resolve([]),
  ]);
  const currentByKpi = new Map(currentRecords.map((r) => [r.kpiId, r]));

  const kras = assignments.map((a) => ({
    assignmentId: a.id,
    weightage: a.weightage,
    period: a.period,
    id: a.kra.id,
    name: a.kra.name,
    description: a.kra.description,
    category: a.kra.category,
    roleId: a.kra.roleId,
    role: a.kra.role,
    kpis: a.kra.kpis.map((kpi) => {
      const reading = latest.get(kpi.id);
      return {
        ...kpi,
        // Resolved direction — the enum when set, else the legacy boolean.
        direction: kpiDirection(kpi),
        latestValue: reading?.value ?? null,
        latestPeriod: reading?.period ?? null,
        health: kpiHealth(kpi, reading?.value ?? null),
        currentRecord: currentByKpi.get(kpi.id) ?? null,
      };
    }),
  }));

  // KPI-linked KRs report the gauge's latest reading (read-side derivation).
  const groups = await enrichKeyResultGroups(
    okrs.map((o) => ({ userId: o.ownerId, keyResults: o.keyResults })),
  );
  const enrichedOkrs = okrs.map((o, i) => {
    const keyResults = groups[i];
    return { ...o, keyResults, progress: rollUpOkrProgress(keyResults) ?? o.progress };
  });

  return { quarter, currentPeriod, kras, okrs: enrichedOkrs };
}
