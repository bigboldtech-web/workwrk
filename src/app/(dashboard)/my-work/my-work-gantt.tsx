"use client";

// My work's Gantt and Timeline: the List page's own renderers, borrowed.
//
// The retired /tasks/gantt page drew every task assigned to you on one
// cross-List timeline (14-day window nav, month headers, a today pill and a
// Status + Priority legend). Rather than a second Gantt, this hands the same
// Item rows to `BoardGanttView` and `BoardTimelineView` (the renderers behind
// a List's Gantt and Timeline tabs) through `toBoardRows`, so there is one
// Gantt in the product: the window stepper, the Today pill, the zoom stack,
// the month band and the drag-to-reschedule bars are all the List page's.
//
// What a cross-List page cannot offer is the List-scoped chrome: there is no
// "+ Add Task" lane (which List would it go to?) and no per-List custom date
// field to fall back on for undated rows, so both are simply absent. The
// legend the old page carried is drawn above the chart from the statuses the
// rows actually use, because a bar's colour is its status and a reader has to
// be able to decode it without opening every task.

import { useMemo } from "react";
import { useRouter } from "next/navigation";
import { Flag } from "lucide-react";
import { BoardGanttView } from "@/components/board-view/board-gantt-view";
import { BoardTimelineView } from "@/components/board-view/board-timeline-view";
import { PRIORITY_LABEL, PRIORITY_ORDER, statusOptionsFrom, toBoardRows, type MyWorkRow } from "@/lib/my-work";
import { openTask } from "@/lib/nav/open-task";

function Legend({ rows }: { rows: readonly MyWorkRow[] }) {
  const statuses = useMemo(() => statusOptionsFrom(rows), [rows]);
  return (
    <div className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-ink-2" aria-label="Legend">
      {statuses.length > 0 ? (
        <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <span className="font-medium uppercase tracking-wide text-ink-3">Status</span>
          {statuses.map((s) => (
            <span key={s.value} className="inline-flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: s.color }} aria-hidden />
              {s.label}
            </span>
          ))}
        </span>
      ) : null}
      <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="font-medium uppercase tracking-wide text-ink-3">Priority</span>
        {PRIORITY_ORDER.map((p) => (
          <span key={p} className="inline-flex items-center gap-1">
            <Flag
              className={
                p === "URGENT"
                  ? "h-3.5 w-3.5 text-danger-text"
                  : p === "HIGH"
                    ? "h-3.5 w-3.5 fill-current text-ink"
                    : p === "NORMAL"
                      ? "h-3.5 w-3.5 text-ink-2"
                      : "h-3.5 w-3.5 text-ink-3"
              }
              strokeWidth={1.5}
              aria-hidden
            />
            {PRIORITY_LABEL[p]}
          </span>
        ))}
      </span>
    </div>
  );
}

export function MyWorkGantt({
  rows,
  canEdit = true,
  onChanged,
}: {
  rows: readonly MyWorkRow[];
  /** False when any row on the page is read-only (Everything at Can view). */
  canEdit?: boolean;
  /** After a drag or a date write: the page re-reads its rows. */
  onChanged: () => void;
}) {
  const router = useRouter();
  const items = useMemo(() => toBoardRows(rows), [rows]);
  const statuses = useMemo(() => statusOptionsFrom(rows), [rows]);
  return (
    <div>
      <Legend rows={rows} />
      <BoardGanttView
        initialItems={items}
        statuses={statuses}
        canEdit={canEdit}
        onOpenItem={(id) => openTask(router, id)}
        onItemChanged={onChanged}
        onItemRemoved={onChanged}
        timeTrackingEnabled={false}
      />
    </div>
  );
}

export function MyWorkTimeline({
  rows,
  canEdit = true,
  onChanged,
}: {
  rows: readonly MyWorkRow[];
  canEdit?: boolean;
  onChanged: () => void;
}) {
  const router = useRouter();
  const items = useMemo(() => toBoardRows(rows), [rows]);
  const statuses = useMemo(() => statusOptionsFrom(rows), [rows]);
  return (
    <div>
      <Legend rows={rows} />
      <BoardTimelineView
        initialItems={items}
        statuses={statuses}
        canEdit={canEdit}
        onOpenItem={(id) => openTask(router, id)}
        onItemCreated={onChanged}
        onItemRemoved={onChanged}
        timeTrackingEnabled={false}
      />
    </div>
  );
}
