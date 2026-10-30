"use client";

// The goal page's pieces for a repeating goal (docs/plans/recurring-goals.md E2):
//
//   GoalPeriodControl  the Summary card's top line: ‹ October 2026 › (the
//                      generalised MonthControl, over the periods that have
//                      started) and "9 days left". It writes ?period=<key>
//                      (none for the period running now), and the server
//                      page renders that period: the ring, the On track?
//                      block, Targets and Activity follow it. Next stops at
//                      the period running now.
//   PastPeriods        after Targets, once a period has closed: a small bar
//                      trend of the last 12 periods (progress per period, a
//                      100% reference line; the dashboard chart card's
//                      recharts bar), then 36px rows newest first (the name,
//                      the result as one pale chip, "112 of 100" for a goal
//                      with one target or the attainment, the 72px bar the
//                      Targets rows use; below 640 the bar goes and the
//                      value stays, final review L13). A row moves the
//                      period control there. 12 rows, then Show more (GET
//                      /api/okrs/[id]/periods?closed=1&page=).
//
// Both render what the server sent (the page's first paint), so what they
// show is the stored period data, never a browser computation.

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Bar, BarChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { MonthControl, type PeriodStep } from "@/components/ui/month-control";
import { ToneChip } from "@/components/people/person-bits";
import { RESULT_TONE, resultWords, shownPercent } from "@/lib/goals/goal-form";
import type { GoalResult } from "@/lib/goals/goal-period";
import type { PastPeriodRow } from "@/lib/goals/goal-period-view.server";
import { cn } from "@/lib/utils";

const num = (n: number) => (Number.isInteger(n) ? String(n) : String(Math.round(n * 100) / 100));

/** The goal page's URL for a period: the bare page for the one running now. */
export function periodHref(okrId: string, key: string, currentKey: string | null): string {
  return key === currentKey ? `/okrs/${okrId}` : `/okrs/${okrId}?period=${encodeURIComponent(key)}`;
}

export function GoalPeriodControl({ okrId, choices, value, currentKey, aside }: {
  okrId: string;
  /** The periods that have started, oldest first. */
  choices: readonly PeriodStep[];
  value: string;
  currentKey: string | null;
  /** "9 days left", or the period's dates once it has ended. */
  aside?: string | null;
}) {
  const router = useRouter();
  return (
    <div className="mb-4 flex flex-wrap items-center gap-x-3 gap-y-2">
      <MonthControl periods={choices} value={value} onChange={(k) => router.replace(periodHref(okrId, k, currentKey), { scroll: false })} />
      {aside ? <span className="text-sm tabular-nums text-ink-2">{aside}</span> : null}
    </div>
  );
}

export interface PastPeriodsInitial {
  rows: PastPeriodRow[];
  total: number;
}

const toneOf = (r: string | null) => RESULT_TONE[(r ?? "NOT_MEASURED") as GoalResult] ?? "neutral";

/** The trend's bars, oldest to newest: the last 12 closed periods' progress (clamped, 0 to 100). */
export function trendPoints(rows: readonly PastPeriodRow[]): Array<{ key: string; label: string; name: string; progress: number; attainment: number | null; words: string }> {
  return rows.slice(0, 12).reverse().map((r) => ({
    key: r.key,
    label: r.shortLabel,
    name: r.label,
    progress: Math.max(0, Math.min(100, r.progress ?? 0)),
    attainment: shownPercent(r),
    words: resultWords(r.resultLabel ?? "Not measured", r),
  }));
}

function TrendTip({ active, point }: { active?: boolean; point?: { name: string; words: string } }) {
  if (!active || !point) return null;
  return (
    <div className="rounded-md border border-line bg-raised px-2.5 py-1.5 text-xs shadow-[var(--os-shadow-pop)]">
      <div className="font-medium text-ink">{point.name}</div>
      <div className="text-ink-2">{point.words}</div>
    </div>
  );
}

