"use client";

// BurndownChart: one axis, two 2px lines (a neutral dashed ideal and a
// brand-blue actual with a faint area under it), the current day marked, a
// crosshair tooltip on hover. Shared by My work's Sprint view (tasks) and the
// sprint List's header strip (Sprint Points), so the product has one
// burndown that reads the same in both places. Text wears the ink tokens;
// only the marks carry colour.

import { useState } from "react";

export interface BurndownPoint {
  /** The date this point stands on, at local midnight. */
  at: Date;
  /** Work left if the sprint burned evenly. */
  ideal: number;
  /** Work actually left at the end of this day; null for days still ahead. */
  actual: number | null;
}

const W = 640;
const H = 220;
const PAD = { top: 12, right: 12, bottom: 28, left: 36 };

function dayLabel(d: Date): string {
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export function BurndownChart({
  points,
  total,
  todayIndex,
  unit,
  height = H,
}: {
  points: BurndownPoint[];
  /** The committed amount at day 0 (the top of the axis). */
  total: number;
  /** Index of today inside `points`; outside the range draws no marker. */
  todayIndex: number;
  /** The word the tooltip uses: "tasks", "points". */
  unit: string;
  height?: number;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const n = Math.max(points.length, 2);
  const innerW = W - PAD.left - PAD.right;
  const innerH = height - PAD.top - PAD.bottom;
  const max = Math.max(1, total);
  const x = (i: number) => PAD.left + (i / (n - 1)) * innerW;
  const y = (v: number) => PAD.top + innerH - (v / max) * innerH;

  const idealPath = points.map((p, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(p.ideal).toFixed(1)}`).join(" ");
  const actual = points.map((p, i) => ({ i, v: p.actual })).filter((p): p is { i: number; v: number } => p.v !== null);
  const actualPath = actual.map((p, k) => `${k === 0 ? "M" : "L"}${x(p.i).toFixed(1)},${y(p.v).toFixed(1)}`).join(" ");
  const last = actual[actual.length - 1];
  const areaPath = last ? `${actualPath} L${x(last.i).toFixed(1)},${y(0).toFixed(1)} L${x(0).toFixed(1)},${y(0).toFixed(1)} Z` : "";
  const ticks = [0, 0.5, 1].map((f) => Math.round(max * f));
  const labelEvery = points.length > 16 ? 4 : 2;
  const hovered = hover !== null ? points[hover] : null;

  return (
    <div className="relative">
      <svg
        viewBox={`0 0 ${W} ${height}`}
        className="h-auto w-full"
        role="img"
        aria-label={`Burndown: ${total} ${unit} committed, ${last ? last.v : total} left`}
        onMouseLeave={() => setHover(null)}
        onMouseMove={(e) => {
          const rect = e.currentTarget.getBoundingClientRect();
          const px = ((e.clientX - rect.left) / rect.width) * W;
          const i = Math.round(((px - PAD.left) / innerW) * (n - 1));
          setHover(Math.max(0, Math.min(points.length - 1, i)));
        }}
      >
        {ticks.map((t) => (
          <g key={t}>
            <line x1={PAD.left} x2={W - PAD.right} y1={y(t)} y2={y(t)} stroke="var(--os-line-soft)" strokeWidth={1} />
            <text x={PAD.left - 6} y={y(t) + 4} textAnchor="end" fontSize={11} fill="var(--os-ink-3)">{t}</text>
          </g>
        ))}
        {points.map((p, i) => (i % labelEvery === 0 ? (
          <text key={i} x={x(i)} y={height - 8} textAnchor="middle" fontSize={11} fill="var(--os-ink-3)">
            {p.at.getDate()}
          </text>
        ) : null))}
        {todayIndex >= 0 && todayIndex < points.length ? (
          <line x1={x(todayIndex)} x2={x(todayIndex)} y1={PAD.top} y2={PAD.top + innerH} stroke="var(--os-ink-3)" strokeWidth={1} strokeDasharray="2 3" />
        ) : null}
        {areaPath ? <path d={areaPath} fill="var(--os-brand)" opacity={0.08} /> : null}
        <path d={idealPath} fill="none" stroke="var(--os-ink-3)" strokeWidth={2} strokeDasharray="5 4" />
        {actualPath ? <path d={actualPath} fill="none" stroke="var(--os-brand)" strokeWidth={2} strokeLinejoin="round" /> : null}
        {last ? <circle cx={x(last.i)} cy={y(last.v)} r={4} fill="var(--os-brand)" stroke="var(--os-surface)" strokeWidth={2} /> : null}
        {hover !== null ? (
          <line x1={x(hover)} x2={x(hover)} y1={PAD.top} y2={PAD.top + innerH} stroke="var(--os-ink-2)" strokeWidth={1} />
        ) : null}
      </svg>
      {hovered && hover !== null ? (
        <div
          className="pointer-events-none absolute top-2 rounded-md border border-line bg-raised px-2.5 py-1.5 text-xs text-ink shadow-[var(--os-shadow-pop)]"
          style={{ left: `${(x(hover) / W) * 100}%`, transform: hover > n / 2 ? "translateX(calc(-100% - 8px))" : "translateX(8px)" }}
        >
          <div className="font-medium">{dayLabel(hovered.at)}</div>
          <div className="text-ink-2">Ideal {Math.round(hovered.ideal)} {unit} left</div>
          <div className="text-ink-2">{hovered.actual === null ? "Not yet" : `Actual ${hovered.actual} ${unit} left`}</div>
        </div>
      ) : null}
    </div>
  );
}
