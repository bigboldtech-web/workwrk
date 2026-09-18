"use client";

// SegmentedControl (design-system 5.12): 2 to 4 exclusive options for a
// setting (Theme, Chrome, Density). 32px, `--os-surface-1` track radius 8
// with 2px padding, segments 14/500 `--os-ink-2`, the active segment
// `--os-surface` with a 1px `--os-line` border, radius 6 and `--os-ink`.
// Arrow keys move between segments; there is no roving blue. When locked
// the control is greyed with a lock glyph and "Set by your workspace".

import { useId, useRef } from "react";
import { Lock } from "lucide-react";
import { cn } from "@/lib/utils";

export interface SegmentedOption<T extends string> {
  value: T;
  label: string;
}

export function SegmentedControl<T extends string>({
  value,
  options,
  onChange,
  label,
  locked,
  lockedHint = "Set by your workspace",
  className,
  size = "md",
}: {
  value: T;
  options: SegmentedOption<T>[];
  onChange: (v: T) => void;
  /** Accessible name for the group. */
  label: string;
  locked?: boolean;
  lockedHint?: string;
  className?: string;
  size?: "md" | "sm";
}) {
  const id = useId();
  const refs = useRef<Array<HTMLButtonElement | null>>([]);
  const idx = Math.max(0, options.findIndex((o) => o.value === value));

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (locked) return;
    let next = -1;
    if (e.key === "ArrowRight" || e.key === "ArrowDown") next = (idx + 1) % options.length;
    else if (e.key === "ArrowLeft" || e.key === "ArrowUp") next = (idx - 1 + options.length) % options.length;
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = options.length - 1;
    if (next < 0) return;
    e.preventDefault();
    onChange(options[next].value);
    refs.current[next]?.focus();
  };

  return (
    <div className={cn("inline-flex items-center gap-2", className)}>
      <div
        role="radiogroup"
        aria-label={label}
        aria-disabled={locked || undefined}
        onKeyDown={onKeyDown}
        className={cn(
          "inline-flex items-center rounded-lg bg-subtle p-0.5",
          size === "md" ? "h-8" : "h-7",
          locked && "opacity-60",
        )}
      >
        {options.map((o, i) => {
          const selected = o.value === value;
          return (
            <button
              key={o.value}
              ref={(el) => { refs.current[i] = el; }}
              type="button"
              role="radio"
              aria-checked={selected}
              id={`${id}-${o.value}`}
              tabIndex={selected ? 0 : -1}
              disabled={locked}
              onClick={() => { if (!locked && !selected) onChange(o.value); }}
              className={cn(
                "h-full rounded-md px-3 text-base font-medium transition-colors",
                selected ? "border border-line bg-raised text-ink" : "border border-transparent text-ink-2 hover:text-ink",
                locked && "cursor-not-allowed",
              )}
            >
              {o.label}
            </button>
          );
        })}
      </div>
      {locked ? (
        <span className="inline-flex items-center gap-1 text-xs text-ink-2" title={lockedHint}>
          <Lock className="h-3.5 w-3.5" strokeWidth={1.5} aria-hidden />
          {lockedHint}
        </span>
      ) : null}
    </div>
  );
}
