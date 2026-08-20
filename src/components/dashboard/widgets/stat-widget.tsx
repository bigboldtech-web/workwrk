"use client";

// StatWidget — the "Calculation" card body: one big number computed from
// the widget's source items. Scope (open/total/completed/overdue) is
// switchable inline while the dashboard is in edit mode.

import { Loader2 } from "lucide-react";
import type { DashWidget, StatScope } from "../widget-types";
import { countForScope, useWidgetItems } from "./use-widget-items";

const SCOPES: Array<{ value: StatScope; label: string }> = [
  { value: "open",      label: "Open tasks" },
  { value: "total",     label: "Total tasks" },
  { value: "completed", label: "Completed" },
  { value: "overdue",   label: "Overdue" },
];

export function StatWidget({
  widget,
  editMode,
  onConfigChange,
}: {
  widget: DashWidget;
  editMode: boolean;
  onConfigChange: (patch: Partial<DashWidget["config"]>) => void;
}) {
  const { items, loading, error } = useWidgetItems(widget.config.source);
  const scope = widget.config.statScope ?? "open";
  const scopeLabel = SCOPES.find((s) => s.value === scope)?.label ?? "Open tasks";

  return (
    <div className="flex h-full min-h-[72px] flex-col items-center justify-center gap-1.5">
      {loading ? (
        <Loader2 className="h-5 w-5 animate-spin text-zinc-300" />
      ) : error ? (
        <span className="text-[13px] text-zinc-400">Couldn&apos;t load</span>
      ) : (
        <span className={`text-[28px] font-semibold leading-none ${scope === "overdue" && countForScope(items ?? [], scope) > 0 ? "text-red-600" : "text-zinc-900"}`}>
          {countForScope(items ?? [], scope)}
        </span>
      )}
      {editMode ? (
        <select
          value={scope}
          onChange={(e) => onConfigChange({ statScope: e.target.value as StatScope })}
          aria-label="Calculation scope"
          className="h-6 rounded-md border border-zinc-200 bg-white px-1.5 text-[12.5px] text-zinc-600 outline-none focus:border-zinc-300"
        >
          {SCOPES.map((s) => (
            <option key={s.value} value={s.value}>{s.label}</option>
          ))}
        </select>
      ) : (
        <span className="text-[12px] uppercase tracking-wide text-zinc-400">{scopeLabel}</span>
      )}
    </div>
  );
}
