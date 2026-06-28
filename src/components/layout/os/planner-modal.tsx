"use client";

// PlannerModal — the big "quick peek" Planner popup opened from the topbar
// calendar icon. Renders the full week grid (PlannerWeek) in a large overlay so
// you can glance at your week and close it. Esc or backdrop click closes.

import { useEffect } from "react";
import { X } from "lucide-react";
import { PlannerWeek } from "./planner-week";

export function PlannerModal({ onClose }: { onClose: () => void }) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === "Escape") onClose(); }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-[80] bg-black/30 flex items-center justify-center p-6" onClick={onClose}>
      <div
        className="relative w-[1100px] max-w-[94vw] h-[82vh] rounded-2xl bg-white dark:bg-[#14171D] border border-zinc-200 dark:border-[#2A2F38] shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          onClick={onClose}
          className="absolute top-2.5 right-2.5 z-[60] w-8 h-8 rounded-full hover:bg-zinc-100 dark:hover:bg-white/10 flex items-center justify-center text-zinc-500"
          aria-label="Close Planner"
        >
          <X className="w-4 h-4" />
        </button>
        <PlannerWeek embedded />
      </div>
    </div>
  );
}
