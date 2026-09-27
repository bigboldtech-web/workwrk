"use client";

// The Chart card's body: tasks by status, assignee, priority or a field, as
// columns or a donut (monday's chart widget, drawn to the data-viz rules).
//
//   columns  one series, so one colour: a bucket's own colour where the
//            product already gives it one (a status, a priority, a choice),
//            else the first chart slot for every column. <= 24px thick, a 4px
//            rounded cap, square on the baseline, the value above the cap and
//            the category below; no gridlines or y axis, because every
//            column carries its number. Past 12 buckets the tail folds into
//            "Other".
//   donut    part to whole, so at most 6 segments (the tail folds into
//            "Other"); a 2px surface gap between segments (none on a ring of
//            one, which has nothing to separate), and a legend on
//            the right that names every segment with its share
//            ("<label>: <pct>%"), so identity never rests on colour alone.
//
// Colours without a product meaning come from a validated categorical
// palette (validate_palette.js: light against --os-surface #FFFFFF, dark
// against #181B20; the three light slots under 3:1 are covered by the
// legend's text). The slot follows the ENTITY, not its rank: buckets are
// assigned in key order, so a count changing never repaints a person. An
// empty bucket ("Unassigned", "No status") is neutral grey, and so is
// "Other". Text never wears a series colour.

