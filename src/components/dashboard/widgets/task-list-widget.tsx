"use client";

// TaskListWidget — mini task rows from the widget's source: status dot,
// truncated title linking into /item/[id], assignee initials, short due
// date (overdue = red). Capped at 8 rows with an "N more" footer.

import Link from "next/link";
import { Loader2 } from "lucide-react";
import { STATUS_LOOKUP } from "@/lib/board-items-shared";
import type { DashWidget } from "../widget-types";
import { isItemOverdue, useWidgetItems, type WidgetItem } from "./use-widget-items";

const ROW_CAP = 8;
const FALLBACK_DOT = "#94a3b8";

function shortDue(dueAt: string): string {
  const d = new Date(dueAt);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function initials(owner: NonNullable<WidgetItem["owner"]>): string {
  return `${owner.firstName?.[0] ?? ""}${owner.lastName?.[0] ?? ""}`.toUpperCase() || "?";
}

export function TaskListWidget({ widget }: { widget: DashWidget }) {
  const { items, loading, error } = useWidgetItems(widget.config.source);

  if (loading) {
    return (
      <div className="flex h-full min-h-[72px] items-center justify-center">
        <Loader2 className="h-4 w-4 animate-spin text-zinc-300" />
      </div>
    );
  }
  if (error) {
    return (
      <div className="flex h-full min-h-[72px] items-center justify-center text-[13px] text-zinc-400">
        Couldn&apos;t load tasks
      </div>
    );
  }
  const list = items ?? [];
  if (list.length === 0) {
    return (
      <div className="flex h-full min-h-[72px] items-center justify-center text-[13px] text-zinc-400">
        No tasks here yet
      </div>
    );
  }

  const rows = list.slice(0, ROW_CAP);
  const more = list.length - rows.length;

  return (
    <div className="flex h-full flex-col">
      <ul className="min-h-0 flex-1 overflow-y-auto">
        {rows.map((it) => {
          const overdue = isItemOverdue(it);
          return (
            <li key={it.id} className="flex h-7 items-center gap-2 border-b border-zinc-100 last:border-b-0">
              <span
                aria-hidden
                className="h-2 w-2 shrink-0 rounded-full"
                style={{ background: (it.status && STATUS_LOOKUP[it.status]?.color) || FALLBACK_DOT }}
              />
              <Link
                href={`/item/${it.id}`}
                className="min-w-0 flex-1 truncate text-[13.5px] text-zinc-800 hover:text-zinc-950 hover:underline"
              >
                {it.title}
              </Link>
              {it.owner ? (
                <span
                  title={`${it.owner.firstName} ${it.owner.lastName}`.trim()}
                  className="grid h-5 w-5 shrink-0 place-items-center rounded-full bg-zinc-100 text-[10px] font-semibold text-zinc-600"
                >
                  {initials(it.owner)}
                </span>
              ) : null}
              {it.dueAt ? (
                <span className={`w-12 shrink-0 text-right text-[12px] ${overdue ? "font-medium text-red-600" : "text-zinc-400"}`}>
                  {shortDue(it.dueAt)}
                </span>
              ) : null}
            </li>
          );
        })}
      </ul>
      {more > 0 ? (
        <div className="shrink-0 pt-1 text-[12px] text-zinc-400">{more} more</div>
      ) : null}
    </div>
  );
}
