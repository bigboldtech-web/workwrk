"use client";

// RowHeightMenu: a view's Row height (gap 14, List comfort), beside Columns in
// the Table toolbar. Three steps derived from the viewer's density token
// (table-comfort.ts rowHeightStyle), saved per view. Rendered only for someone
// who may save the view; everyone else simply sees the height it was saved at.

import { useEffect, useRef, useState } from "react";
import { Check, Rows3 } from "lucide-react";
import type { RowHeight } from "@/lib/list-comfort";

const OPTIONS: Array<{ value: RowHeight; label: string; hint: string }> = [
  { value: "compact", label: "Compact", hint: "More rows on screen" },
  { value: "default", label: "Default", hint: "Your density setting" },
  { value: "tall", label: "Tall", hint: "Titles wrap to two lines" },
];

export function RowHeightMenu({ value, onChange }: { value: RowHeight; onChange: (next: RowHeight) => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);
  const current = OPTIONS.find((o) => o.value === value) ?? OPTIONS[1];
  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        title="Row height"
        aria-label={`Row height: ${current.label}`}
        aria-haspopup="menu"
        aria-expanded={open}
        className="inline-flex h-7 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-md px-2 text-xs text-ink-2 transition-colors hover:bg-hover hover:text-ink"
      >
        <Rows3 className="h-3.5 w-3.5" strokeWidth={1.5} aria-hidden="true" />
        {/* Icon only on a narrow toolbar, so it never pushes its neighbours
            onto two lines; the title and label still name it. */}
        <span className="hidden font-medium lg:inline">{value === "default" ? "Row height" : current.label}</span>
      </button>
      {open ? (
        <div role="menu" className="absolute start-0 top-full z-30 mt-1 w-[220px] rounded-lg border border-line bg-raised p-1 shadow-[var(--os-shadow-pop)]">
          <div className="px-2 pb-1 pt-1.5 text-micro font-semibold uppercase tracking-wide text-ink-3">Row height</div>
          {OPTIONS.map((o) => (
            <button
              key={o.value}
              type="button"
              role="menuitemradio"
              aria-checked={o.value === value}
              onClick={() => {
                setOpen(false);
                if (o.value !== value) onChange(o.value);
              }}
              className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-start transition-colors hover:bg-hover"
            >
              <span className="min-w-0 flex-1">
                <span className={`block text-base ${o.value === value ? "font-medium text-ink" : "text-ink"}`}>{o.label}</span>
                <span className="block text-xs text-ink-2">{o.hint}</span>
              </span>
              {o.value === value ? <Check className="h-4 w-4 shrink-0 text-brand-deep" strokeWidth={1.5} aria-hidden="true" /> : null}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
