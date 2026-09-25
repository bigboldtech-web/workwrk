"use client";

// The List card's body: an embedded List view, the first tasks that match
// the card's filter in the card's sort. Each row is the task row every List
// draws in miniature: status dot, title, the List it is shown under (the
// readable List the task is in scope through, never a home the viewer cannot
// read), due date, priority flag and assignees. A row opens the task drawer
// through openTask, the one door into a task.

import { useRouter } from "next/navigation";
import type { WidgetResult } from "@/lib/dashboards/widget-data";
import { openTask } from "@/lib/nav/open-task";
import { useFormat } from "@/lib/format/use-date-prefs";
import { AvatarStack } from "@/components/ui/avatar-stack";
import { PriorityFlag } from "@/components/board-view/priority-picker";
import { cn } from "@/lib/utils";

type ListResult = Extract<WidgetResult, { kind: "list" }>;

export function ListBody({ result }: { result: ListResult }) {
  const router = useRouter();
  const fmt = useFormat();
  if (result.rows.length === 0) {
    return <div className="flex h-full items-center justify-center text-sm text-ink-2">No tasks match</div>;
  }
  const more = Math.max(0, result.total - result.rows.length);
  const now = Date.now();
  return (
    <div className="flex h-full min-h-0 flex-col">
      <ul className="min-h-0 flex-1 overflow-y-auto">
        {result.rows.map((row) => {
          const overdue = !row.done && !!row.dueAt && new Date(row.dueAt).getTime() < now;
          return (
            <li key={row.id}>
              <button
                type="button"
                onClick={() => openTask(router, row.id)}
                className="widget-no-drag flex h-9 w-full min-w-0 items-center gap-2 rounded-md px-2 text-start hover:bg-hover"
              >
                <span
                  className="inline-block h-2 w-2 shrink-0 rounded-full"
                  style={{ backgroundColor: row.statusColor ?? "var(--os-ink-3)" }}
                  title={row.statusLabel ?? undefined}
                  aria-label={row.statusLabel ? `Status ${row.statusLabel}` : undefined}
                />
                <span className={cn("min-w-0 truncate text-base text-ink", row.done && "text-ink-2 line-through")}>{row.title || "Untitled task"}</span>
                {row.list.name ? <span className="hidden min-w-0 shrink truncate text-xs text-ink-3 sm:inline">{row.list.name}</span> : null}
                <span className="flex-1" />
                {row.dueAt ? (
                  <span className={cn("shrink-0 text-xs tabular-nums", overdue ? "text-danger-text" : "text-ink-2")} title={fmt.title(row.dueAt)}>
                    {fmt.date(row.dueAt, "date")}
                  </span>
                ) : null}
                {row.priority ? (
                  <span className="shrink-0">
                    <PriorityFlag value={row.priority} showLabel={false} />
                  </span>
                ) : null}
                <AvatarStack people={row.assignees ?? []} size={20} max={3} className="shrink-0" />
              </button>
            </li>
          );
        })}
      </ul>
      {more > 0 ? <p className="m-0 shrink-0 px-2 pt-1 text-xs text-ink-2">{fmt.count(more)} more</p> : null}
    </div>
  );
}
