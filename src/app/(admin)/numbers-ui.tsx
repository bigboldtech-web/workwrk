"use client";

// The pieces Overview and Analytics share (spec-admin-backoffice 2.1, 2.5):
// the card (radius 8, 1px line, no shadow), its skeleton, the per-card
// failure row, the "not connected" block for billing, the title-row meta that
// turns red and offers Retry when a refresh failed, and a 4px bar. Built on
// the design system's tokens and DotsArt; no new visual primitive.

import type { ReactNode } from "react";
import { DotsArt, type DotsArrangement } from "@/components/ui/dots-art";
import { formatRelative, type DateFormatPrefs } from "@/lib/format/date";
import { cn } from "@/lib/utils";
import { InlineRetry, TEXT_LINK, UpdatedMeta } from "./console-ui";

export function NumbersCard({
  title,
  meta,
  children,
  className,
  ariaLabel,
}: {
  title?: ReactNode;
  meta?: ReactNode;
  children: ReactNode;
  className?: string;
  ariaLabel?: string;
}) {
  return (
    <section aria-label={ariaLabel} className={cn("os-chrome min-w-0 rounded-lg border border-line bg-raised p-4", className)}>
      {title ? (
        <header className="mb-3 flex min-w-0 items-center justify-between gap-3">
          <h2 className="m-0 truncate text-lg font-semibold text-ink">{title}</h2>
          {meta ? <div className="shrink-0 text-sm text-ink-2">{meta}</div> : null}
        </header>
      ) : null}
      {children}
    </section>
  );
}

/** Skeleton bars at a block's own height: 60/40/80% widths, one pulse. */
export function SkeletonBars({ rows = 3, height = 12, gap = 10 }: { rows?: number; height?: number; gap?: number }) {
  const widths = ["60%", "40%", "80%"];
  return (
    <div className="flex flex-col" style={{ gap }} aria-hidden>
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="animate-pulse rounded bg-[var(--os-skeleton)]" style={{ height, width: widths[i % widths.length], animationDuration: "1.6s" }} />
      ))}
    </div>
  );
}

/** A card body that failed: "Could not load this. Retry". Never an empty state in its place. */
export function CardRetry({ onRetry }: { onRetry: () => void }) {
  return (
    <div role="alert" className="py-1">
      <InlineRetry text="Could not load this." onRetry={onRetry} />
    </div>
  );
}

/** The quiet block: four-dot line art and one sentence, with an optional text link. */
export function QuietBlock({
  sentence,
  arrangement = "grid",
  link,
  height,
}: {
  sentence: string;
  arrangement?: DotsArrangement;
  link?: { label: string; href: string } | null;
  height?: number;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 text-center" style={height ? { minHeight: height } : undefined}>
      <DotsArt arrangement={arrangement} size={56} />
      <p className="m-0 text-row text-ink-2">{sentence}</p>
      {link ? (
        <a href={link.href} target="_blank" rel="noopener noreferrer" className={cn("text-base", TEXT_LINK)}>
          {link.label}
        </a>
      ) : null}
    </div>
  );
}

/** "How to connect it", only when a runbook is configured (no variable name ever appears on screen). */
export function connectLink(runbookUrl: string | null): { label: string; href: string } | null {
  return runbookUrl ? { label: "How to connect it", href: runbookUrl } : null;
}

/**
 * The title row's meta: "Updated {relative}", or, when the last refresh
 * failed and the page still shows older numbers, the same words in the
 * danger ink with Retry.
 */
export function NumbersMeta({ at, failed, prefs, onRetry }: { at: number | null; failed: boolean; prefs: DateFormatPrefs; onRetry: () => void }) {
  if (failed && at) {
    return (
      <span className="inline-flex items-center gap-1 whitespace-nowrap text-xs font-medium text-danger-text">
        Updated {formatRelative(at, prefs)}
        <button type="button" onClick={onRetry} className={TEXT_LINK}>Retry</button>
      </span>
    );
  }
  return <UpdatedMeta at={at} prefs={prefs} />;
}

/** A 4px bar in the one blue, relative to the largest row. */
export function Bar4({ pct, label }: { pct: number; label?: string }) {
  return (
    <div className="h-1 w-full overflow-hidden rounded-full bg-hover" role={label ? "img" : undefined} aria-label={label}>
      <div className="h-full rounded-full bg-brand" style={{ width: `${Math.max(0, Math.min(100, pct))}%` }} />
    </div>
  );
}
