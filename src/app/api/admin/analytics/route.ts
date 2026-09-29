import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionOrFail, jsonSuccess } from "@/lib/api-helpers";
import { requirePlatformAdminApi } from "@/lib/platform-admin";
import { companyViewWhere, toCsv } from "@/lib/admin/companies-list";
import {
  DAY_MS,
  RANGE_LABEL,
  averageOf,
  buildCohorts,
  countByBucket,
  derivedRevenue,
  fromMinor,
  monthKeyLabel,
  parseRange,
  rangeWindow,
  startOfMonthUTC,
  topCompanies,
  type AnalyticsRange,
  type RankedCompany,
} from "@/lib/admin/numbers";
import { readChargedSeries, readMonthlyRevenue } from "@/lib/admin/stripe-revenue";
import { planLabel } from "@/lib/staff-audit-helpers";

/**
 * GET /api/admin/analytics?range=30d|3m|12m: the Staff console's Analytics
 * (spec-admin-backoffice 2.5). Platform staff only. `&format=csv` downloads
 * the same numbers for the same range.
 *
 *   revenue       what Stripe charges per month (active subscriptions at
 *                 Stripe's own prices) and what paid invoices took per
 *                 bucket, ONE LINE PER CURRENCY, never converted, with the
 *                 Annual run rate (monthly x 12) and the average per paying
 *                 company derived from it. "unavailable" when billing is not
 *                 connected, "error" when Stripe did not answer.
 *   growth        new companies and new people in the range, companies per
 *                 bucket, on trial now, average people per company
 *   funnel        of the companies that signed up in the range: finished
 *                 setup, created something, paying (every step counts the
 *                 same companies, so no step can exceed the one above)
 *   retention     a cohort per signup month; Still active = recorded activity
 *                 in the last 30 days, not a billing flag
 *   cancellations the last ten subscription cancellations in the range
 *   biggest       top five by people; busiest = top five by recorded actions
 *                 in the range
 *   plans         companies per plan (cancelled companies not counted); no
 *                 revenue per plan, because Stripe does not know our plans
 *
 * Replaces the analytics half of the old GET /api/admin/stats. There is no
 * price list: see docs/plans/ui-refresh/staff-console-numbers.md.
 */

/** A window never asks Prisma for an unbounded id list. */
const WINDOW_COMPANY_CAP = 50_000;

async function namesFor(ids: string[]): Promise<Map<string, string>> {
  if (ids.length === 0) return new Map();
  const rows = await prisma.organization.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } });
  return new Map(rows.map((r) => [r.id, r.name]));
}

async function ranked(groups: { organizationId: string | null; n: number }[]): Promise<RankedCompany[]> {
  const live = groups.filter((g): g is { organizationId: string; n: number } => !!g.organizationId);
  const names = await namesFor(live.map((g) => g.organizationId));
  // A company deleted since its rows were written has no name to show and is left out.
  return topCompanies(
    live.filter((g) => names.has(g.organizationId)).map((g) => ({ id: g.organizationId, name: names.get(g.organizationId) as string, value: g.n })),
  );
}