export function PastPeriods({ okrId, initial, selectedKey, currentKey }: {
  okrId: string;
  initial: PastPeriodsInitial;
  selectedKey: string | null;
  currentKey: string | null;
}) {
  const router = useRouter();
  const [rows, setRows] = useState<PastPeriodRow[]>(initial.rows);
  const [page, setPage] = useState(1);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(false);
  const total = initial.total;
  const points = trendPoints(initial.rows);

  const more = async () => {
    setBusy(true);
    setErr(false);
    try {
      const r = await fetch(`/api/okrs/${okrId}/periods?closed=1&page=${page + 1}`, { cache: "no-store" });
      if (!r.ok) throw new Error(String(r.status));
      const j = await r.json();
      const next = (j.data ?? []) as PastPeriodRow[];
      setRows((cur) => [...cur, ...next.filter((n) => !cur.some((c) => c.key === n.key))]);
      setPage((p) => p + 1);
    } catch {
      setErr(true);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="rounded-lg border border-line bg-raised p-6" aria-labelledby="goal-past-h">
      <h2 id="goal-past-h" className="m-0 flex items-baseline gap-2 text-base font-semibold text-ink">
        Past periods <span className="text-xs font-medium text-ink-2">{total}</span>
      </h2>
      {points.length > 1 ? (
        <div className="mt-3 h-[120px] w-full" role="img" aria-label={`Results of the last ${points.length} periods: ${points.map((p) => `${p.name} ${p.words}`).join(", ")}`}>
          <ResponsiveContainer width="100%" height="100%">
            {/* The role="img" wrapper carries the text alternative; recharts' own keyboard layer would be a second, unnamed one. */}
            <BarChart data={points} margin={{ top: 8, right: 4, bottom: 0, left: 4 }} barCategoryGap="20%" accessibilityLayer={false}>
              {/* Labels that would collide (twelve weeks at 390) are skipped, never drawn over each other. */}
              <XAxis dataKey="label" interval="preserveStartEnd" minTickGap={6} tickLine={false} axisLine={{ stroke: "var(--os-line-strong)" }} tick={{ fontSize: 12, fill: "var(--os-ink-2)" }} height={24} />
              <YAxis hide domain={[0, 100]} />
              <ReferenceLine y={100} stroke="var(--os-line-strong)" strokeDasharray="4 4" ifOverflow="extendDomain" />
              <Tooltip
                cursor={{ fill: "var(--os-surface-hov)" }}
                isAnimationActive={false}
                content={(p) => <TrendTip active={p.active} point={(p.payload?.[0]?.payload as { name: string; words: string } | undefined) ?? undefined} />}
              />
              <Bar dataKey="progress" fill="var(--os-brand)" radius={[4, 4, 0, 0]} maxBarSize={24} isAnimationActive={false} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      ) : null}
      <ol className="m-0 mt-2 flex list-none flex-col p-0">
        {rows.map((r) => {
          const pct = Math.max(0, Math.min(100, r.progress ?? 0));
          const selected = r.key === selectedKey;
          return (
            <li key={r.key} className="border-b border-line last:border-b-0">
              <button
                type="button"
                onClick={() => router.replace(periodHref(okrId, r.key, currentKey), { scroll: false })}
                aria-current={selected ? "true" : undefined}
                // Below 640 a row is two lines, the period's name whole on the
                // first and its result and number on the second, so a phone
                // never cuts "September 2026" to "Septem...".
                className={cn("os-row flex h-9 w-full min-w-0 items-center gap-3 text-start hover:bg-hover max-sm:h-auto max-sm:flex-wrap max-sm:gap-y-1 max-sm:py-2", selected && "bg-active")}
              >
                <span className="min-w-0 flex-1 truncate text-row text-ink max-sm:basis-full max-sm:whitespace-normal">{r.label}</span>
                <span className="flex shrink-0 sm:w-[104px]"><ToneChip tone={toneOf(r.result)} label={r.resultLabel ?? "Not measured"} /></span>
                <span className="shrink-0 whitespace-nowrap text-end text-sm tabular-nums text-ink-2 max-sm:ms-auto sm:w-[120px]">
                  {r.result === "NOT_MEASURED" ? "" : r.single ? `${num(r.single.currentValue)} of ${num(r.single.targetValue)}${r.single.unit ? ` ${r.single.unit}` : ""}` : `${shownPercent(r) ?? 0}%`}
                </span>
                <span className="hidden h-1 w-[72px] shrink-0 overflow-hidden rounded-full bg-active sm:block" aria-hidden>
                  {r.result === "NOT_MEASURED" ? null : <span className="block h-full rounded-full bg-brand" style={{ width: `${pct}%` }} />}
                </span>
              </button>
            </li>
          );
        })}
      </ol>
      {rows.length < total ? (
        <button type="button" disabled={busy} onClick={() => void more()} className="mt-2 text-sm text-brand-deep hover:underline disabled:opacity-60">Show more</button>
      ) : null}
      {err ? <p className="m-0 mt-1 text-sm text-danger-text">Couldn&apos;t load more. <button type="button" onClick={() => void more()} className="underline">Retry</button></p> : null}
    </section>
  );
}
