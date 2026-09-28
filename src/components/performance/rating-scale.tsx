"use client";

// RatingScale (spec-teams-performance section 3): a 1 to 5 segmented control
// (design-system 5.12). 32px track on --os-surface-1, radius 8, 2px padding;
// segments 14/500 ink-2; the chosen one on --os-surface with a 1px line and
// ink. The end words sit under the track. Arrow keys move, 1 to 5 jump. One
// place decides how a rating looks, so the self review, the manager review,
// candor prompts and survey questions never drift apart.

import { useId, useRef, type KeyboardEvent } from "react";
import { cn } from "@/lib/utils";

export function RatingScale({
  value,
  onChange,
  labels,
  size = "md",
  readOnly = false,
  name,
  ariaLabel,
  showEndWords = true,
}: {
  value?: number | null;
  onChange?: (next: 1 | 2 | 3 | 4 | 5) => void;
  /** The five words (Settings anchors or the built-in five). */
  labels?: readonly string[];
  size?: "md" | "sm";
  readOnly?: boolean;
  name: string;
  ariaLabel?: string;
  showEndWords?: boolean;
}) {
  const groupId = useId();
  const refs = useRef<Array<HTMLButtonElement | null>>([]);
  const words = labels && labels.length === 5 ? labels : null;
  const current = typeof value === "number" && value >= 1 && value <= 5 ? value : null;

  const pick = (n: number) => {
    if (readOnly || !onChange) return;
    onChange(n as 1 | 2 | 3 | 4 | 5);
    refs.current[n - 1]?.focus();
  };
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (readOnly) return;
    if (/^[1-5]$/.test(e.key)) { e.preventDefault(); pick(Number(e.key)); return; }
    const at = current ?? 0;
    if (e.key === "ArrowRight" || e.key === "ArrowUp") { e.preventDefault(); pick(Math.min(5, at + 1 || 1)); }
    if (e.key === "ArrowLeft" || e.key === "ArrowDown") { e.preventDefault(); pick(Math.max(1, at - 1 || 1)); }
  };

  // View only: the value as text in the control's place, never a row of
  // greyed segments that looks editable (principle 14).
  if (readOnly) {
    return (
      <p className="m-0 text-base text-ink" aria-label={ariaLabel ?? name}>
        {current == null
          ? <span className="text-ink-2">Not rated</span>
          : <><span className="font-medium tabular-nums">{current} of 5</span>{words ? <span className="text-ink-2">, {words[current - 1]}</span> : null}</>}
      </p>
    );
  }

  return (
    <div className="flex min-w-0 flex-col gap-1">
      <div
        role="radiogroup"
        aria-label={ariaLabel ?? name}
        aria-readonly={readOnly || undefined}
        onKeyDown={onKey}
        className={cn("inline-flex w-full max-w-[360px] rounded-lg bg-subtle p-0.5", size === "sm" ? "h-7" : "h-8")}
      >
        {[1, 2, 3, 4, 5].map((n) => {
          const on = current === n;
          return (
            <button
              key={n}
              ref={(el) => { refs.current[n - 1] = el; }}
              type="button"
              role="radio"
              aria-checked={on}
              aria-label={words ? `${n}, ${words[n - 1]}` : String(n)}
              title={words ? words[n - 1] : undefined}
              name={`${groupId}-${name}`}
              tabIndex={on || (current == null && n === 1) ? 0 : -1}
              disabled={readOnly && !on}
              onClick={() => pick(n)}
              className={cn(
                "min-w-0 flex-1 rounded-md text-sm font-medium tabular-nums outline-none focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--os-focus)]",
                on ? "border border-line bg-raised text-ink" : "text-ink-2 hover:text-ink",
                readOnly ? "cursor-default" : "",
              )}
            >
              {n}
            </button>
          );
        })}
      </div>
      {words && showEndWords ? (
        <div className="flex max-w-[360px] justify-between gap-2 text-xs text-ink-2">
          <span className="truncate">{words[0]}</span>
          {current ? <span className="truncate font-medium text-ink">{words[current - 1]}</span> : null}
          <span className="truncate text-end">{words[4]}</span>
        </div>
      ) : null}
    </div>
  );
}
