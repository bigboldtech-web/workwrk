"use client";

// The first load of Bird's eye: the columns it is about to draw, as bars at
// the size of the real header and cards. No spinner and no "Loading" words
// (spec-shell 1.6); the columns are the same width and gap as the grid's.

const CARD_HEIGHTS = [72, 56, 88, 64];

export function BirdseyeSkeleton({ columns = 5 }: { columns?: number }) {
  return (
    <div className="min-h-0 flex-1 overflow-hidden px-6 pt-2" aria-busy="true" aria-label="Loading the bird's eye view">
      <div className="flex gap-3">
        {Array.from({ length: columns }).map((_, i) => (
          <div key={i} className="flex w-[min(280px,calc(100vw-48px))] shrink-0 flex-col gap-2">
            <div className="flex h-10 items-center gap-2 border-b border-line-soft">
              <span className="h-[18px] w-[18px] rounded-md bg-skeleton os-skeleton-pulse" />
              <span className="h-3.5 rounded bg-skeleton os-skeleton-pulse" style={{ width: `${40 + ((i * 17) % 35)}%` }} />
            </div>
            <span className="h-[4px] w-full rounded-full bg-skeleton os-skeleton-pulse" />
            {CARD_HEIGHTS.slice(0, 2 + (i % 3)).map((h, j) => (
              <span key={j} className="w-full rounded-lg bg-skeleton os-skeleton-pulse" style={{ height: h }} />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
