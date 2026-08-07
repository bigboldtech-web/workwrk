"use client";

// GanttBacklogPanel — the ClickUp Timeline "Tasks" side panel that docks to
// the right of the Gantt chart. Two tabs: Unscheduled (no dates yet — rows
// drag out onto the timeline to schedule at the drop day, or one-click
// "Today") and Overdue (dated in the past, still open per status group).
//
// Scope notes (deliberate omissions, honest-UI): no sort control inside the
// panel and no per-row menus — rows open the task via the shared detail
// drawer, where full editing lives.

import { useMemo, useState } from "react";
import { X } from "lucide-react";
import { ViewTab, ViewTabStrip } from "@/components/ui/view-tabs";
import { makeStatusLookup, type BoardItemRow, type StatusOption } from "@/lib/board-items-shared";
import { StatusGlyph } from "./status-glyph";

const MS_PER_DAY = 86_400_000;

interface GanttBacklogPanelProps {
  unscheduled: BoardItemRow[];
  overdue: Array<{ item: BoardItemRow; end: Date }>;
  statuses: StatusOption[];
  canEdit: boolean;
  onOpenItem?: (id: string) => void;
  /** One-click "Today" quick-schedule on an unscheduled row. */
  onScheduleToday: (id: string) => void;
  /** HTML5 DnD handoff — the Gantt lanes listen for the drop. */
  onDragStart: (id: string) => void;
  onDragEnd: () => void;
  onClose: () => void;
}

function CountBadge({ count }: { count: number }) {
  return (
    <span className="ml-1 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-zinc-100 px-1 text-[10px] font-semibold tabular-nums text-zinc-500">
      {count}
    </span>
  );
}

export function GanttBacklogPanel({
  unscheduled,
  overdue,
  statuses,
  canEdit,
  onOpenItem,
  onScheduleToday,
  onDragStart,
  onDragEnd,
  onClose,
}: GanttBacklogPanelProps) {
  const [tab, setTab] = useState<"unscheduled" | "overdue">("unscheduled");
  const statusLookup = useMemo(() => makeStatusLookup(statuses), [statuses]);
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();

  const rows = tab === "unscheduled" ? unscheduled : overdue.map((o) => o.item);
  const endById = useMemo(() => new Map(overdue.map((o) => [o.item.id, o.end])), [overdue]);

  return (
    <aside className="w-[260px] shrink-0 border-l border-zinc-200 bg-white flex flex-col">
      <div className="flex h-[44px] items-center justify-between border-b border-zinc-200 pl-3 pr-2">
        <span className="text-[12px] font-semibold text-zinc-800 dark:text-zinc-100">Tasks</span>
        <button
          type="button"
          aria-label="Close backlog"
          onClick={onClose}
          className="inline-flex h-6 w-6 items-center justify-center rounded-md text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>
      <ViewTabStrip className="px-2">
        <ViewTab
          label="Unscheduled"
          active={tab === "unscheduled"}
          onClick={() => setTab("unscheduled")}
          trailing={<CountBadge count={unscheduled.length} />}
        />
        <ViewTab
          label="Overdue"
          active={tab === "overdue"}
          onClick={() => setTab("overdue")}
          trailing={<CountBadge count={overdue.length} />}
        />
      </ViewTabStrip>
      {rows.length === 0 ? (
        <div className="px-3 py-8 text-center text-[11px] text-zinc-400">
          {tab === "unscheduled" ? "All tasks are scheduled" : "Nothing overdue"}
        </div>
      ) : (
        <ul className="flex-1 overflow-y-auto py-1">
          {rows.map((it) => {
            const end = endById.get(it.id);
            const daysLate = end ? Math.max(1, Math.floor((startOfToday - end.getTime()) / MS_PER_DAY)) : 0;
            return (
              <li key={it.id}>
                <div
                  draggable={canEdit && tab === "unscheduled"}
                  onDragStart={(e) => {
                    e.dataTransfer.effectAllowed = "move";
                    try { e.dataTransfer.setData("text/plain", it.id); } catch {}
                    onDragStart(it.id);
                  }}
                  onDragEnd={onDragEnd}
                  className={`group flex h-7 items-center gap-2 px-3 hover:bg-zinc-50 dark:hover:bg-white/5 ${
                    canEdit && tab === "unscheduled" ? "cursor-grab active:cursor-grabbing" : ""
                  }`}
                >
                  <StatusGlyph current={(it.status ? statusLookup[it.status] : null) ?? null} statuses={statuses} />
                  <button
                    type="button"
                    onClick={() => onOpenItem?.(it.id)}
                    className="min-w-0 flex-1 truncate text-left text-[12px] font-medium text-zinc-800 hover:text-[var(--os-brand-ink)]"
                    title={it.title}
                  >
                    {it.title}
                  </button>
                  {tab === "unscheduled" && canEdit ? (
                    <button
                      type="button"
                      onClick={() => onScheduleToday(it.id)}
                      title="Schedule for today"
                      className="h-5 rounded px-1.5 text-[10px] font-semibold text-zinc-400 opacity-0 transition-opacity group-hover:opacity-100 hover:bg-zinc-100 hover:text-zinc-700"
                    >
                      Today
                    </button>
                  ) : null}
                  {tab === "overdue" ? (
                    <span className="shrink-0 text-[10px] tabular-nums text-rose-500">{daysLate}d late</span>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </aside>
  );
}
