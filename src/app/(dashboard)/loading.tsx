// Route-transition loader (spec-shell 2.2, design-system 5.15). While the
// next page suspends: the skeleton page header (title row, views row,
// toolbar, the same drawing a page shows while it fetches its object) and
// eight skeleton rows at the data-row height, with one 13px value line under
// the first row. The rail's logo dots pulse (after 200ms, through
// RoutePendingSignal); rail, sidebar and bar stay interactive. No overlay,
// no progress line, no in-content four dots.

import { ValueLine } from "@/components/brand/value-line";
import { OsPageHeaderSkeleton } from "@/components/layout/os/page-header";
import { RoutePendingSignal } from "@/components/layout/os/route-pending";

const BAR = "rounded bg-skeleton os-skeleton-pulse";

export default function Loading() {
  return (
    <div aria-busy="true" aria-label="Loading">
      <RoutePendingSignal />
      <OsPageHeaderSkeleton views toolbar />
      <div className="os-chrome mt-2 px-6">
        <div className="rounded-lg border border-line">
          {["60%", "40%", "80%", "60%", "40%", "80%", "60%", "40%"].map((w, i) => (
            <div key={i} className="flex flex-col justify-center border-b border-line-soft px-3 last:border-b-0" style={{ height: "var(--os-row-h)" }}>
              <span className={`${BAR} h-3.5`} style={{ width: w }} />
              {i === 0 ? <ValueLine className="mt-2" /> : null}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
