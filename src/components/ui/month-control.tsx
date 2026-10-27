"use client";

// MonthControl (spec-goals section 3): ‹ "September 2026" › for a "YYYY-MM"
// month. The chip is a 36px secondary; the arrows are 32px icon buttons. Next
// is disabled beyond `max` (a month that has not started is not a choice,
// which is a fact about time, not an access matter, so the button renders
// disabled rather than hidden). Used by KPI reviews; the employee recorder
// and timesheets may adopt it.
//
// Generalised for repeating goals (docs/plans/recurring-goals.md E2): given
// `periods`, an ordered list of { key, label } (oldest first), it steps
// through those instead of calendar months, and the arrows stop at either
// end of the list ("Previous period", "Next period"). Without `periods` it
// is exactly the month control it always was, so KPI reviews do not change.

import { ChevronLeft, ChevronRight } from "lucide-react";
import { kpiPeriodLabel, shiftKpiPeriod } from "@/lib/kpi-period";

export interface PeriodStep {
  key: string;
  label: string;
}

export function MonthControl({ value, min, max, onChange, className, periods }: {
  value: string;
  min?: string;
  max?: string;
  onChange: (next: string) => void;
  className?: string;
  /** Step through these (oldest first) instead of calendar months. */
  periods?: readonly PeriodStep[];
}) {
  let prev: string | null;
  let next: string | null;
  let label: string;
  if (periods) {
    const i = periods.findIndex((p) => p.key === value);
    prev = i > 0 ? periods[i - 1].key : null;
    next = i >= 0 && i < periods.length - 1 ? periods[i + 1].key : null;
    label = i >= 0 ? periods[i].label : value;
  } else {
    prev = shiftKpiPeriod(value, -1);
    next = shiftKpiPeriod(value, 1);
    if (min != null && prev < min) prev = null;
    if (max != null && next > max) next = null;
    label = kpiPeriodLabel(value);
  }
  const unit = periods ? "period" : "month";
  const btn = "inline-flex h-8 w-8 items-center justify-center rounded-md text-ink-2 hover:bg-hover hover:text-ink disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent";
  return (
    <span className={`inline-flex items-center gap-1 ${className ?? ""}`} role="group" aria-label={periods ? "Period" : "Month"}>
      <button type="button" className={btn} onClick={() => { if (prev != null) onChange(prev); }} disabled={prev == null} aria-label={`Previous ${unit}`}>
        <ChevronLeft className="h-4 w-4" />
      </button>
      <span className="inline-flex h-9 min-w-[140px] items-center justify-center rounded-md border border-line bg-raised px-3 text-base font-medium text-ink tabular-nums" aria-live="polite">
        {label}
      </span>
      <button type="button" className={btn} onClick={() => { if (next != null) onChange(next); }} disabled={next == null} aria-label={`Next ${unit}`}>
        <ChevronRight className="h-4 w-4" />
      </button>
    </span>
  );
}
