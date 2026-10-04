"use client";

// Analytics (spec-admin-backoffice 2.5): whether the business is growing, in
// numbers that are true. One read, GET /api/admin/analytics?range=, with the
// range in the URL (the back arrow undoes a change, a link carries it).
//
// Revenue is what Stripe charges, one line per currency, never converted,
// and never a price multiplied by a count of companies (the old "MRR" and
// "Revenue by Plan" did that; see docs/plans/ui-refresh/staff-console-numbers.md).
// Growth bars reuse the dashboards' ChartBody (one series, the one blue); the
// revenue line follows the same chart rules.

import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Download, Info, RefreshCw } from "lucide-react";
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { OsPageHeader } from "@/components/layout/os/page-header";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { Chip } from "@/components/ui/chip";
import { ChartBody } from "@/components/dashboards/widgets/chart-widget";
import type { WidgetResult } from "@/lib/dashboards/widget-data";
import { apiFetch } from "@/lib/api-fetch";
import { formatDate, formatDateTitle } from "@/lib/format/date";
import {
  ANALYTICS_RANGES,
  RANGE_LABEL,
  barPct,
  bucketLabel,
  conversionPct,
  formatMoney,
  fromMinor,
  monthKeyLabel,
  parseRange,
  type AnalyticsRange,
  type CohortRow,
  type RankedCompany,
} from "@/lib/admin/numbers";
import { planLabel } from "@/lib/admin/console-labels";
import { useConsole } from "../../console-context";
import { AboutDialog, downloadHref, rememberCompanyNames, useStaleRefetch } from "../../console-ui";
import { Bar4, CardRetry, NumbersCard, NumbersMeta, QuietBlock, SkeletonBars, connectLink } from "../../numbers-ui";

interface RevenueLineOut {
  currency: string;
  monthly: number;
  arr: number;
  arpu: number | null;
  subscriptions: number;
  companies: number;
  series: number[] | null;
}

type Revenue =
  | { source: "unavailable" }
  | { source: "error" }
  | { source: "stripe"; lines: RevenueLineOut[]; seriesFailed: boolean; uncounted: number; truncated: boolean; asOf: string };

interface Analytics {
  range: AnalyticsRange;
  rangeLabel: string;
  window: { start: string; end: string; windowDays: number; granularity: "day" | "month"; buckets: { start: string; end: string }[] };
  revenue: Revenue;
  growth: { newCompanies: number; newPeople: number; onTrial: number; byBucket: number[]; avgPeoplePerCompany: number; totalPeople: number; totalCompanies: number };
  funnel: { signedUp: number; finishedSetup: number; createdSomething: number; paying: number; windowDays: number };
  retention: { cohorts: CohortRow[]; from: string; partialFirst: boolean };
  cancellations: {
    id: string;
    name: string;
    /** Null only for a company deleted for good before its plan was recorded (`gone`). */
    plan: string | null;
    canceledAt: string | null;
    what: "subscription" | "workspace" | "deleted";
    restored: boolean;
    /** Deleted for good by the hard-delete cron: there is no company page to open. */
    gone?: boolean;
  }[];
  biggest: RankedCompany[];
  busiest: RankedCompany[];
  plans: { plan: string; count: number }[];
}

const nf = new Intl.NumberFormat();
const n = (v: number) => nf.format(v);

export default function AnalyticsPage() {
  // useSearchParams needs a Suspense boundary on a client page.
  return (
    <Suspense fallback={null}>
      <AnalyticsInner />
    </Suspense>
  );
}

