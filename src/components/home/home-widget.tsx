"use client";

// HomeWidget: the frame every Home widget draws inside.
//
// Spec: docs/plans/ui-refresh/spec-work-home.md section 3 (`HomeWidget`) and
// design-system section 5.8 (Home widgets): "--os-surface, 1px solid
// var(--os-line), radius 12, a 60px header strip in --os-widget-head-bg
// holding the title 15/500 --os-ink and one 20px --os-ink-2 icon (icons only,
// no secondary text in the strip), then the body. Each widget body is a list
// of rows at --os-row-h with hairlines --os-line-soft, and a 44px footer row
// holding one text link 14/500 --os-brand-deep."
//
// THE THREE STATES ARE THE POINT. The grid this replaces had eleven cards,
// seven of which rendered hard-coded sentences whether or not anything was
// behind them ("There is no recorded activity for {firstName} in the last 7
// days" was a string, not a query), and four of which showed an empty list
// when their fetch failed. So this frame makes all three states explicit and
// none of them optional:
//
//   loading   skeleton rows inside the body, header strip already drawn
//   error     one inline "Couldn't load · Retry" line, never an empty list
//   empty     the quiet template: a four-dot line, one sentence, at most one link
//
// A widget cannot render "nothing to do" when the truth is "we did not manage
// to ask".

import Link from "next/link";
import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { DotsArt } from "@/components/ui/dots-art";

export interface HomeWidgetProps {
  title: string;
  icon: LucideIcon;
  /** One text link at the foot. Omitted when there is nowhere useful to go. */
  footer?: { label: string; href: string } | { label: string; onClick: () => void };
  /** Drawn in place of the body when `isEmpty`. */
  empty?: { sentence: string; link?: { label: string; href: string } | { label: string; onClick: () => void } };
  isEmpty?: boolean;
  loading?: boolean;
  /** Present when the fetch failed. The retry re-fetches THIS widget only. */
  error?: { retry: () => void };
  /** How many skeleton rows to draw while loading. */
  skeletonRows?: number;
  className?: string;
  children?: ReactNode;
}

export function HomeWidget({
  title,
  icon: Icon,
  footer,
  empty,
  isEmpty,
  loading,
  error,
  skeletonRows = 3,
  className,
  children,
}: HomeWidgetProps) {
  return (
    <section
      className={cn(
        "os-row flex min-w-0 flex-col overflow-hidden rounded-xl border border-line bg-raised",
        className,
      )}
      aria-label={title}
    >
      <header className="flex h-[60px] shrink-0 items-center gap-2 border-b border-line-soft bg-subtle px-4">
        <Icon className="h-5 w-5 shrink-0 text-ink-2" strokeWidth={1.5} aria-hidden />
        <h2 className="min-w-0 flex-1 truncate font-medium text-ink">{title}</h2>
      </header>

      <div className="min-w-0 flex-1">
        {loading ? (
          <WidgetSkeleton rows={skeletonRows} />
        ) : error ? (
          <div className="flex items-center gap-2 px-4 py-5 text-sm text-ink-2">
            <span>Couldn&rsquo;t load</span>
            <span aria-hidden>·</span>
            <button type="button" onClick={error.retry} className="font-medium text-brand-deep hover:underline">
              Retry
            </button>
          </div>
        ) : isEmpty ? (
          <WidgetEmpty empty={empty} />
        ) : (
          children
        )}
      </div>

      {footer && !loading && !error ? (
        <div className="flex h-11 shrink-0 items-center border-t border-line-soft px-4">
          {"href" in footer ? (
            <Link href={footer.href} className="text-base font-medium text-brand-deep hover:underline">
              {footer.label}
            </Link>
          ) : (
            <button
              type="button"
              onClick={footer.onClick}
              className="text-base font-medium text-brand-deep hover:underline"
            >
              {footer.label}
            </button>
          )}
        </div>
      ) : null}
    </section>
  );
}

function WidgetSkeleton({ rows }: { rows: number }) {
  return (
    <div aria-busy="true" aria-label="Loading" className="px-4 py-2">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex h-11 items-center gap-3">
          <span className="os-skeleton-pulse h-3.5 w-3.5 shrink-0 rounded bg-skeleton" />
          <span
            className="os-skeleton-pulse h-3.5 rounded bg-skeleton"
            style={{ width: `${[68, 44, 56, 50, 62][i % 5]}%` }}
          />
        </div>
      ))}
    </div>
  );
}

function WidgetEmpty({ empty }: { empty?: HomeWidgetProps["empty"] }) {
  if (!empty) return null;
  return (
    <div className="flex flex-col items-center justify-center gap-2 px-4 py-8 text-center">
      <DotsArt arrangement="row" size={64} />
      <p className="text-base text-ink-2">{empty.sentence}</p>
      {empty.link ? (
        "href" in empty.link ? (
          <Link href={empty.link.href} className="text-base font-medium text-brand-deep hover:underline">
            {empty.link.label}
          </Link>
        ) : (
          <button
            type="button"
            onClick={empty.link.onClick}
            className="text-base font-medium text-brand-deep hover:underline"
          >
            {empty.link.label}
          </button>
        )
      ) : null}
    </div>
  );
}

/**
 * The plain group header inside a widget body (design-system 5.1): a word, a
 * count, and never a coloured bar. `tone="danger"` is the ONE semantic colour
 * on the Home page, and it is always paired with the word "Overdue" so the
 * meaning does not live in the colour alone.
 */
export function WidgetGroupHeader({ label, count, tone }: { label: string; count?: number; tone?: "danger" }) {
  return (
    <div className="flex h-8 items-center gap-2 bg-subtle px-4">
      <span className="font-medium text-ink">{label}</span>
      {typeof count === "number" && count > 0 ? (
        <span className={cn("text-xs font-medium", tone === "danger" ? "text-danger-text" : "text-ink-2")}>{count}</span>
      ) : null}
    </div>
  );
}
