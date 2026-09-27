"use client";

// The Stat card's body: one number, centred, and a caption that says what it
// counts. The number is the chart (a one-bar chart would say less), so it is
// large, proportional figures, in the product sans; the caption is the only
// other ink.

import type { WidgetResult } from "@/lib/dashboards/widget-data";
import type { StatScope } from "@/lib/dashboards/widgets";
import { useDatePrefs } from "@/lib/format/use-date-prefs";

const SCOPE_WORDS: Record<StatScope, string> = {
  total: "all tasks",
  open: "open tasks",
  completed: "completed tasks",
  overdue: "overdue tasks",
};

export function statCaption(result: Extract<WidgetResult, { kind: "stat" }>): string {
  const scope = SCOPE_WORDS[result.scope] ?? "tasks";
  if (result.metric.op === "sum") return `Sum across ${scope}`;
  return scope.charAt(0).toUpperCase() + scope.slice(1);
}

export function StatBody({ result }: { result: Extract<WidgetResult, { kind: "stat" }> }) {
  const prefs = useDatePrefs();
  const formatted = new Intl.NumberFormat(prefs.language || undefined, { maximumFractionDigits: 2 }).format(result.value);
  return (
    <div className="flex h-full min-h-0 flex-col items-center justify-center gap-1 px-2 text-center">
      {/* 32/600: the product has no display size token, so the one number
          on a Stat card sets its own, as the board chart view's does. */}
      <span className="font-semibold text-ink" style={{ fontSize: 32, lineHeight: "40px" }}>
        {formatted}
      </span>
      <span className="text-xs text-ink-2">{statCaption(result)}</span>
    </div>
  );
}
