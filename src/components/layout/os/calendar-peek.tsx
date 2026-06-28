"use client";

// CalendarPeek — the topbar calendar icon. Anywhere but the Planner it opens the
// full Planner in a big popup (PlannerModal) so you can glance at your week and
// close it. On the Planner itself it does nothing (you're already there).

import { useState } from "react";
import { usePathname } from "next/navigation";
import { AppGlyph } from "@/components/brand/app-glyphs";
import { PlannerModal } from "./planner-modal";

export function CalendarPeek() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const onPlanner = pathname?.startsWith("/planner") ?? false;

  return (
    <>
      <button
        type="button"
        onClick={() => { if (!onPlanner) setOpen(true); }}
        className="h-7 w-7 inline-flex items-center justify-center rounded-md hover:bg-zinc-100"
        aria-label="Planner"
        title={onPlanner ? "Planner" : "Open Planner"}
      >
        <AppGlyph appKey="planner" size={18} />
      </button>
      {open ? <PlannerModal onClose={() => setOpen(false)} /> : null}
    </>
  );
}
