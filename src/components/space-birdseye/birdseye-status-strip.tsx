"use client";

// The status mix of one List, under its column header: a 4px bar, one segment
// per column with tasks in it, in the List's own status order, each as wide
// as its share. It counts exactly what the column pages through (the search
// and Hide closed included), so the true mix shows however few cards are
// loaded (review #14). Every segment is titled "<Status>: N" and the bar
// reads its counts aloud, so the mix is never carried by colour alone.

import type { StatusOption } from "@/lib/board-items-shared";
import { safeStatusColor } from "@/lib/work/birdseye";

export function BirdseyeStatusStrip({
  listName,
  statuses,
  statusCounts,
  total,
}: {
  listName: string;
  statuses: StatusOption[];
  statusCounts: Record<string, number>;
  total: number;
}) {
  const segments = statuses
    .map((s) => ({ s, n: statusCounts[s.value] ?? 0 }))
    .filter((seg) => seg.n > 0);
  const label =
    total === 0
      ? `${listName}: no tasks`
      : `${listName}: ${segments.map((seg) => `${seg.s.label} ${seg.n}`).join(", ")}`;
  return (
    <div role="img" aria-label={label} className="flex h-[4px] w-full gap-px overflow-hidden rounded-full bg-subtle">
      {segments.map(({ s, n }) => (
        <span
          key={s.value}
          title={`${s.label}: ${n}`}
          className="h-full min-w-[3px] rounded-full"
          style={{ flexGrow: n, flexBasis: 0, backgroundColor: safeStatusColor(s.color) }}
        />
      ))}
    </div>
  );
}