function AnalyticsInner() {
  const { datePrefs, runbookUrl } = useConsole();
  const router = useRouter();
  const pathname = usePathname() || "/admin/analytics";
  const sp = useSearchParams();
  const range = parseRange(sp.get("range"));
  const [data, setData] = useState<Analytics | null>(null);
  // The range whose last load failed, so a new range starts on its skeleton
  // rather than on the old range's failure.
  const [failedRange, setFailedRange] = useState<AnalyticsRange | null>(null);
  const [loadedAt, setLoadedAt] = useState<number | null>(null);
  const [aboutOpen, setAboutOpen] = useState(false);

  const load = useCallback(async (r: AnalyticsRange) => {
    const res = await apiFetch<Analytics>(`/api/admin/analytics?range=${r}`);
    if (res.ok) {
      setData(res.data);
      setFailedRange(null);
      setLoadedAt(Date.now());
      rememberCompanyNames([...res.data.biggest, ...res.data.busiest, ...res.data.cancellations]);
    } else if (res.status !== 401) {
      setFailedRange(r);
    }
  }, []);
  useEffect(() => {
    const t = setTimeout(() => void load(range), 0);
    return () => clearTimeout(t);
  }, [load, range]);
  useStaleRefetch(() => void load(range), loadedAt);

  const setRange = (r: AnalyticsRange) => {
    if (r === range) return;
    const q = new URLSearchParams(sp.toString());
    q.set("range", r);
    router.push(`${pathname}?${q.toString()}`, { scroll: false });
  };

  const retry = () => void load(range);
  // A range change keeps the last numbers until the new ones arrive, but a
  // card never presents another range's numbers as this one's.
  const current = data && data.range === range ? data : null;
  const failed = failedRange === range;
  const loading = !current && !failed;
  const broken = !current && failed;
  const lang = datePrefs.language;
  // A brand-new install: every card shows its own quiet block (spec 2.5 empty).
  const nothing = !!current && current.growth.totalCompanies === 0;

  return (
    <>
      <OsPageHeader
        title="Analytics"
        // The title row describes the numbers on screen, never another
        // range's: loadedAt is the time of `data`, so it is shown only while
        // `data` is this range's. After a failed range switch no card has
        // numbers (each says "Could not load this" with Retry), so the header
        // shows no time rather than the old range's "Updated just now". A
        // failed background refresh of the range on screen still reads red
        // "Updated X, Retry" over the older numbers.
        actions={<NumbersMeta at={current ? loadedAt : null} failed={!!current && failed} prefs={datePrefs} onRetry={retry} />}
        toolbar={{
          left: (
            <SegmentedControl<AnalyticsRange>
              label="Range"
              value={range}
              options={ANALYTICS_RANGES.map((r) => ({ value: r, label: RANGE_LABEL[r] }))}
              onChange={setRange}
            />
          ),
          menu: [
            { label: "Refresh", icon: RefreshCw, onClick: retry },
            { label: "Export CSV", icon: Download, onClick: () => downloadHref(`/api/admin/analytics?range=${range}&format=csv`) },
            { label: "About this page", icon: Info, onClick: () => setAboutOpen(true) },
          ],
        }}
      />
      <div className="os-chrome flex min-h-0 flex-1 flex-col gap-4 px-6 pb-6 pt-2">
        <RevenueCard data={current} loading={loading} broken={broken} nothing={nothing} onRetry={retry} language={lang} runbookUrl={runbookUrl} datePrefs={datePrefs} />
        <GrowthCard data={current} loading={loading} broken={broken} nothing={nothing} onRetry={retry} language={lang} />
        <FunnelCard data={current} range={range} loading={loading} broken={broken} nothing={nothing} onRetry={retry} />
        <RetentionCard data={current} loading={loading} broken={broken} nothing={nothing} onRetry={retry} language={lang} datePrefs={datePrefs} />
        <CancellationsCard data={current} loading={loading} broken={broken} nothing={nothing} onRetry={retry} datePrefs={datePrefs} />
        <div className="grid grid-cols-1 gap-4 min-[1280px]:grid-cols-2">
          <RankCard
            title="Biggest workspaces"
            rows={current?.biggest ?? null}
            loading={loading}
            broken={broken}
            nothing={nothing}
            onRetry={retry}
            unit={(v) => `${n(v)} ${v === 1 ? "person" : "people"}`}
            note="Top five by people"
          />
          <RankCard
            title="Busiest workspaces"
            rows={current?.busiest ?? null}
            loading={loading}
            broken={broken}
            nothing={nothing}
            onRetry={retry}
            unit={(v) => `${n(v)} ${v === 1 ? "action" : "actions"}`}
            note={`Actions by people in each workspace in the last ${RANGE_LABEL[range]}, not counting signing in or out`}
          />
        </div>
        <PlansCard data={current} loading={loading} broken={broken} nothing={nothing} onRetry={retry} />
      </div>

      <AboutDialog open={aboutOpen} onClose={() => setAboutOpen(false)} title="Analytics">
        Whether the business is growing. Revenue is what Stripe charged; everything else is counted from companies, people
        and recorded activity in the range you pick. Monthly revenue is every WorkwrK Stripe subscription that is active or
        past due, at Stripe&apos;s own price after its discounts, one line per currency and never converted. The chart is
        what paid invoices took in each period, before refunds. Stripe figures are refreshed at most once an hour.
      </AboutDialog>
    </>
  );
}