async function computeAnalytics(range: AnalyticsRange, now: Date) {
  const w = rangeWindow(range, now);
  const cohortStart = startOfMonthUTC(w.start);
  const ago30 = new Date(now.getTime() - 30 * DAY_MS);

  const [
    totalCompanies,
    totalPeople,
    newPeople,
    onTrial,
    windowCompanies,
    cohortCompanies,
    cancellationRows,
    peopleGroups,
    actionGroups,
    planGroups,
    monthly,
    charged,
  ] = await Promise.all([
    prisma.organization.count(),
    prisma.user.count({ where: { deletedAt: null } }),
    prisma.user.count({ where: { deletedAt: null, createdAt: { gte: w.start } } }),
    prisma.organization.count({ where: companyViewWhere("trials") }),
    prisma.organization.findMany({
      where: { createdAt: { gte: w.start } },
      select: { id: true, createdAt: true },
      orderBy: { createdAt: "asc" },
      take: WINDOW_COMPANY_CAP,
    }),
    prisma.organization.findMany({
      where: { createdAt: { gte: cohortStart } },
      select: { id: true, createdAt: true, status: true, subscription: { select: { status: true } } },
      take: WINDOW_COMPANY_CAP,
    }),
    prisma.subscription.findMany({
      where: { canceledAt: { gte: w.start, lte: now } },
      orderBy: { canceledAt: "desc" },
      take: 10,
      select: { canceledAt: true, plan: true, organization: { select: { id: true, name: true } } },
    }),
    prisma.user.groupBy({
      by: ["organizationId"],
      where: { deletedAt: null },
      _count: { _all: true },
      orderBy: { _count: { organizationId: "desc" } },
      take: 12,
    }),
    prisma.activityLog.groupBy({
      by: ["organizationId"],
      where: { createdAt: { gte: w.start } },
      _count: { _all: true },
      orderBy: { _count: { organizationId: "desc" } },
      take: 12,
    }),
    prisma.organization.groupBy({ by: ["plan"], where: { status: { not: "CANCELLED" } }, _count: { _all: true } }),
    readMonthlyRevenue(),
    readChargedSeries(w),
  ]);

  const windowIds = windowCompanies.map((c) => c.id);
  const cohortIds = cohortCompanies.map((c) => c.id);

  const [finishedSetup, createdSomething, payingInWindow, activeRecently, payingCohort] = await Promise.all([
    windowIds.length
      ? prisma.organization.count({ where: { id: { in: windowIds }, settings: { path: ["setupCompleted"], equals: true } } })
      : 0,
    windowIds.length
      ? prisma.organization.count({
          where: {
            id: { in: windowIds },
            OR: [{ sops: { some: {} } }, { kras: { some: {} } }, { tasks: { some: {} } }, { items: { some: {} } }],
          },
        })
      : 0,
    windowIds.length ? prisma.organization.count({ where: { AND: [{ id: { in: windowIds } }, companyViewWhere("paying")] } }) : 0,
    cohortIds.length
      ? prisma.activityLog.groupBy({ by: ["organizationId"], where: { organizationId: { in: cohortIds }, createdAt: { gte: ago30 } } })
      : [],
    cohortIds.length
      ? prisma.organization.findMany({ where: { AND: [{ id: { in: cohortIds } }, companyViewWhere("paying")] }, select: { id: true } })
      : [],
  ]);

  const cohorts = buildCohorts(
    cohortCompanies,
    {
      active: new Set(activeRecently.map((r) => r.organizationId)),
      paying: new Set(payingCohort.map((r) => r.id)),
      cancelled: new Set(cohortCompanies.filter((c) => c.status === "CANCELLED" || c.subscription?.status === "CANCELED").map((c) => c.id)),
    },
    w,
  );

  const [biggest, busiest] = await Promise.all([
    ranked(peopleGroups.map((g) => ({ organizationId: g.organizationId, n: g._count._all }))),
    ranked(actionGroups.map((g) => ({ organizationId: g.organizationId, n: g._count._all }))),
  ]);

  // One line per currency: every currency with an active subscription or a
  // paid invoice in the range. Nothing is added across currencies.
  let revenue:
    | { source: "unavailable" }
    | { source: "error" }
    | {
        source: "stripe";
        lines: { currency: string; monthly: number; arr: number; arpu: number | null; subscriptions: number; series: number[] | null }[];
        seriesFailed: boolean;
        uncounted: number;
        truncated: boolean;
        asOf: string;
      };
  if (monthly.source !== "stripe") {
    revenue = { source: monthly.source };
  } else {
    const series = charged.source === "stripe" ? charged.series : new Map<string, number[]>();
    const currencies = new Set<string>([...monthly.lines.map((l) => l.currency), ...series.keys()]);
    const lines = [...currencies].map((currency) => {
      const line = monthly.lines.find((l) => l.currency === currency) ?? { currency, monthly: 0, subscriptions: 0 };
      const d = derivedRevenue(line);
      return {
        currency,
        monthly: d.monthly,
        arr: d.arr,
        arpu: d.arpu,
        subscriptions: line.subscriptions,
        series: charged.source === "stripe" ? series.get(currency) ?? w.buckets.map(() => 0) : null,
      };
    });
    lines.sort((a, b) => b.subscriptions - a.subscriptions || a.currency.localeCompare(b.currency));
    revenue = {
      source: "stripe",
      lines,
      seriesFailed: charged.source !== "stripe",
      uncounted: monthly.uncounted,
      truncated: monthly.truncated || (charged.source === "stripe" && charged.truncated),
      asOf: monthly.asOf,
    };
  }

  return {
    range,
    rangeLabel: RANGE_LABEL[range],
    window: {
      start: w.start.toISOString(),
      end: w.end.toISOString(),
      windowDays: w.windowDays,
      granularity: w.granularity,
      buckets: w.buckets.map((b) => ({ start: b.start.toISOString(), end: b.end.toISOString() })),
    },
    revenue,
    growth: {
      newCompanies: windowCompanies.length,
      newPeople,
      onTrial,
      byBucket: countByBucket(
        windowCompanies.map((c) => c.createdAt),
        w,
      ),
      avgPeoplePerCompany: averageOf(totalPeople, totalCompanies),
      totalPeople,
      totalCompanies,
    },
    funnel: {
      signedUp: windowCompanies.length,
      finishedSetup,
      createdSomething,
      paying: payingInWindow,
      windowDays: w.windowDays,
    },
    retention: { cohorts },
    cancellations: cancellationRows.map((r) => ({
      id: r.organization.id,
      name: r.organization.name,
      plan: r.plan,
      canceledAt: r.canceledAt?.toISOString() ?? null,
    })),
    biggest,
    busiest,
    plans: ["STARTER", "GROWTH", "SCALE", "ENTERPRISE"].map((plan) => ({
      plan,
      count: planGroups.find((g) => g.plan === plan)?._count._all ?? 0,
    })),
    generatedAt: now.toISOString(),
  };
}

