// One person's live alignment picture, the shared read-side builder
// behind GET /api/people/[id]/alignment (manager inspection) and
// GET /api/me/alignment (the employee door). One builder so both doors
// always show the same numbers.
//
//  - kras: the KRAs + KPI gauges this person holds (KRAAssignment, seeded
//    from their role's templates by src/lib/alignment-assign.ts). Each KPI
//    carries THIS PERSON's latest usable reading (their own KPIRecords,
//    a gauge is read per-person), its health against the healthy line,
//    and their current-period record with its approval status, plus
//    `sentBack`, a number the manager asked them to change (this month or
//    last) with the manager's note. A KPI with no targetValue reports
//    "no_target": no line is invented.
//  - okrs: the person's current goals, goals they OWN plus goals whose
//    audience resolves to them (assigned directly, or through their
//    department / role; GoalAssignee resolution happens at read time, so
//    it always reflects today's org chart). KR→KPI links resolved and
//    derived currentValue/progress. A shared goal stays ONE record with one
//    scoreboard, appearing on several people's pages is the same row.
//
//    WHICH goals (goalInPersonWindow): OKR.quarter, the old free-text
//    label, is no longer written (fiscal-quarter.ts), so a filter on it
//    alone dropped every goal made from the New goal modal and a manager
//    opened a report's profile to "No goals this quarter" while /okrs
//    listed them. With no ?quarter= the window is the one /okrs shows by
//    default: every goal still open plus those completed this fiscal
//    quarter, and a legacy labelled goal only when its label is the
//    current quarter's. An explicit ?quarter= label matches the legacy
//    label or, for an unlabelled goal, the fiscal label of its due date.
//
//    Each goal carries `verdict`, the ONE on track answer (goal-verdict.ts
//    verdictForGoal) computed from the same inputs GET /api/okrs hands it,
//    so a goal reads the same word on the profile as on /okrs and its
//    page. The stored status drifts (a goal 30% done in week one is stored
//    BEHIND while its pace is fine; a goal with no targets stays ON_TRACK
//    while it is Not measured), so it is never the chip.

import { prisma } from "@/lib/prisma";
import type { Prisma } from "@/generated/prisma";
import {
  computeGoalRollups,
  enrichKeyResultGroups,
  goalRollupFor,
  kpiDirection,
  kpiHealth,
  KPI_ORDER,
  KR_KPI_SELECT,
  latestKpiValues,
} from "@/lib/alignment";
import { verdictForGoal, type GoalVerdict } from "@/lib/goal-verdict";
import { goalsWithLinkedWork } from "@/lib/goal-effort";
import { fiscalQuarterStart, goalQuarterLabel } from "@/lib/fiscal-quarter";

export function currentQuarterLabel(): string {
  const d = new Date();
  return `Q${Math.floor(d.getMonth() / 3) + 1} ${d.getFullYear()}`;
}

