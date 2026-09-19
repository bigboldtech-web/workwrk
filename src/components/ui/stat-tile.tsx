"use client";

// StatTile: the one number-in-a-box.
//
// Spec: docs/plans/ui-refresh/spec-work-home.md section 3: "one primitive
// replacing the eight local `KpiTile` copies the audit found (misc-apps
// section 4)". Offered to the teams-performance and settings units.
//
// Bordered card, radius 8, padding 16; label 13/500 ink-2, value 22/600 with
// tabular figures, and a 12px delta as TEXT with an arrow. The delta is never
// coloured unless it means at risk (overdue going up), because a green number
// and a red number on the same row teach people to read colour instead of the
// word, and half of them cannot tell those two apart anyway.

import { cn } from "@/lib/utils";

export interface StatTileProps {
  label: string;
  /** Already formatted: this component never guesses a number's units. */
  value: string | number;
  /** "12%" — the arrow and the word "vs" are added here. */
  delta?: { pct: number; direction: "up" | "down" } | null;
  /** Danger pairs the arrow with --os-danger-text; neutral is the default. */
  deltaMeaning?: "neutral" | "danger";
  /** A second line under the value ("of 42 assigned"). */
  hint?: string;
  className?: string;
}

export function StatTile({ label, value, delta, deltaMeaning = "neutral", hint, className }: StatTileProps) {
  const danger = deltaMeaning === "danger" && delta !== null && delta !== undefined && delta.pct !== 0;
  return (
    <div className={cn("os-row rounded-lg border border-line bg-raised p-4", className)}>
      {/* title, because a 5-up grid narrows under an open filter panel and a
          long label ("SOPs acknowledged") truncates. */}
      <div className="truncate text-sm font-medium text-ink-2" title={label}>{label}</div>
      <div className="mt-1 text-xl font-semibold tabular-nums text-ink">{value}</div>
      {delta ? (
        <div className={cn("mt-1 text-xs tabular-nums", danger ? "text-danger-text" : "text-ink-2")}>
          {/* The arrow carries the direction and the word carries the meaning,
              so neither one is doing the job alone. */}
          <span aria-hidden>{delta.direction === "up" ? "▲" : "▼"}</span>{" "}
          {Math.abs(delta.pct)}% <span className="text-ink-3">vs previous</span>
        </div>
      ) : hint ? (
        <div className="mt-1 truncate text-xs text-ink-2">{hint}</div>
      ) : null}
    </div>
  );
}

export function StatTileSkeleton() {
  return (
    <div className="os-row rounded-lg border border-line bg-raised p-4" aria-busy="true">
      <span className="os-skeleton-pulse block h-3 w-24 rounded bg-skeleton" />
      <span className="os-skeleton-pulse mt-2 block h-6 w-16 rounded bg-skeleton" />
    </div>
  );
}
