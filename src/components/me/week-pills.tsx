"use client";

// WeekPills: the views-row pills for week navigation.
//
// Spec: docs/plans/ui-refresh/spec-work-home.md sections 2 and 3:
// "This week, Last week, then the previous 6 weeks as '8 Sep', '1 Sep'…
// overflowing into '•••'; a week with a submitted review shows a 6px success
// dot inside its pill beside the word."
//
// Offered to the planner unit for timesheets, which navigates the same way.

import { Check } from "lucide-react";
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
              // A check beside the word, never instead of it: the shape says
              // "submitted" with no colour at all (principle 7), where the
              // spec's plain dot relied on the green alone.
              <Check
                className="h-3 w-3 shrink-0 text-[var(--os-success-solid)]"
                strokeWidth={2.5}
                role="img"
                aria-label="Submitted"
              >
                <title>Submitted</title>
              </Check>
            ) : undefined
          }
        />
      ))}
    </>
  );
}
