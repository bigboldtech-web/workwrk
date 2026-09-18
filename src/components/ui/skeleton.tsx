import { cn } from "@/lib/utils";

/**
 * Skeleton primitive — Phase G refresh.
 *
 * Default treatment is a left-to-right shimmer instead of the flat
 * pulse. Reads as "we know what's coming" rather than "something
 * generic is loading" — premium feel for ~10 lines of CSS.
 *
 * Pulse stays available as a `<Skeleton variant="pulse" />` for
 * cases where shimmer is too busy (dense list rows, inline chips).
 */

interface SkeletonProps {
  className?: string;
  variant?: "shimmer" | "pulse";
}

export function Skeleton({ className, variant = "shimmer" }: SkeletonProps) {
  return (
    <div
      className={cn(
        "rounded-lg bg-surface-2 overflow-hidden",
        variant === "pulse" && "animate-pulse",
        variant === "shimmer" && "skeleton-shimmer",
        className,
      )}
    />
  );
}

/**
 * The loading state of a list, panel or drawer body (design-system 5.15,
 * spec-shell 1.6): bars at the row height, 60/40/80% wide, --os-skeleton,
 * one 1.6s opacity pulse. No dots, no spinner, no "Loading" text. This is
 * what replaced the in-page ValueLoader.
 */
export function SkeletonRows({ rows = 6, rowHeight = "var(--os-row-h)", className }: { rows?: number; rowHeight?: string; className?: string }) {
  const widths = ["60%", "40%", "80%"];
  return (
    <div className={cn("os-chrome", className)} aria-busy="true" aria-label="Loading">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex items-center border-b border-line-soft px-3 last:border-b-0" style={{ height: rowHeight }}>
          <span className="h-3.5 rounded bg-skeleton os-skeleton-pulse" style={{ width: widths[i % 3] }} />
        </div>
      ))}
    </div>
  );
}

/** Two or three text-line bars for a small panel, popover or card body. */
export function SkeletonLines({ lines = 3, className }: { lines?: number; className?: string }) {
  const widths = ["60%", "40%", "80%"];
  return (
    <div className={cn("os-chrome flex flex-col gap-2 py-2", className)} aria-busy="true" aria-label="Loading">
      {Array.from({ length: lines }).map((_, i) => (
        <span key={i} className="h-3 rounded bg-skeleton os-skeleton-pulse" style={{ width: widths[i % 3] }} />
      ))}
    </div>
  );
}

export function SkeletonCard() {
  return (
    <div className="rounded-xl border border-border bg-surface p-5 space-y-3">
      <Skeleton className="h-4 w-2/3" />
      <Skeleton className="h-3 w-1/2" />
      <Skeleton className="h-3 w-3/4" />
      <div className="flex gap-2 pt-2">
        <Skeleton className="h-6 w-16 rounded-full" />
        <Skeleton className="h-6 w-20 rounded-full" />
      </div>
    </div>
  );
}

export function SkeletonRow() {
  return (
    <div className="flex items-center gap-4 rounded-lg border border-border bg-surface p-4">
      <Skeleton className="h-10 w-10 rounded-full" />
      <div className="flex-1 space-y-2">
        <Skeleton className="h-4 w-1/3" />
        <Skeleton className="h-3 w-1/4" />
      </div>
      <Skeleton className="h-6 w-20 rounded-full" />
    </div>
  );
}

export function SkeletonTable({ rows = 5 }: { rows?: number }) {
  return (
    <div className="space-y-3">
      {Array.from({ length: rows }).map((_, i) => (
        <SkeletonRow key={i} />
      ))}
    </div>
  );
}

export function SkeletonGrid({ count = 6 }: { count?: number }) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
      {Array.from({ length: count }).map((_, i) => (
        <SkeletonCard key={i} />
      ))}
    </div>
  );
}

export function PageSkeleton() {
  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div className="space-y-2">
          <Skeleton className="h-7 w-48" />
          <Skeleton className="h-4 w-32" />
        </div>
        <Skeleton className="h-9 w-32 rounded-lg" />
      </div>
      <div className="flex gap-3">
        <Skeleton className="h-9 w-64 rounded-lg" />
        <Skeleton className="h-9 w-24 rounded-lg" />
      </div>
      <SkeletonGrid />
    </div>
  );
}