interface CardProps {
  data: Analytics | null;
  loading: boolean;
  broken: boolean;
  /** No companies at all: the card shows its own quiet block. */
  nothing: boolean;
  onRetry: () => void;
}

const NOTHING = "Nothing to measure yet";

/**
 * A card's body by state. Loading: a chart card draws its plot frame with a
 * skeleton plot area (`plot` is the plot's height), a list card skeleton
 * rows, each at the card's own height. Empty install: the quiet block of the
 * card's family (four-dot 2x2 for charts, a row for lists).
 */
function CardState({
  loading,
  broken,
  nothing,
  onRetry,
  height,
  plot,
  children,
}: {
  loading: boolean;
  broken: boolean;
  nothing: boolean;
  onRetry: () => void;
  height: number;
  plot?: number;
  children: () => React.ReactNode;
}) {
  if (loading) {
    if (plot) {
      return (
        <div className="flex flex-col gap-3" style={{ minHeight: height }} aria-busy="true">
          <SkeletonBars rows={1} height={14} />
          <div className="relative w-full border-b border-l border-line" style={{ height: plot }} aria-hidden>
            {[0.25, 0.5, 0.75].map((f) => (
              <div key={f} className="absolute inset-x-0 border-t border-[var(--os-line-soft)]" style={{ top: `${f * 100}%` }} />
            ))}
            <div className="absolute inset-2 animate-pulse rounded bg-[var(--os-skeleton)] opacity-40" style={{ animationDuration: "1.6s" }} />
          </div>
          <SkeletonBars rows={2} height={12} />
        </div>
      );
    }
    return (
      <div style={{ minHeight: height }} aria-busy="true">
        <SkeletonBars rows={3} height={14} gap={12} />
      </div>
    );
  }
  if (broken) return <CardRetry onRetry={onRetry} />;
  if (nothing) return <QuietBlock sentence={NOTHING} arrangement={plot ? "grid" : "row"} height={plot ? Math.min(height, 200) : 96} />;
  return <>{children()}</>;
}

/* ───────────────────────── 1. Revenue ───────────────────────── */

function RevenueCard({
  data,
  loading,
  broken,
  nothing,
  onRetry,
  language,
  runbookUrl,
  datePrefs,
}: CardProps & { language?: string | null; runbookUrl: string | null; datePrefs: ReturnType<typeof useConsole>["datePrefs"] }) {
  const rev = data?.revenue;
  return (
    <NumbersCard
      title="Revenue"
      meta={rev?.source === "stripe" ? <span title={formatDateTitle(rev.asOf, datePrefs)}>Stripe figures from {formatDate(rev.asOf, datePrefs, "time")}</span> : null}
    >
      <CardState loading={loading} broken={broken} nothing={nothing} onRetry={onRetry} height={300} plot={224}>
        {() => {
          if (!data || !rev) return null;
          if (rev.source === "unavailable") {
            return <QuietBlock sentence="Billing is not connected yet" arrangement="grid" link={connectLink(runbookUrl)} height={224} />;
          }
          if (rev.source === "error") return <CardRetry onRetry={onRetry} />;
          if (rev.lines.length === 0 && rev.uncounted === 0) {
            return <QuietBlock sentence="No active Stripe subscriptions and nothing charged in this range" arrangement="grid" height={160} />;
          }
          return (
            <div className="flex flex-col gap-5">
              {rev.lines.map((line, i) => (
                <div key={line.currency} className={i > 0 ? "border-t border-line pt-5" : undefined}>
                  <RevenueLineBlock line={line} data={data} seriesFailed={rev.seriesFailed} onRetry={onRetry} language={language} />
                </div>
              ))}
              {rev.uncounted > 0 ? (
                <p className="m-0 text-sm text-ink-2">
                  {n(rev.uncounted)} {rev.uncounted === 1 ? "subscription has" : "subscriptions have"} a tiered or metered price, or a
                  discount Stripe gave no exact amount for, and {rev.uncounted === 1 ? "is" : "are"} not counted.
                </p>
              ) : null}
              {rev.truncated ? <p className="m-0 text-sm text-ink-2">Stripe stopped answering before every record was read, so the real figure is higher.</p> : null}
              <p className="m-0 text-sm text-ink-2">
                From WorkwrK&apos;s Stripe subscriptions only, active or past due, after their discounts; the chart is before refunds.
                Lifetime deals and companies on manual invoices are not counted.
              </p>
            </div>
          );
        }}
      </CardState>
    </NumbersCard>
  );
}

