"use client";

// WeekPills: the views-row pills for week navigation.
//
// Spec: docs/plans/ui-refresh/spec-work-home.md sections 2 and 3:
// "This week, Last week, then the previous 6 weeks as '8 Sep', '1 Sep'…
// overflowing into '•••'; a week with a submitted review shows a 6px success
// dot inside its pill beside the word."
//
// Offered to the planner unit for timesheets, which navigates the same way.

import { ViewTab } from "@/components/ui/view-tabs";
import type { WeekOption } from "@/lib/weeks";

export function WeekPills({
  weeks,
  active,
  onChange,
}: {
  weeks: readonly WeekOption[];
  active: string;
  onChange: (key: string) => void;
}) {
  return (
    <>
      {weeks.map((w) => (
        <ViewTab
          key={w.key}
          label={w.label}
          active={w.key === active}
          onClick={() => onChange(w.key)}
          trailing={
            w.submitted ? (
              // A dot beside the word, never instead of it: the pill still
              // reads correctly with no colour at all.
              <span
                className="h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--os-success-solid)]"
                aria-label="Submitted"
                title="Submitted"
              />
            ) : undefined
          }
        />
      ))}
    </>
  );
}
