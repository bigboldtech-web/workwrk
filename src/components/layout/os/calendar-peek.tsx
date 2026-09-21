"use client";

// CalendarPeek: the bar's calendar glyph. Anywhere but the Planner it opens
// the full week (PlannerModal) in a large overlay so you can glance at your
// week and close it without leaving the page. On the Planner itself the
// glyph is the page you are on, so it is absent rather than inert.
//
// The peek is bound to the pathname it was opened on. The bar persists
// across navigations, so a plain boolean stayed true after a click inside
// the week pushed a new route and the overlay covered the page it had just
// opened (the P-9 defect spec-planner deleted the old modal for). Deriving
// "open" from "opened on THIS path" closes it the moment the route changes,
// with no effect and no setState-in-effect.

import { useState } from "react";
import { usePathname } from "next/navigation";
import { CalendarDays } from "lucide-react";
import { ChromeIconButton } from "./chrome-popover";
import { PlannerModal } from "./planner-modal";
import { useLayer } from "./shell-context";

export function CalendarPeek() {
  const pathname = usePathname() || "";
  const [openedOn, setOpenedOn] = useState<string | null>(null);
  const open = openedOn !== null && openedOn === pathname;
  const close = () => setOpenedOn(null);
  useLayer(open, { id: "planner-peek", kind: "dialog", close });
  if (pathname.startsWith("/planner")) return null;
  return (
    <>
      <ChromeIconButton label="Planner" onClick={() => setOpenedOn(open ? null : pathname)} aria-haspopup="dialog" aria-expanded={open} active={open}>
        <CalendarDays className="h-5 w-5" strokeWidth={1.5} aria-hidden />
      </ChromeIconButton>
      {open ? <PlannerModal onClose={close} /> : null}
    </>
  );
}
