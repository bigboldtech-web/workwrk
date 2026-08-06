"use client";

// WidgetCard — the shared ClickUp-parity chrome every dashboard widget rides
// in: white card, 13px semibold title, hover drag-grip + "..." cluster.
// StatCard is the number-tile variant (Open Tasks / Total Tasks style).

import { type ReactNode } from "react";
import { GripVertical, MoreHorizontal, RefreshCw } from "lucide-react";

export function WidgetCard({
  title,
  onRefresh,
  onMore,
  children,
}: {
  title: string;
  onRefresh?: () => void;
  onMore?: () => void;
  children: ReactNode;
}) {
  return (
    <div className="group relative flex flex-col rounded-lg border border-zinc-200 bg-white shadow-sm">
      <div className="flex items-center gap-1.5 px-3 pt-2.5 pb-1">
        <GripVertical className="h-3.5 w-3.5 shrink-0 cursor-grab text-zinc-300 opacity-0 transition-opacity group-hover:opacity-100" />
        <span className="truncate text-[13px] font-semibold text-zinc-900">{title}</span>
        <span className="ml-auto flex items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
          {onRefresh ? (
            <button
              type="button"
              onClick={onRefresh}
              aria-label="Refresh card"
              className="inline-flex h-6 w-6 items-center justify-center rounded-md text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700"
            >
              <RefreshCw className="h-3.5 w-3.5" />
            </button>
          ) : null}
          {onMore ? (
            <button
              type="button"
              onClick={onMore}
              aria-label="Card options"
              className="inline-flex h-6 w-6 items-center justify-center rounded-md text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700"
            >
              <MoreHorizontal className="h-3.5 w-3.5" />
            </button>
          ) : null}
        </span>
      </div>
      <div className="flex-1 px-3 pb-3">{children}</div>
    </div>
  );
}

export function StatCard({ label, value }: { label: string; value: ReactNode }) {
  return (
    <WidgetCard title={label}>
      <div className="flex h-full min-h-[72px] items-center justify-center">
        <span className="text-[28px] font-semibold leading-none text-zinc-900">{value}</span>
      </div>
    </WidgetCard>
  );
}