function RevenueLineBlock({
  line,
  data,
  seriesFailed,
  onRetry,
  language,
}: {
  line: RevenueLineOut;
  data: Analytics;
  seriesFailed: boolean;
  onRetry: () => void;
  language?: string | null;
}) {
  const per = data.window.granularity === "month" ? "per month" : "per 5 days";
  const points = useMemo(
    () =>
      (line.series ?? []).map((v, i) => ({
        label: bucketLabel(data.window.buckets[i].start, data.window.granularity, language),
        value: fromMinor(v, line.currency),
        minor: v,
        last: i === data.window.buckets.length - 1,
      })),
    [line.series, line.currency, data.window, language],
  );
  const compact = useMemo(
    () => new Intl.NumberFormat(language || undefined, { notation: "compact", maximumFractionDigits: 1 }),
    [language],
  );
  return (
    <div className="flex flex-col gap-3">
      <p className="m-0 text-sm font-medium text-ink-2">
        What Stripe was paid, {per} ({line.currency})
      </p>
      {seriesFailed || !line.series ? (
        <div style={{ minHeight: 224 }} className="flex items-center">
          <CardRetry onRetry={onRetry} />
        </div>
      ) : (
        <div style={{ height: 224 }} className="w-full min-w-0" role="img" aria-label={`What Stripe was paid ${per} in ${line.currency}`}>
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={points} margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
              <CartesianGrid vertical={false} stroke="var(--os-line-soft)" />
              <XAxis dataKey="label" tickLine={false} axisLine={{ stroke: "var(--os-line-strong)" }} tick={{ fontSize: 12, fill: "var(--os-ink-2)" }} interval="preserveStartEnd" />
              <YAxis
                tickLine={false}
                axisLine={false}
                width={48}
                tick={{ fontSize: 12, fill: "var(--os-ink-2)" }}
                tickFormatter={(v: number) => compact.format(v)}
                allowDecimals={false}
              />
              <Tooltip
                isAnimationActive={false}
                cursor={{ stroke: "var(--os-line-strong)", strokeWidth: 1 }}
                content={(p) => {
                  const pt = p.payload?.[0]?.payload as (typeof points)[number] | undefined;
                  if (!p.active || !pt) return null;
                  return (
                    <div className="rounded-md border border-line bg-raised px-2.5 py-1.5 text-xs shadow-[var(--os-shadow-pop)]">
                      <div className="font-semibold tabular-nums text-ink">{formatMoney(pt.minor, line.currency, language)}</div>
                      <div className="mt-0.5 text-ink-2">
                        {pt.label}
                        {pt.last ? ", so far" : ""}
                      </div>
                    </div>
                  );
                }}
              />
              <Line
                type="monotone"
                dataKey="value"
                stroke="var(--os-brand)"
                strokeWidth={2}
                dot={false}
                activeDot={{ r: 4, fill: "var(--os-brand)", stroke: "var(--os-surface)", strokeWidth: 2 }}
                isAnimationActive={false}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}
      <div className="flex flex-col gap-0.5 text-sm text-ink-2">
        <span>
          Monthly revenue <span className="font-medium tabular-nums text-ink">{formatMoney(line.monthly, line.currency, language)}</span>
          {" "}from {n(line.subscriptions)} Stripe {line.subscriptions === 1 ? "subscription" : "subscriptions"}
        </span>
        <span>
          Annual run rate <span className="font-medium tabular-nums text-ink">{formatMoney(line.arr, line.currency, language)}</span> (monthly × 12)
        </span>
        {line.arpu !== null ? (
          <span>
            Average per paying company <span className="font-medium tabular-nums text-ink">{formatMoney(line.arpu, line.currency, language)}</span>
          </span>
        ) : null}
      </div>
    </div>
  );
}

/* ───────────────────────── 2. Growth ───────────────────────── */

function GrowthCard({ data, loading, broken, nothing, onRetry, language }: CardProps & { language?: string | null }) {
  return (
    <NumbersCard title="Growth">
      <CardState loading={loading} broken={broken} nothing={nothing} onRetry={onRetry} height={240} plot={168}>
        {() => {
          if (!data) return null;
          const g = data.growth;
          const result: Extract<WidgetResult, { kind: "chart" }> = {
            kind: "chart",
            groupBy: "status",
            display: "bar",
            buckets: g.byBucket.map((count, i) => ({
              key: data.window.buckets[i].start,
              label: bucketLabel(data.window.buckets[i].start, data.window.granularity, language),
              // One series, the one blue (spec 2.5 chart rules).
              color: "var(--os-brand)",
              count,
            })),
          };
          const any = g.byBucket.some((v) => v > 0);
          return (
            <div className="flex flex-col gap-3">
              <p className="m-0 flex flex-wrap gap-x-6 gap-y-1 text-row text-ink-2">
                <span>
                  New companies <span className="font-semibold tabular-nums text-ink">{n(g.newCompanies)}</span>
                </span>
                <span>
                  New people <span className="font-semibold tabular-nums text-ink">{n(g.newPeople)}</span>
                </span>
              </p>
              <div style={{ height: 168 }} className="w-full min-w-0">
                {any ? (
                  <ChartBody result={result} />
                ) : (
                  <QuietBlock sentence="No new companies in this range" arrangement="grid" height={168} />
                )}
              </div>
              <div className="flex flex-col gap-0.5 text-sm text-ink-2">
                <span>New companies {data.window.granularity === "month" ? "per month" : "per 5 days"}; the last bar is so far.</span>
                <span>
                  {n(g.onTrial)} {g.onTrial === 1 ? "company is" : "companies are"} on trial.
                </span>
                <span>
                  <span className="font-semibold text-ink">Average people per company {g.avgPeoplePerCompany}</span>, {n(g.totalPeople)}{" "}
                  {g.totalPeople === 1 ? "person" : "people"} across {n(g.totalCompanies)} {g.totalCompanies === 1 ? "company" : "companies"}.
                </span>
              </div>
            </div>
          );
        }}
      </CardState>
    </NumbersCard>
  );
}

/* ───────────────────────── 3. Signup funnel ───────────────────────── */

function FunnelCard({ data, range, loading, broken, nothing, onRetry }: CardProps & { range: AnalyticsRange }) {
  // The range the person picked, in the same words as the Range control.
  return (
    <NumbersCard title={`Signup funnel · last ${RANGE_LABEL[range]}`}>
      <CardState loading={loading} broken={broken} nothing={nothing} onRetry={onRetry} height={180}>
        {() => {
          if (!data) return null;
          const f = data.funnel;
          const steps = [
            { label: "Signed up", hint: "A company was created", count: f.signedUp },
            { label: "Finished setup", hint: "They completed the setup wizard", count: f.finishedSetup },
            { label: "Created something", hint: "Of those, at least one SOP, KRA or task", count: f.createdSomething },
            { label: "Paying", hint: "Of those, an active or past-due subscription", count: f.paying },
          ];
          if (f.signedUp === 0) return <p className="m-0 text-row text-ink-2">No companies signed up in this range.</p>;
          return (
            <ul className="m-0 flex list-none flex-col gap-2 p-0">
              {steps.map((s, i) => {
                const conv = i === 0 ? null : conversionPct(s.count, steps[i - 1].count);
                return (
                  <li key={s.label} className="flex flex-col gap-1">
                    <div className="flex h-7 min-w-0 items-center gap-3">
                      <span className="shrink-0 text-row font-medium text-ink">{s.label}</span>
                      <span className="min-w-0 flex-1 truncate text-sm text-ink-2">{s.hint}</span>
                      {conv !== null ? <span className="shrink-0 text-sm tabular-nums text-ink-2">{conv}%</span> : null}
                      <span className="w-12 shrink-0 text-right text-row font-medium tabular-nums text-ink">{n(s.count)}</span>
                    </div>
                    <Bar4 pct={barPct(s.count, f.signedUp)} />
                  </li>
                );
              })}
            </ul>
          );
        }}
      </CardState>
    </NumbersCard>
  );
}

/* ───────────────────────── 4. Retention ───────────────────────── */

function RetentionCard({
  data,
  loading,
  broken,
  nothing,
  onRetry,
  language,
  datePrefs,
}: CardProps & { language?: string | null; datePrefs: ReturnType<typeof useConsole>["datePrefs"] }) {
  return (
    <NumbersCard title="Retention">
      <CardState loading={loading} broken={broken} nothing={nothing} onRetry={onRetry} height={200}>
        {() => {
          if (!data) return null;
          // A month nobody signed up in is not a cohort: twelve rows of zeros
          // would bury the ones that exist.
          const rows = data.retention.cohorts.filter((c) => c.size > 0);
          if (rows.length === 0) return <p className="m-0 text-row text-ink-2">No companies signed up in this range.</p>;
          return (
            <div className="flex flex-col gap-3">
              <div className="overflow-x-auto">
                <table className="w-full min-w-[560px] border-collapse text-row">
                  <thead>
                    <tr className="text-left text-sm text-ink-2">
                      <th className="h-9 pe-3 font-medium">Cohort</th>
                      <th className="h-9 pe-3 text-right font-medium">Size</th>
                      <th className="h-9 pe-3 text-right font-medium">Still active</th>
                      <th className="h-9 pe-3 text-right font-medium">Paying</th>
                      <th className="h-9 pe-3 text-right font-medium">Cancelled</th>
                      <th className="h-9 w-[200px] font-medium">Retention</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((c) => (
                      <tr key={c.month} className="border-t border-line">
                        <td className="h-9 pe-3 text-ink">{monthKeyLabel(c.month, language)}</td>
                        <td className="h-9 pe-3 text-right tabular-nums">{n(c.size)}</td>
                        <td className="h-9 pe-3 text-right tabular-nums">{n(c.stillActive)}</td>
                        <td className="h-9 pe-3 text-right tabular-nums">{n(c.paying)}</td>
                        <td className="h-9 pe-3 text-right tabular-nums">{n(c.cancelled)}</td>
                        <td className="h-9">
                          <div className="flex items-center gap-2">
                            <div className="w-24"><Bar4 pct={c.retention ?? 0} /></div>
                            <span className="w-10 text-sm tabular-nums text-ink-2">{c.retention ?? 0}%</span>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="flex flex-col gap-0.5 text-sm text-ink-2">
                <span>Still active means somebody in that workspace did something in the last 30 days. Signing in or out does not count.</span>
                <span>Paying means an active or past-due subscription today.</span>
                {data.retention.partialFirst && rows[rows.length - 1]?.month === data.retention.from.slice(0, 7) ? (
                  <span>
                    {monthKeyLabel(rows[rows.length - 1].month, language)} counts only the companies that signed up from{" "}
                    {formatDate(data.retention.from, datePrefs, "date")}.
                  </span>
                ) : null}
              </div>
            </div>
          );
        }}
      </CardState>
    </NumbersCard>
  );
}

/* ───────────────────────── 5. Cancellations ───────────────────────── */

function PlanChip({ plan }: { plan: string }) {
  return <Chip as="span" className="h-6 border-line bg-raised px-2 text-xs text-ink-2">{planLabel(plan)}</Chip>;
}

function CancellationsCard({ data, loading, broken, nothing, onRetry, datePrefs }: CardProps & { datePrefs: ReturnType<typeof useConsole>["datePrefs"] }) {
  return (
    <NumbersCard title="Cancellations">
      <CardState loading={loading} broken={broken} nothing={nothing} onRetry={onRetry} height={120}>
        {() => {
          if (!data) return null;
          if (data.cancellations.length === 0) return <p className="m-0 text-row text-ink-2">No cancellations in this range.</p>;
          return (
            <ul className="m-0 -mx-2 flex list-none flex-col p-0">
              {data.cancellations.map((c) => (
                // Two lines on a phone (the company, then what happened and
                // when), one h-9 line from sm up. The name keeps a minimum
                // width and the status truncates before the date, so neither
                // the name nor the date can be squeezed out of the card.
                <li
                  key={`${c.id}-${c.what}-${c.canceledAt ?? ""}`}
                  className="flex min-w-0 flex-col gap-0.5 px-2 py-1.5 sm:h-9 sm:flex-row sm:items-center sm:gap-3 sm:py-0"
                >
                  <div className="flex min-w-0 items-center gap-3 sm:flex-1">
                    {c.gone ? (
                      <span className="min-w-[8ch] truncate text-row text-ink" title={c.name}>{c.name}</span>
                    ) : (
                      <Link href={`/admin/companies/${c.id}`} className="min-w-[8ch] truncate text-row text-ink hover:underline" title={c.name}>
                        {c.name}
                      </Link>
                    )}
                    {c.plan ? <PlanChip plan={c.plan} /> : null}
                  </div>
                  <div className="flex min-w-0 items-center gap-3 text-sm text-ink-2">
                    <span className="min-w-0 truncate">
                      {c.what === "workspace" ? "Workspace cancelled" : c.what === "deleted" ? "Deleted by its Owner" : "Subscription cancelled"}
                      {c.restored ? ", restored since" : ""}
                      {c.gone ? ", deleted for good" : ""}
                    </span>
                    <span className="shrink-0 tabular-nums" title={c.canceledAt ? formatDateTitle(c.canceledAt, datePrefs) : undefined}>
                      {c.canceledAt ? formatDate(c.canceledAt, datePrefs, "date") : "Unknown"}
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          );
        }}
      </CardState>
    </NumbersCard>
  );
}

/* ───────────────────────── 6. Biggest and busiest ───────────────────────── */

function RankCard({
  title,
  rows,
  loading,
  broken,
  nothing,
  onRetry,
  unit,
  note,
}: {
  title: string;
  rows: RankedCompany[] | null;
  loading: boolean;
  broken: boolean;
  nothing: boolean;
  onRetry: () => void;
  unit: (v: number) => string;
  note: string;
}) {
  return (
    <NumbersCard title={title}>
      <CardState loading={loading} broken={broken} nothing={nothing} onRetry={onRetry} height={200}>
        {() => {
          if (!rows) return null;
          const max = rows[0]?.value ?? 0;
          return (
            <div className="flex flex-col gap-3">
              {rows.length === 0 ? (
                <p className="m-0 text-row text-ink-2">Nothing recorded in this range.</p>
              ) : (
                <ol className="m-0 flex list-none flex-col gap-2 p-0">
                  {rows.map((r, i) => (
                    <li key={r.id} className="flex flex-col gap-1">
                      <div className="flex h-7 min-w-0 items-center gap-3">
                        <span className="w-4 shrink-0 text-sm font-medium tabular-nums text-ink-2">{i + 1}</span>
                        <Link href={`/admin/companies/${r.id}`} className="min-w-0 flex-1 truncate text-row text-ink hover:underline">{r.name}</Link>
                        <span className="shrink-0 text-row tabular-nums text-ink">{unit(r.value)}</span>
                      </div>
                      <div className="ps-7"><Bar4 pct={barPct(r.value, max)} /></div>
                    </li>
                  ))}
                </ol>
              )}
              <p className="m-0 text-sm text-ink-2">{note}</p>
            </div>
          );
        }}
      </CardState>
    </NumbersCard>
  );
}

/* ───────────────────────── 7. Plans ───────────────────────── */

function PlansCard({ data, loading, broken, nothing, onRetry }: CardProps) {
  return (
    <NumbersCard title="Plans">
      <CardState loading={loading} broken={broken} nothing={nothing} onRetry={onRetry} height={160}>
        {() => {
          if (!data) return null;
          const max = Math.max(0, ...data.plans.map((p) => p.count));
          return (
            <div className="flex flex-col gap-3">
              <ul className="m-0 flex list-none flex-col gap-2 p-0">
                {data.plans.map((p) => (
                  <li key={p.plan} className="flex flex-col gap-1">
                    <div className="flex h-7 items-center gap-3">
                      <PlanChip plan={p.plan} />
                      <span className="flex-1" />
                      <span className="text-row tabular-nums text-ink">
                        {n(p.count)} {p.count === 1 ? "company" : "companies"}
                      </span>
                    </div>
                    <Bar4 pct={barPct(p.count, max)} />
                  </li>
                ))}
              </ul>
              <p className="m-0 text-sm text-ink-2">Every company that is not cancelled, today. There is no revenue per plan: Stripe does not know our plan names.</p>
            </div>
          );
        }}
      </CardState>
    </NumbersCard>
  );
}
