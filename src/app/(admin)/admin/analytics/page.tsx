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
  retention: { cohorts: CohortRow[] };
  cancellations: { id: string; name: string; plan: string; canceledAt: string | null }[];
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
  const [failed, setFailed] = useState(false);
  const [loadedAt, setLoadedAt] = useState<number | null>(null);
  const [aboutOpen, setAboutOpen] = useState(false);

  const load = useCallback(async (r: AnalyticsRange) => {
    const res = await apiFetch<Analytics>(`/api/admin/analytics?range=${r}`);
    if (res.ok) {
      setData(res.data);
      setFailed(false);
      setLoadedAt(Date.now());
      rememberCompanyNames([...res.data.biggest, ...res.data.busiest, ...res.data.cancellations]);
    } else if (res.status !== 401) {
      setFailed(true);
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
  const loading = !current && !failed;
  const broken = !current && failed;
  const lang = datePrefs.language;

  return (
    <>
      <OsPageHeader
        title="Analytics"
        actions={<NumbersMeta at={loadedAt} failed={failed} prefs={datePrefs} onRetry={retry} />}
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
        {current && current.growth.totalCompanies === 0 ? (
          <NumbersCard ariaLabel="Nothing to measure">
            <QuietBlock sentence="Nothing to measure yet" arrangement="grid" height={200} />
          </NumbersCard>
        ) : (
          <>
            <RevenueCard data={current} loading={loading} broken={broken} onRetry={retry} language={lang} runbookUrl={runbookUrl} datePrefs={datePrefs} />
            <GrowthCard data={current} loading={loading} broken={broken} onRetry={retry} language={lang} />
            <FunnelCard data={current} loading={loading} broken={broken} onRetry={retry} />
            <RetentionCard data={current} loading={loading} broken={broken} onRetry={retry} language={lang} />
            <CancellationsCard data={current} loading={loading} broken={broken} onRetry={retry} datePrefs={datePrefs} />
            <div className="grid grid-cols-1 gap-4 min-[1280px]:grid-cols-2">
              <RankCard
                title="Biggest workspaces"
                rows={current?.biggest ?? null}
                loading={loading}
                broken={broken}
                onRetry={retry}
                unit={(v) => `${n(v)} ${v === 1 ? "person" : "people"}`}
                note="Top five by people"
              />
              <RankCard
                title="Busiest workspaces"
                rows={current?.busiest ?? null}
                loading={loading}
                broken={broken}
                onRetry={retry}
                unit={(v) => `${n(v)} ${v === 1 ? "action" : "actions"}`}
                note={`Actions recorded in the last ${RANGE_LABEL[range]}`}
              />
            </div>
            <PlansCard data={current} loading={loading} broken={broken} onRetry={retry} />
          </>
        )}
      </div>

      <AboutDialog open={aboutOpen} onClose={() => setAboutOpen(false)} title="Analytics">
        Whether the business is growing. Revenue is what Stripe charged; everything else is counted from companies, people
        and recorded activity in the range you pick. Monthly revenue is every active Stripe subscription at Stripe&apos;s own
        price, before discounts, one line per currency and never converted. The chart is what paid invoices took in each
        period. Stripe figures are refreshed at most once an hour.
      </AboutDialog>
    </>
  );
}

interface CardProps {
  data: Analytics | null;
  loading: boolean;
  broken: boolean;
  onRetry: () => void;
}

function CardState({ loading, broken, onRetry, height, children }: { loading: boolean; broken: boolean; onRetry: () => void; height: number; children: () => React.ReactNode }) {
  if (loading) {
    return (
      <div style={{ minHeight: height }}>
        <SkeletonBars rows={3} height={14} gap={12} />
      </div>
    );
  }
  if (broken) return <CardRetry onRetry={onRetry} />;
  return <>{children()}</>;
}

/* ───────────────────────── 1. Revenue ───────────────────────── */

function RevenueCard({
  data,
  loading,
  broken,
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
      <CardState loading={loading} broken={broken} onRetry={onRetry} height={300}>
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
                  <RevenueLineBlock line={line} data={data} seriesFailed={rev.seriesFailed} onRetry={onRetry} language={language} multi={rev.lines.length > 1} />
                </div>
              ))}
              {rev.uncounted > 0 ? (
                <p className="m-0 text-sm text-ink-2">
                  {n(rev.uncounted)} {rev.uncounted === 1 ? "subscription has" : "subscriptions have"} a tiered or metered price and{" "}
                  {rev.uncounted === 1 ? "is" : "are"} not counted.
                </p>
              ) : null}
              {rev.truncated ? <p className="m-0 text-sm text-ink-2">Counted from the first 10,000 Stripe records, so the real figure is higher.</p> : null}
              <p className="m-0 text-sm text-ink-2">
                From Stripe subscriptions only, at their prices before discounts. Lifetime deals and companies on manual invoices are not counted.
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
  multi,
}: {
  line: RevenueLineOut;
  data: Analytics;
  seriesFailed: boolean;
  onRetry: () => void;
  language?: string | null;
  multi: boolean;
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
        {multi ? `${line.currency}: ` : ""}What Stripe was paid, {per} ({line.currency})
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

function GrowthCard({ data, loading, broken, onRetry, language }: CardProps & { language?: string | null }) {
  return (
    <NumbersCard title="Growth">
      <CardState loading={loading} broken={broken} onRetry={onRetry} height={240}>
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

function FunnelCard({ data, loading, broken, onRetry }: CardProps) {
  return (
    <NumbersCard title={data ? `Signup funnel · last ${n(data.funnel.windowDays)} days` : "Signup funnel"}>
      <CardState loading={loading} broken={broken} onRetry={onRetry} height={180}>
        {() => {
          if (!data) return null;
          const f = data.funnel;
          const steps = [
            { label: "Signed up", hint: "A company was created", count: f.signedUp },
            { label: "Finished setup", hint: "They completed the setup wizard", count: f.finishedSetup },
            { label: "Created something", hint: "At least one SOP, KRA or task", count: f.createdSomething },
            { label: "Paying", hint: "An active subscription", count: f.paying },
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

function RetentionCard({ data, loading, broken, onRetry, language }: CardProps & { language?: string | null }) {
  return (
    <NumbersCard title="Retention">
      <CardState loading={loading} broken={broken} onRetry={onRetry} height={200}>
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
                <span>Still active means somebody in that workspace did something in the last 30 days.</span>
                <span>Paying means an active subscription today.</span>
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

function CancellationsCard({ data, loading, broken, onRetry, datePrefs }: CardProps & { datePrefs: ReturnType<typeof useConsole>["datePrefs"] }) {
  return (
    <NumbersCard title="Cancellations">
      <CardState loading={loading} broken={broken} onRetry={onRetry} height={120}>
        {() => {
          if (!data) return null;
          if (data.cancellations.length === 0) return <p className="m-0 text-row text-ink-2">No cancellations in this range.</p>;
          return (
            <ul className="m-0 -mx-2 flex list-none flex-col p-0">
              {data.cancellations.map((c) => (
                <li key={`${c.id}-${c.canceledAt ?? ""}`} className="flex h-9 min-w-0 items-center gap-3 px-2">
                  <Link href={`/admin/companies/${c.id}`} className="min-w-0 truncate text-row text-ink hover:underline">{c.name}</Link>
                  <PlanChip plan={c.plan} />
                  <span className="flex-1" />
                  <span className="shrink-0 text-sm tabular-nums text-ink-2" title={c.canceledAt ? formatDateTitle(c.canceledAt, datePrefs) : undefined}>
                    {c.canceledAt ? formatDate(c.canceledAt, datePrefs, "date") : "Unknown"}
                  </span>
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
  onRetry,
  unit,
  note,
}: {
  title: string;
  rows: RankedCompany[] | null;
  loading: boolean;
  broken: boolean;
  onRetry: () => void;
  unit: (v: number) => string;
  note: string;
}) {
  return (
    <NumbersCard title={title}>
      <CardState loading={loading} broken={broken} onRetry={onRetry} height={200}>
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

function PlansCard({ data, loading, broken, onRetry }: CardProps) {
  return (
    <NumbersCard title="Plans">
      <CardState loading={loading} broken={broken} onRetry={onRetry} height={160}>
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
