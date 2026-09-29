"use client";

// The Workload by person card's body (Phase 6 decision b, Space Overview):
// one 36px row per person with open work in the card's Lists, busiest first
// by share of capacity. Each row: avatar, name, a 4px utilisation bar
// (--os-surface-2 fill at or under capacity, the danger tint above it, and
// the "load / capacity" numbers beside it, never colour alone), and a red
// "N overdue" when late work is waiting, so a buried person never reads as
// having room. A capacity marked "Company schedule" is the workspace's, not
// the person's own: their own hours are people data the viewer may not hold.
//
// The numbers are the Workload page's counting (workload-count.ts) over the
// tasks the VIEWER can read, computed on the server (widget-data.ts).

import type { WidgetResult } from "@/lib/dashboards/widget-data";
import { Avatar } from "@/components/ui/avatar-stack";
import { useFormat } from "@/lib/format/use-date-prefs";
import { cn } from "@/lib/utils";

type WorkloadResult = Extract<WidgetResult, { kind: "workload" }>;

function fmtN(n: number): string {
  const r = Math.round(n * 10) / 10;
  return Number.isInteger(r) ? String(r) : r.toFixed(1);
}

export function workloadCaption(result: WorkloadResult, wallDate: (key: string) => string): string {
  return `${result.mode === "hours" ? "Hours" : "Tasks"}, ${wallDate(result.from)} to ${wallDate(result.to)}`;
}

export function WorkloadBody({ result }: { result: WorkloadResult }) {
  const fmt = useFormat();
  const unit = result.mode === "hours" ? "h" : "";
  const un = result.unassigned;
  if (result.people.length === 0 && !(un && (un.load > 0 || un.overdue > 0 || un.unscheduled > 0))) {
    return <div className="flex h-full items-center justify-center text-sm text-ink-2">No open work in these Lists</div>;
  }
  return (
    <div className="flex h-full min-h-0 flex-col">
      <p className="m-0 shrink-0 px-2 pb-1 text-xs text-ink-2">{workloadCaption(result, (k) => fmt.wallDate(k))}</p>
      <ul className="min-h-0 flex-1 overflow-y-auto" aria-label="Workload by person">
        {result.people.map((p) => {
          const over = p.load > p.capacity;
          const util = p.capacity > 0 ? Math.min(p.load / p.capacity, 1) : p.load > 0 ? 1 : 0;
          const name = `${p.firstName} ${p.lastName}`.trim() || "Unnamed";
          const numbers = `${fmtN(p.load)}${unit} / ${fmtN(p.capacity)}${unit}`;
          return (
            <li key={p.id} className="flex h-9 min-w-0 items-center gap-2 px-2">
              <Avatar person={{ id: p.id, firstName: p.firstName, lastName: p.lastName, avatar: p.avatar }} size={20} />
              <span className="w-[34%] min-w-0 shrink-0 truncate text-base text-ink" title={name}>{name}</span>
              <span className="relative h-1 min-w-[40px] flex-1 overflow-hidden rounded-full bg-[var(--os-surface-2)]" aria-hidden>
                <span className={cn("absolute inset-y-0 start-0 rounded-full", over ? "bg-danger-solid" : "bg-[var(--os-brand)]")} style={{ width: `${util * 100}%` }} />
              </span>
              <span
                className={cn("shrink-0 text-xs tabular-nums", over ? "font-medium text-danger-text" : "text-ink-2")}
                title={p.ownCapacity ? `${numbers}${over ? `, over by ${fmtN(p.load - p.capacity)}${unit}` : ""}` : `${numbers}, measured against the company schedule`}
              >
                {numbers}{p.ownCapacity ? "" : "*"}
              </span>
              {p.overdue > 0 ? (
                <span className="shrink-0 text-xs font-medium tabular-nums text-danger-text">{fmt.count(p.overdue)} overdue</span>
              ) : null}
            </li>
          );
        })}
        {un && (un.load > 0 || un.overdue > 0 || un.unscheduled > 0) ? (
          <li className="flex h-9 min-w-0 items-center gap-2 px-2 text-ink-2">
            <span className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-subtle text-micro" aria-hidden>?</span>
            <span className="min-w-0 flex-1 truncate text-base">Unassigned</span>
            <span className="shrink-0 text-xs tabular-nums">{fmtN(un.load)}{unit}{un.unscheduled ? ` · ${fmt.count(un.unscheduled)} unscheduled` : ""}</span>
            {un.overdue > 0 ? <span className="shrink-0 text-xs font-medium tabular-nums text-danger-text">{fmt.count(un.overdue)} overdue</span> : null}
          </li>
        ) : null}
      </ul>
      {result.people.some((p) => !p.ownCapacity) ? (
        <p className="m-0 shrink-0 px-2 pt-1 text-xs text-ink-3">* Company schedule. Their own hours are visible to their manager and the People team.</p>
      ) : null}
      {result.truncated ? <p className="m-0 shrink-0 px-2 pt-1 text-xs text-ink-2">Counted from the most recently updated 5,000 tasks.</p> : null}
    </div>
  );
}