/** Canonical KPIRecord period key for "now": "YYYY-MM". */
export function currentPeriodKey(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

/** The "YYYY-MM" month before a "YYYY-MM" key. Pure. */
export function previousPeriodKey(period: string): string {
  const [y, m] = period.split("-").map(Number);
  return m <= 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, "0")}`;
}

/**
 * The number a manager sent back and still waits on this person, per KPI.
 * Pure.
 *
 * Request changes stores the note on the record (managerNotes) and the
 * notification links to the KRAs tab, so that tab is where the note has to
 * be readable once the notification is gone. The two writable months count
 * (this month and last, isKpiPeriodWritableAnyZone): a manager reviewing on
 * the 1st sends back last month's number, and the person can still answer
 * it. This month wins when both were sent back. A resubmitted number is
 * SUBMITTED again and drops out on its own.
 */
export function sentBackByKpi<R extends { kpiId: string; period: string; status: string; actualValue: number | null; managerNotes: string | null }>(
  records: readonly R[],
  currentPeriod: string,
): Map<string, { period: string; actualValue: number | null; managerNotes: string | null }> {
  const lastPeriod = previousPeriodKey(currentPeriod);
  const out = new Map<string, { period: string; actualValue: number | null; managerNotes: string | null }>();
  for (const r of records) {
    if (r.status !== "REJECTED") continue;
    if (r.period !== currentPeriod && r.period !== lastPeriod) continue;
    const had = out.get(r.kpiId);
    if (had && had.period === currentPeriod) continue;
    out.set(r.kpiId, { period: r.period, actualValue: r.actualValue, managerNotes: r.managerNotes?.trim() || null });
  }
  return out;
}

const ms = (v: Date | string | null | undefined) => (v == null ? null : new Date(v).getTime());

/**
 * Does this goal belong on the person's Goals section? Pure.
 *
 *  - explicit label (?quarter=): the legacy label equals it, or the goal
 *    has no legacy label and its due date's fiscal quarter label equals it.
 *  - default window: a legacy labelled goal only when its label is the
 *    current quarter's (calendar, the old default, or fiscal); an
 *    unlabelled goal unless it is completed and ended before the current
 *    fiscal quarter began (the rule filterGoals applies on /okrs).
 */
export function goalInPersonWindow(
  g: { quarter: string | null; endDate: Date | string | null; completedAt?: Date | string | null; createdAt: Date | string },
  verdict: GoalVerdict,
  ctx: { label: string | null; legacyLabels: readonly string[]; quarterStart: Date; fiscalStart: unknown },
): boolean {
  const legacy = (g.quarter ?? "").trim();
  if (ctx.label) {
    if (legacy) return legacy === ctx.label;
    return goalQuarterLabel(g.endDate, ctx.fiscalStart) === ctx.label;
  }
  if (legacy) return ctx.legacyLabels.includes(legacy);
  if (verdict !== "completed") return true;
  const end = ms(g.completedAt ?? null) ?? ms(g.endDate) ?? ms(g.createdAt);
  return end == null || end >= ctx.quarterStart.getTime();
}

export async function buildPersonAlignment(
  orgId: string,
  userId: string,
  opts: { quarter?: string | null } = {},
) {
  const explicitQuarter = opts.quarter?.trim() || null;
  const currentPeriod = currentPeriodKey();
  const now = new Date();

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

  const [assignments, candidateOkrs, org] = await Promise.all([
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
      // Narrowed in JS (goalInPersonWindow): the window reads the verdict
      // and the due date's fiscal quarter, neither of which is a column.
      where: { organizationId: orgId, OR: goalOr },
      include: {
        keyResults: {
          include: { kpi: { select: KR_KPI_SELECT } },
          orderBy: { createdAt: "asc" },
        },
      },
      orderBy: [{ position: "asc" }, { createdAt: "desc" }],
    }),
    prisma.organization.findUnique({ where: { id: orgId }, select: { settings: true } }),
  ]);
  const fiscalStart = (org?.settings as { fiscalYearStart?: unknown } | null)?.fiscalYearStart;
  const quarterStart = fiscalQuarterStart(now, fiscalStart);
  const currentFiscalLabel = goalQuarterLabel(now, fiscalStart) ?? currentQuarterLabel();
  // The label the section heading names: the one asked for, else the
  // current fiscal quarter (the same label /okrs shows).
  const quarter = explicitQuarter ?? currentFiscalLabel;

  // This person's latest usable reading per gauge (their own records only)
  // plus their current-period record, "what have I achieved, what still
  // needs my number this month, where is it in the approval loop."
  const kpiIds = assignments.flatMap((a) => a.kra.kpis.map((k) => k.id));
  const [latest, recentRecords] = await Promise.all([
    latestKpiValues(kpiIds, { userId }),
    kpiIds.length > 0
      ? prisma.kPIRecord.findMany({
          // Last month too, for a number sent back after the month closed
          // (sentBackByKpi); currentRecord stays this month's row.
          where: { userId, period: { in: [currentPeriod, previousPeriodKey(currentPeriod)] }, kpiId: { in: kpiIds } },
          select: {
            id: true, kpiId: true, period: true, actualValue: true,
            targetValue: true, score: true, status: true, notes: true, managerNotes: true,
          },
        })
      : Promise.resolve([]),
  ]);
  const currentByKpi = new Map(recentRecords.filter((r) => r.period === currentPeriod).map((r) => [r.kpiId, r]));
  const sentBack = sentBackByKpi(recentRecords, currentPeriod);

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
        // Resolved direction, the enum when set, else the legacy boolean.
        direction: kpiDirection(kpi),
        latestValue: reading?.value ?? null,
        latestPeriod: reading?.period ?? null,
        health: kpiHealth(kpi, reading?.value ?? null),
        currentRecord: currentByKpi.get(kpi.id) ?? null,
        // A number the manager sent back, with their note, this month or
        // last (sentBackByKpi); null when nothing waits on the person.
        sentBack: sentBack.get(kpi.id) ?? null,
      };
    }),
  }));

  // Goal progress/status come from the shared org-wide rollup (live KRs +
  // measured children), the same computeGoalRollups number the goals list
  // / detail / dashboard show, never a second math. The verdict reads the
  // same inputs GET /api/okrs gathers: each target's newest check-in (one
  // batched query) and whether any work is linked.
  const krIds = candidateOkrs.flatMap((o) => o.keyResults.map((k) => k.id));
  const [rollupCtx, linked, lastCheckIns] = await Promise.all([
    computeGoalRollups(orgId),
    goalsWithLinkedWork(orgId, candidateOkrs.map((o) => o.id)),
    krIds.length
      ? prisma.kRCheckIn.groupBy({
          by: ["keyResultId"],
          where: { keyResultId: { in: krIds } },
          _max: { createdAt: true },
        })
      : Promise.resolve([] as Array<{ keyResultId: string; _max: { createdAt: Date | null } }>),
  ]);
  const lastByKr = new Map(lastCheckIns.map((r) => [r.keyResultId, r._max.createdAt]));
  const windowCtx = {
    label: explicitQuarter,
    legacyLabels: [currentQuarterLabel(), currentFiscalLabel],
    quarterStart,
    fiscalStart,
  };
  const okrs = candidateOkrs
    .map((o) => {
      const rollup = goalRollupFor(rollupCtx, o);
      const { verdict } = verdictForGoal({
        goal: o,
        rollup: { progress: rollup.progress, source: rollup.source },
        targets: o.keyResults.map((k) => ({ lastCheckInAt: lastByKr.get(k.id) ?? null, derived: k.kpiId != null })),
        hasLinkedWork: linked.has(o.id),
      }, now);
      return { o, rollup, verdict };
    })
    .filter(({ o, verdict }) => goalInPersonWindow(o, verdict, windowCtx));

  // KPI-linked KRs report the gauge's latest reading (read-side derivation).
  const groups = await enrichKeyResultGroups(
    okrs.map(({ o }) => ({ userId: o.ownerId, keyResults: o.keyResults })),
  );
  const enrichedOkrs = okrs.map(({ o, rollup, verdict }, i) => ({
    ...o,
    keyResults: groups[i],
    progress: rollup.progress,
    status: rollup.status,
    progressSource: rollup.source,
    verdict,
    // The due date's fiscal quarter, the label /okrs rows show.
    quarterLabel: goalQuarterLabel(o.endDate, fiscalStart),
  }));

  return { quarter, window: explicitQuarter ? "quarter" : "current", currentPeriod, kras, okrs: enrichedOkrs };
}