type Analytics = Awaited<ReturnType<typeof computeAnalytics>>;

function analyticsCsv(a: Analytics): string {
  const rows: unknown[][] = [["Section", "Item", "Value", "Currency"]];
  rows.push(["Range", a.rangeLabel, `${a.window.start.slice(0, 10)} to ${a.window.end.slice(0, 10)}`, ""]);
  if (a.revenue.source === "stripe") {
    for (const l of a.revenue.lines) {
      rows.push(["Revenue", "Monthly revenue", fromMinor(l.monthly, l.currency), l.currency]);
      rows.push(["Revenue", "Annual run rate (monthly x 12)", fromMinor(l.arr, l.currency), l.currency]);
      if (l.arpu !== null) rows.push(["Revenue", "Average per paying company", fromMinor(l.arpu, l.currency), l.currency]);
      rows.push(["Revenue", "Stripe subscriptions", l.subscriptions, l.currency]);
      l.series?.forEach((v, i) => rows.push(["Revenue", `Charged from ${a.window.buckets[i].start.slice(0, 10)}`, fromMinor(v, l.currency), l.currency]));
    }
  } else {
    rows.push(["Revenue", a.revenue.source === "unavailable" ? "Billing is not connected" : "Stripe did not answer", "", ""]);
  }
  rows.push(["Growth", "New companies", a.growth.newCompanies, ""]);
  rows.push(["Growth", "New people", a.growth.newPeople, ""]);
  rows.push(["Growth", "On trial", a.growth.onTrial, ""]);
  rows.push(["Growth", "Average people per company", a.growth.avgPeoplePerCompany, ""]);
  a.growth.byBucket.forEach((n, i) => rows.push(["Growth", `New companies from ${a.window.buckets[i].start.slice(0, 10)}`, n, ""]));
  rows.push(["Signup funnel", "Signed up", a.funnel.signedUp, ""]);
  rows.push(["Signup funnel", "Finished setup", a.funnel.finishedSetup, ""]);
  rows.push(["Signup funnel", "Created something", a.funnel.createdSomething, ""]);
  rows.push(["Signup funnel", "Paying", a.funnel.paying, ""]);
  for (const c of a.retention.cohorts) {
    rows.push(["Retention", `${monthKeyLabel(c.month, "en-GB")} size`, c.size, ""]);
    rows.push(["Retention", `${monthKeyLabel(c.month, "en-GB")} still active`, c.stillActive, ""]);
    rows.push(["Retention", `${monthKeyLabel(c.month, "en-GB")} paying`, c.paying, ""]);
    rows.push(["Retention", `${monthKeyLabel(c.month, "en-GB")} cancelled`, c.cancelled, ""]);
  }
  for (const c of a.cancellations) rows.push(["Cancellations", c.name, `${planLabel(c.plan)} ${c.canceledAt?.slice(0, 10) ?? ""}`.trim(), ""]);
  for (const c of a.biggest) rows.push(["Biggest workspaces (people)", c.name, c.value, ""]);
  for (const c of a.busiest) rows.push(["Busiest workspaces (actions)", c.name, c.value, ""]);
  for (const p of a.plans) rows.push(["Plans (companies)", planLabel(p.plan), p.count, ""]);
  return toCsv(rows);
}

export async function GET(req: NextRequest) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;
  const denied = await requirePlatformAdminApi(session);
  if (denied) return denied;

  const sp = req.nextUrl.searchParams;
  const range = parseRange(sp.get("range"));
  const data = await computeAnalytics(range, new Date());

  if (sp.get("format") === "csv") {
    return new NextResponse(analyticsCsv(data), {
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": `attachment; filename="analytics-${range}-${data.generatedAt.slice(0, 10)}.csv"`,
        "cache-control": "no-store",
      },
    });
  }
  return jsonSuccess(data, 200, { "cache-control": "no-store" });
}