import { useCallback, useMemo, useRef, useState } from "react";
import { Bar, BarChart, Cell, LabelList, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { WidgetResult } from "@/lib/dashboards/widget-data";
import { useDatePrefs } from "@/lib/format/use-date-prefs";

type Bucket = Extract<WidgetResult, { kind: "chart" }>["buckets"][number];
type Slice = { key: string; label: string; count: number; fill: string; pct: number };

const MAX_COLUMNS = 12;
const MAX_SEGMENTS = 6;
const SLOTS = 6;

// Both themes, on the product's own dark selectors (tokens.css: `.dark` on
// :root, and prefers-color-scheme guarded by data-theme="light").
const PALETTE_CSS = `
.dash-viz {
  --dash-viz-1: #2a78d6; --dash-viz-2: #eb6834; --dash-viz-3: #1baf7a;
  --dash-viz-4: #eda100; --dash-viz-5: #e87ba4; --dash-viz-6: #008300;
  --dash-viz-empty: var(--os-ink-4);
  --dash-viz-other: var(--os-ink-3);
}
:root.dark .dash-viz {
  --dash-viz-1: #3987e5; --dash-viz-2: #d95926; --dash-viz-3: #199e70;
  --dash-viz-4: #c98500; --dash-viz-5: #d55181; --dash-viz-6: #008300;
}
@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) .dash-viz {
    --dash-viz-1: #3987e5; --dash-viz-2: #d95926; --dash-viz-3: #199e70;
    --dash-viz-4: #c98500; --dash-viz-5: #d55181; --dash-viz-6: #008300;
  }
}
`;

function keyOf(b: Bucket): string {
  return b.key ?? "";
}

/** Roughly how wide a 12px label character is, for fitting a label to its column. */
const CHAR_PX = 6.6;

/** The container's width, for fitting column labels to their band. */
function useWidth(): [(el: HTMLDivElement | null) => void, number] {
  const [width, setWidth] = useState(0);
  const ro = useRef<ResizeObserver | null>(null);
  const ref = useCallback((el: HTMLDivElement | null) => {
    ro.current?.disconnect();
    ro.current = null;
    if (!el) return;
    setWidth(el.getBoundingClientRect().width);
    ro.current = new ResizeObserver((entries) => setWidth(entries[0]?.contentRect.width ?? 0));
    ro.current.observe(el);
  }, []);
  return [ref, width];
}

/** Slot per bucket key, in key order, so a colour belongs to its entity. */
function slotByKey(buckets: readonly Bucket[]): Map<string, number> {
  const keys = buckets.filter((b) => b.key !== null && !b.color).map(keyOf).sort((a, b) => a.localeCompare(b));
  return new Map(keys.map((k, i) => [k, (i % SLOTS) + 1] as const));
}

function fold(buckets: readonly Bucket[], max: number): Array<Bucket & { other?: true }> {
  if (buckets.length <= max) return [...buckets];
  const head = buckets.slice(0, max - 1);
  const rest = buckets.slice(max - 1).reduce((n, b) => n + b.count, 0);
  return [...head, { key: "__other__", label: "Other", color: null, count: rest, other: true }];
}

function fillFor(b: Bucket & { other?: true }, display: "bar" | "donut", slots: Map<string, number>): string {
  // Two neutrals, one step apart, so "Unassigned" and "Other" never read as
  // one segment; the legend names both.
  if (b.other) return "var(--dash-viz-other)";
  if (b.key === null) return "var(--dash-viz-empty)";
  if (b.color) return b.color;
  if (display === "bar") return "var(--dash-viz-1)";
  return `var(--dash-viz-${slots.get(keyOf(b)) ?? 1})`;
}

/**
 * The donut's arcs: a bucket with nothing in it draws no arc, so it can
 * never bring a separator back to a ring that is really one segment. The
 * legend still lists every slice.
 */
export function donutSegments<T extends { count: number }>(slices: readonly T[]): T[] {
  return slices.filter((s) => s.count > 0);
}

/**
 * The surface gap between donut segments, in px. One segment has no
 * neighbour to separate: recharts caps a full ring at 359.999 degrees, so
 * both straight edges of that lone sector sit at the start angle, and a
 * stroke on them draws a white notch at 3 o'clock that reads as a second
 * slice the legend never names.
 */
export function segmentGap(segments: number): number {
  return segments > 1 ? 2 : 0;
}

function ChartTip({ active, slice, total, count }: { active?: boolean; slice?: Slice; total: number; count: (n: number) => string }) {
  if (!active || !slice) return null;
  return (
    <div className="rounded-md border border-line bg-raised px-2.5 py-1.5 text-xs shadow-[var(--os-shadow-pop)]">
      <div className="flex items-center gap-1.5">
        <span className="inline-block h-0.5 w-3 rounded-full" style={{ backgroundColor: slice.fill }} aria-hidden />
        <span className="font-semibold text-ink">{count(slice.count)}</span>
        {total > 0 ? <span className="text-ink-2">{slice.pct}%</span> : null}
      </div>
      <div className="mt-0.5 text-ink-2">{slice.label}</div>
    </div>
  );
}

export function ChartBody({ result }: { result: Extract<WidgetResult, { kind: "chart" }> }) {
  const prefs = useDatePrefs();
  const nf = useMemo(() => new Intl.NumberFormat(prefs.language || undefined, { maximumFractionDigits: 0 }), [prefs.language]);
  const count = (n: number) => nf.format(n);
  const display = result.display === "donut" ? "donut" : "bar";
  const total = result.buckets.reduce((n, b) => n + b.count, 0);

  const slices: Slice[] = useMemo(() => {
    const slots = slotByKey(result.buckets);
    const folded = fold(result.buckets, display === "donut" ? MAX_SEGMENTS : MAX_COLUMNS);
    const sum = folded.reduce((n, b) => n + b.count, 0);
    return folded.map((b) => ({
      key: b.key ?? "__none__",
      label: b.label,
      count: b.count,
      fill: fillFor(b, display, slots),
      pct: sum > 0 ? Math.round((b.count / sum) * 100) : 0,
    }));
  }, [result.buckets, display]);

  const segments = useMemo(() => donutSegments(slices), [slices]);
  const gap = segmentGap(segments.length);

  const [measure, width] = useWidth();
  // A column's label gets its band's width and no more: a longer one is cut
  // with an ellipsis (the full label is in the tooltip), never drawn over
  // its neighbour.
  const maxChars = Math.max(3, Math.floor(((width || 320) / Math.max(1, slices.length) - 6) / CHAR_PX));

  if (total === 0) {
    return <div className="flex h-full items-center justify-center text-sm text-ink-2">No tasks match</div>;
  }

  return (
    <div ref={measure} className="dash-viz h-full min-h-0 w-full">
      {/* href + precedence: React hoists it into <head> once, however many
          charts are on the page. */}
      <style href="dash-viz-palette" precedence="default">{PALETTE_CSS}</style>
      {display === "bar" ? (
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={slices} margin={{ top: 20, right: 4, bottom: 0, left: 4 }} barCategoryGap="20%">
            <XAxis
              dataKey="label"
              interval={0}
              tickLine={false}
              axisLine={{ stroke: "var(--os-line-strong)" }}
              tick={{ fontSize: 12, fill: "var(--os-ink-2)" }}
              tickFormatter={(v: string) => (v.length > maxChars ? `${v.slice(0, Math.max(1, maxChars - 1))}…` : v)}
              height={24}
            />
            <YAxis hide domain={[0, "dataMax"]} />
            <Tooltip
              cursor={{ fill: "var(--os-surface-hov)" }}
              isAnimationActive={false}
              content={(p) => <ChartTip active={p.active} slice={(p.payload?.[0]?.payload as Slice | undefined) ?? undefined} total={total} count={count} />}
            />
            <Bar dataKey="count" radius={[4, 4, 0, 0]} maxBarSize={24} isAnimationActive={false}>
              {slices.map((s) => (
                <Cell key={s.key} fill={s.fill} />
              ))}
              <LabelList dataKey="count" position="top" formatter={(v: unknown) => count(Number(v) || 0)} style={{ fontSize: 12, fill: "var(--os-ink-2)" }} />
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      ) : (
        <div className="flex h-full min-h-0 items-center gap-3">
          <div className="h-full min-h-0 min-w-0 flex-1">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Tooltip
                  isAnimationActive={false}
                  content={(p) => <ChartTip active={p.active} slice={(p.payload?.[0]?.payload as Slice | undefined) ?? undefined} total={total} count={count} />}
                />
                <Pie
                  data={segments}
                  dataKey="count"
                  nameKey="label"
                  innerRadius="68%"
                  outerRadius="92%"
                  stroke={gap > 0 ? "var(--os-surface)" : "none"}
                  strokeWidth={gap}
                  isAnimationActive={false}
                >
                  {segments.map((s) => (
                    <Cell key={s.key} fill={s.fill} />
                  ))}
                </Pie>
              </PieChart>
            </ResponsiveContainer>
          </div>
          <ul className="flex max-h-full min-w-0 max-w-[50%] shrink-0 flex-col gap-1.5 overflow-y-auto pe-1 text-xs" aria-label="Legend">
            {slices.map((s) => (
              <li key={s.key} className="flex min-w-0 items-center gap-2">
                <span className="inline-block h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: s.fill }} aria-hidden />
                <span className="min-w-0 truncate text-ink" title={`${s.label}: ${count(s.count)}`}>
                  {s.label}: <span className="text-ink-2">{s.pct}%</span>
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
