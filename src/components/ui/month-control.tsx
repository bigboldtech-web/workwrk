"use client";

// MonthControl (spec-goals section 3): ‹ "September 2026" › for a "YYYY-MM"
// month. The chip is a 36px secondary; the arrows are 32px icon buttons. Next
// is disabled beyond `max` (a month that has not started is not a choice,
// which is a fact about time, not an access matter, so the button renders
// disabled rather than hidden). Used by KPI reviews; the employee recorder
// and timesheets may adopt it.

import { ChevronLeft, ChevronRight } from "lucide-react";
import { kpiPeriodLabel, shiftKpiPeriod } from "@/lib/kpi-period";

export function MonthControl({ value, min, max, onChange, className }: {
  value: string;
  min?: string;
  max?: string;
  onChange: (next: string) => void;
  className?: string;
}) {
  const prev = shiftKpiPeriod(value, -1);
  const next = shiftKpiPeriod(value, 1);
  const prevOff = min != null && prev < min;
  const nextOff = max != null && next > max;
  const btn = "inline-flex h-8 w-8 items-center justify-center rounded-md text-ink-2 hover:bg-hover hover:text-ink disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent";
  return (
    <span className={`inline-flex items-center gap-1 ${className ?? ""}`} role="group" aria-label="Month">
      <button type="button" className={btn} onClick={() => onChange(prev)} disabled={prevOff} aria-label="Previous month">
        <ChevronLeft className="h-4 w-4" />
      </button>
      <span className="inline-flex h-9 min-w-[140px] items-center justify-center rounded-md border border-line bg-raised px-3 text-base font-medium text-ink tabular-nums" aria-live="polite">
        {kpiPeriodLabel(value)}
      </span>
      <button type="button" className={btn} onClick={() => onChange(next)} disabled={nextOff} aria-label="Next month">
        <ChevronRight className="h-4 w-4" />
      </button>
    </span>
  );
}
