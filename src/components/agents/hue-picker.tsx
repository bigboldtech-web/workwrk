"use client";

// A teammate's colour (docs/plans/ai-teammates.md 5.5): the eight user hues
// of design-system 1.7 as swatches, one radio group, each swatch named by
// its hue ("Sky", "Teal"). The fill is the hue's token (hues.ts hueColor),
// set inline: the shell's button reset outranks a background class (the
// Switch's note). Arrow keys move the choice, as SegmentedControl's do.

import { useRef, type KeyboardEvent } from "react";
import { Check } from "lucide-react";
import { TEAMMATE_HUES, hueColor, type TeammateHue } from "@/lib/agents/hues";
import { HUE_LABEL } from "@/lib/agents/teammate-copy";
import { cn } from "@/lib/utils";

export function HuePicker({
  value,
  onChange,
  label,
  disabled = false,
}: {
  /** Null: none chosen yet (an agent made before teammates). */
  value: TeammateHue | null;
  onChange: (hue: TeammateHue) => void;
  /** The group's accessible name. */
  label: string;
  disabled?: boolean;
}) {
  const refs = useRef<Array<HTMLButtonElement | null>>([]);
  const at = value ? TEAMMATE_HUES.indexOf(value) : -1;

  function onKeyDown(e: KeyboardEvent) {
    if (disabled) return;
    const from = Math.max(0, at);
    let next = -1;
    if (e.key === "ArrowRight" || e.key === "ArrowDown") next = (from + 1) % TEAMMATE_HUES.length;
    else if (e.key === "ArrowLeft" || e.key === "ArrowUp") next = (from - 1 + TEAMMATE_HUES.length) % TEAMMATE_HUES.length;
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = TEAMMATE_HUES.length - 1;
    if (next < 0) return;
    e.preventDefault();
    onChange(TEAMMATE_HUES[next]);
    refs.current[next]?.focus();
  }

  return (
    <div role="radiogroup" aria-label={label} aria-disabled={disabled || undefined} onKeyDown={onKeyDown} className="flex flex-wrap items-center gap-2">
      {TEAMMATE_HUES.map((hue, i) => {
        const selected = hue === value;
        return (
          <button
            key={hue}
            ref={(el) => {
              refs.current[i] = el;
            }}
            type="button"
            role="radio"
            aria-checked={selected}
            aria-label={HUE_LABEL[hue]}
            title={HUE_LABEL[hue]}
            // One tab stop: the chosen swatch, or the first while none is.
            tabIndex={selected || (at < 0 && i === 0) ? 0 : -1}
            disabled={disabled}
            onClick={() => {
              if (!selected) onChange(hue);
            }}
            style={{ backgroundColor: hueColor(hue) }}
            className={cn(
              "inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-white disabled:opacity-60",
              selected && "ring-2 ring-[var(--os-ink)] ring-offset-2 ring-offset-[var(--os-surface)]",
            )}
          >
            {selected ? <Check className="h-3.5 w-3.5" strokeWidth={2} aria-hidden /> : null}
          </button>
        );
      })}
    </div>
  );
}
