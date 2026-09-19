"use client";

// PriorityPicker — flag + popover for the first-class Item.priority
// column (URGENT | HIGH | NORMAL | LOW | none). Shared by the table
// Priority cell, the drawer row, and the create-task modal.

import { useEffect, useRef, useState } from "react";
import { Ban, Flag } from "lucide-react";
import { PRIORITY_OPTIONS, PRIORITY_TONE } from "@/lib/board-items-shared";
import { MenuItem, MenuSeparator } from "@/components/ui/menu";
import { useAnchorPos } from "./use-anchor-pos";

export { PRIORITY_OPTIONS };

const BY_VALUE = new Map(PRIORITY_OPTIONS.map((p) => [p.value as string, p]));

/**
 * The flag AND the word, always.
 *
 * `showLabel` used to default to false, so the dense table cells rendered a
 * red, amber or blue flag on its own and asked the reader to know the code.
 * The same field then read three different ways in one product: word plus
 * flag on /everything, flag plus a tooltip on /my-work, and a bare flag on a
 * List. One anatomy now, from PRIORITY_TONE: one hue on Urgent, weight for
 * the rest, and the word beside it everywhere.
 *
 * `showLabel` is kept so a caller with genuinely no room can still drop the
 * word, and then the flag carries an accessible name instead of nothing.
 */
export function PriorityFlag({ value, showLabel = true }: { value: string | null; showLabel?: boolean }) {
  const opt = value ? BY_VALUE.get(value.toUpperCase()) : null;
  // Empty renders a flag affordance rather than a bare dash, so the cell reads
  // as "set priority" and stays aligned with the rows that have one.
  if (!opt) return <Flag className="w-4 h-4 text-ink-3" strokeWidth={1.5} aria-label="No priority" />;
  const tone = PRIORITY_TONE[opt.value] ?? PRIORITY_TONE.NORMAL;
  return (
    <span className={`inline-flex items-center gap-1.5 ${tone.text}`}>
      <Flag
        className="w-3.5 h-3.5 shrink-0"
        strokeWidth={1.5}
        fill={tone.filled ? "currentColor" : "none"}
        aria-hidden={showLabel ? true : undefined}
        aria-label={showLabel ? undefined : `Priority ${opt.label}`}
      />
      {showLabel ? <span className="text-xs">{opt.label}</span> : null}
    </span>
  );
}

interface PriorityPickerProps {
  value: string | null;
  canEdit: boolean;
  /** Flag-only trigger for dense table cells. */
  compact?: boolean;
  onChange: (value: string | null) => void;
}

export function PriorityPicker({ value, canEdit, compact = false, onChange }: PriorityPickerProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const menuPos = useAnchorPos(ref, open, 170);

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [open]);

  // `compact` is about PADDING, not about hiding the word: a flag with no
  // word is a colour code, which is the thing this field stopped being.
  const display = <PriorityFlag value={value} />;
  if (!canEdit) return display;

  return (
    <div className="relative inline-block" ref={ref}>
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); setOpen((v) => !v); }}
        className={`inline-flex items-center gap-1 rounded-md hover:bg-hover transition-colors ${compact ? "px-0.5 py-0" : "px-1 py-0.5 -mx-1"}`}
        aria-label="Set priority"
      >
        {display}
      </button>
      {open && menuPos ? (
        <div
          style={{ position: "fixed", left: menuPos.left, width: 170, ...(menuPos.top != null ? { top: menuPos.top } : { bottom: menuPos.bottom }), maxHeight: menuPos.maxHeight, overflowY: "auto" as const }}
          className="z-[200] rounded-lg border border-line bg-raised shadow-[var(--os-shadow-pop)] py-1.5"
          onClick={(e) => e.stopPropagation()}
        >
          {PRIORITY_OPTIONS.map((p) => {
            const active = value?.toUpperCase() === p.value;
            return (
              <MenuItem
                key={p.value}
                leading={(() => {
                  const tone = PRIORITY_TONE[p.value] ?? PRIORITY_TONE.NORMAL;
                  return <Flag className={`w-3.5 h-3.5 shrink-0 ${tone.text}`} strokeWidth={1.5} fill={tone.filled ? "currentColor" : "none"} />;
                })()}
                label={p.label}
                selected={active}
                onClick={() => { onChange(p.value); setOpen(false); }}
              />
            );
          })}
          {value ? (
            <>
              <MenuSeparator />
              <MenuItem
                icon={Ban}
                label="Clear"
                onClick={() => { onChange(null); setOpen(false); }}
              />
            </>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
