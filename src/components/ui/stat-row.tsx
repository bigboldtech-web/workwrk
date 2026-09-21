// StatRow (spec-process section 3): the one stat-row design shared by SOP
// compliance, Policy compliance and the acknowledgement ledger, replacing
// four KPI-tile drawings. A row of bordered cards: --os-surface, 1px
// --os-line, radius 8, padding 16; label 13/500 --os-ink-2, value 22/600
// --os-ink tabular, an optional 13/400 sub-line. No accent bars, no icons,
// no colour on the value: a 6px status dot beside a WORD in the sub-line is
// the only semantic colour allowed (danger for "overdue" when above zero).
//
// Server-safe: no hooks.

import { Dots } from "@/components/ui/dots";
import { SkeletonRows } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

export interface StatCard {
  label: string;
  /** Already formatted ("38 of 42", "90%", "12"). */
  value: string;
  sub?: string;
  /** A *.solid token beside the sub-line word, when the figure means something. */
  dot?: "danger" | "success" | "warning";
}

export function StatRow({ cards, loading, className }: { cards: StatCard[]; loading?: boolean; className?: string }) {
  return (
    <div className={cn("grid gap-3", cards.length >= 4 ? "sm:grid-cols-2 lg:grid-cols-4" : "sm:grid-cols-3", className)} role="list">
      {cards.map((c) => (
        <div key={c.label} role="listitem" className="flex min-h-[92px] flex-col gap-1 rounded-lg border border-line bg-raised p-4">
          <span className="text-sm font-medium text-ink-2">{c.label}</span>
          {loading ? (
            <SkeletonRows rows={1} rowHeight="28px" />
          ) : (
            <span className="text-xl font-semibold tabular-nums text-ink">{c.value}</span>
          )}
          {c.sub ? (
            <span className="inline-flex items-center gap-1.5 text-sm text-ink-2">
              {c.dot ? <Dots variant="status" color={`var(--os-${c.dot}-solid)`} /> : null}
              {c.sub}
            </span>
          ) : null}
        </div>
      ))}
    </div>
  );
}
