"use client";

// The "Subtasks" control at the top of a view (ClickUp's Show subtasks):
// Collapsed, Expanded, Separate. Shared by the List view and the Board so the
// two read the same; each view offers only the modes it can draw.

import { useEffect, useRef, useState } from "react";
import { Check, Network } from "lucide-react";
import type { SubtaskDisplay } from "@/lib/work/subtask-display";

const OPTIONS: { k: SubtaskDisplay; label: string; note?: string; hint?: string }[] = [
  { k: "collapsed", label: "Collapsed", note: "(default)" },
  { k: "expanded", label: "Expanded" },
  { k: "separate", label: "Separate", hint: "Each subtask as a card of its own" },
];

export function SubtaskModeMenu({
  value,
  onChange,
  modes = ["collapsed", "expanded", "separate"],
}: {
  value: SubtaskDisplay;
  onChange: (next: SubtaskDisplay) => void;
  modes?: readonly SubtaskDisplay[];
}) {
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

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        title="Subtasks"
        aria-label="Subtasks display"
        aria-haspopup="menu"
        aria-expanded={open}
        className="inline-flex items-center gap-1.5 h-7 px-2 rounded-md text-xs text-ink-2 hover:text-ink hover:bg-hover"
      >
        <Network className="w-3.5 h-3.5" />
        <span className="font-medium">Subtasks</span>
      </button>
      {open ? (
        <div role="menu" className="absolute z-20 mt-1 left-0 w-[220px] rounded-lg border border-line bg-raised shadow-[var(--os-shadow-pop)] py-1.5">
          <div className="px-3 pb-1 text-xs font-semibold uppercase tracking-wide text-ink-3">Show subtasks</div>
          {OPTIONS.filter((o) => modes.includes(o.k)).map((o) => (
            <button
              key={o.k}
              type="button"
              role="menuitemradio"
              aria-checked={value === o.k}
              onClick={() => { setOpen(false); onChange(o.k); }}
              className="flex items-start gap-2 w-full px-3 py-1.5 text-left hover:bg-hover"
            >
              <span className="flex-1 min-w-0">
                <span className={value === o.k ? "text-base font-semibold text-ink" : "text-base text-ink"}>{o.label}</span>
                {o.note ? <span className="ml-1 text-xs text-ink-3">{o.note}</span> : null}
                {o.hint ? <span className="block text-xs text-ink-3">{o.hint}</span> : null}
              </span>
              {value === o.k ? <Check className="w-3.5 h-3.5 text-[var(--os-brand)] shrink-0 mt-0.5" /> : null}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
