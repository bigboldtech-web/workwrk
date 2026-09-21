"use client";

// PlannerModal: the "quick peek" Planner popup opened from the bar's calendar
// glyph (calendar-peek.tsx). Renders the full week grid (PlannerWeek) in a
// large overlay so you can glance at your week and close it. Backdrop click
// and the close button close it; Esc is the LayerStack's (the opener
// registers the layer), so a picker inside the week closes before the peek.

import { X } from "lucide-react";
import Link from "next/link";
import { PlannerWeek } from "./planner-week";

export function PlannerModal({ onClose }: { onClose: () => void }) {
  return (
    <div className="workwrk-os os-chrome fixed inset-0 z-[80] flex items-center justify-center bg-[var(--os-scrim)] p-6" onClick={onClose}>
      <div
        role="dialog"
        aria-label="Planner"
        className="relative flex h-[82vh] w-[1100px] max-w-[94vw] flex-col overflow-hidden rounded-xl border border-line bg-raised text-ink shadow-[var(--os-shadow-modal)]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex h-12 shrink-0 items-center gap-3 border-b border-line px-4">
          <span className="text-base font-medium text-ink">Planner</span>
          <span className="flex-1" />
          <Link href="/planner" onClick={onClose} className="text-sm font-medium text-brand-deep hover:underline">
            Open the Planner
          </Link>
          <button
            type="button"
            onClick={onClose}
            className="inline-flex h-8 w-8 items-center justify-center rounded-md text-ink-2 hover:bg-hover hover:text-ink"
            aria-label="Close Planner"
          >
            <X className="h-4 w-4" strokeWidth={1.5} />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-hidden">
          <PlannerWeek embedded />
        </div>
      </div>
    </div>
  );
}
