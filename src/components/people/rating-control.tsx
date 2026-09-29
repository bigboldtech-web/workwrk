"use client";

// RatingControl (spec-teams-people section 3): a five-option segmented
// control, 1 to 5, with the word "{n}/5" beside it. Never dots without a
// number, so a rating always reads as text.

import { cn } from "@/lib/utils";

export function RatingControl({
  value,
  onChange,
  label,
  className,
}: {
  value: number | null;
  onChange: (n: number) => void;
  /** Accessible name for the group ("Self rating"). */
  label: string;
  className?: string;
}) {
  return (
    <div className={cn("flex items-center gap-3", className)}>
      <div role="radiogroup" aria-label={label} className="inline-flex rounded-md border border-line bg-raised p-0.5">
        {[1, 2, 3, 4, 5].map((n) => {
          const on = value === n;
          return (
            <button
              key={n}
              type="button"
              role="radio"
              aria-checked={on}
              aria-label={`${n} of 5`}
              onClick={() => onChange(n)}
              onKeyDown={(e) => {
                if (e.key === "ArrowRight" || e.key === "ArrowUp") { e.preventDefault(); onChange(Math.min(5, (value ?? 0) + 1)); }
                if (e.key === "ArrowLeft" || e.key === "ArrowDown") { e.preventDefault(); onChange(Math.max(1, (value ?? 2) - 1)); }
              }}
              tabIndex={on || (value == null && n === 1) ? 0 : -1}
              className={cn(
                "h-8 w-9 rounded text-sm font-medium tabular-nums",
                on ? "bg-brand-soft text-brand-deep" : "text-ink-2 hover:bg-hover hover:text-ink",
              )}
            >
              {n}
            </button>
          );
        })}
      </div>
      <span className="text-sm tabular-nums text-ink-2">{value ? `${value}/5` : "Not rated"}</span>
    </div>
  );
}
