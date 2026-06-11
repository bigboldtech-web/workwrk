"use client";

// PriorityPicker — flag + popover for the first-class Item.priority
// column (URGENT | HIGH | NORMAL | LOW | none). Shared by the table
// Priority cell, the drawer row, and the create-task modal.

import { useEffect, useRef, useState } from "react";
import { Ban, Check, Flag } from "lucide-react";
import { PRIORITY_OPTIONS } from "@/lib/board-items-shared";

export { PRIORITY_OPTIONS };

const BY_VALUE = new Map(PRIORITY_OPTIONS.map((p) => [p.value as string, p]));

export function PriorityFlag({ value, showLabel = false }: { value: string | null; showLabel?: boolean }) {
  const opt = value ? BY_VALUE.get(value.toUpperCase()) : null;
  if (!opt) return <span className="text-xs text-zinc-400">—</span>;
  return (
    <span className="inline-flex items-center gap-1.5">
      <Flag className="w-3.5 h-3.5" style={{ color: opt.color }} fill={opt.color} />
      {showLabel ? <span className="text-sm" style={{ color: opt.color }}>{opt.label}</span> : null}
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

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [open]);

  const display = <PriorityFlag value={value} showLabel={!compact} />;
  if (!canEdit) return display;

  return (
    <div className="relative inline-block" ref={ref}>
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); setOpen((v) => !v); }}
        className="inline-flex items-center gap-1 rounded px-1 py-0.5 -mx-1 hover:bg-zinc-100"
        aria-label="Set priority"
      >
        {display}
      </button>
      {open ? (
        <div
          className="absolute z-50 mt-1 left-0 w-[170px] rounded-md border border-zinc-200 bg-white shadow-lg py-1"
          onClick={(e) => e.stopPropagation()}
        >
          {PRIORITY_OPTIONS.map((p) => {
            const active = value?.toUpperCase() === p.value;
            return (
              <button
                key={p.value}
                type="button"
                onClick={() => { onChange(p.value); setOpen(false); }}
                className="flex items-center gap-2 w-full px-3 py-1.5 text-left text-[12.5px] hover:bg-zinc-50"
              >
                <Flag className="w-3.5 h-3.5" style={{ color: p.color }} fill={p.color} />
                {p.label}
                {active ? <Check className="w-3.5 h-3.5 ml-auto text-[var(--os-brand)]" /> : null}
              </button>
            );
          })}
          {value ? (
            <button
              type="button"
              onClick={() => { onChange(null); setOpen(false); }}
              className="flex items-center gap-2 w-full px-3 py-1.5 text-left text-[12.5px] text-zinc-500 hover:bg-zinc-50 border-t border-zinc-100"
            >
              <Ban className="w-3.5 h-3.5" /> Clear
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
