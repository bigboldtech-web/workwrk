"use client";

// The one 2D scroller of a Bird's eye mode. It is the only element with
// horizontal overflow (every flex parent above it is min-w-0), so the page
// itself never scrolls sideways however many columns there are. The column
// headers are ONE sticky row, so they stay put while the cards scroll under
// them, and they scroll sideways with their columns.
//
// Cards are list items with content-visibility auto and an intrinsic size,
// set PER CARD (in BirdseyeCard), not per column: an off-screen card keeps
// an estimated, then remembered, height, so the scroll extent never collapses
// and an offset restored after focus mode never clamps (review #19).
//
// On a phone the columns snap. The snap line is the scroller's scroll
// padding, not its content padding, so the scroller carries the gutter's
// 24px too: without it the first column snapped flush against the rail.

import { forwardRef, type ReactNode } from "react";

export const COLUMN_WIDTH = "w-[min(280px,calc(100vw-48px))]";

export interface GridColumn {
  key: string;
  label: string;
  header: ReactNode;
  body: ReactNode;
  /** Drop handlers, for focus mode's status columns. */
  dropProps?: React.HTMLAttributes<HTMLElement>;
  highlighted?: boolean;
}

export const BirdseyeGrid = forwardRef<HTMLDivElement, { columns: GridColumn[]; label: string }>(function BirdseyeGrid(
  { columns, label },
  ref,
) {
  return (
    <div
      ref={ref}
      className="min-h-0 min-w-0 flex-1 overflow-auto max-sm:snap-x max-sm:snap-mandatory max-sm:scroll-px-6"
      aria-label={label}
    >
      <div className="inline-flex min-w-full flex-col px-6 pb-6">
        <div className="sticky top-0 z-10 flex gap-3 border-b border-line-soft bg-app pb-2 pt-1">
          {columns.map((c) => (
            <div key={c.key} className={`${COLUMN_WIDTH} shrink-0 snap-start`}>
              {c.header}
            </div>
          ))}
        </div>
        <div className="flex items-start gap-3 pt-2">
          {columns.map((c) => (
            <section
              key={c.key}
              aria-label={c.label}
              className={`${COLUMN_WIDTH} shrink-0 snap-start rounded-lg transition-colors ${c.highlighted ? "bg-hover" : ""}`}
              {...c.dropProps}
            >
              {c.body}
            </section>
          ))}
        </div>
      </div>
    </div>
  );
});
