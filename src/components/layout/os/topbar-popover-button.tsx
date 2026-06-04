"use client";

// TopbarPopoverButton — a single icon in the topbar that toggles an
// anchored popover panel below it. Click-outside + Escape close.
//
// Use this in place of <Link href="/x"> for top-bar items that should
// give a quick popover preview instead of routing away. The full page
// (if any) lives in the sidebar for admins.

import { useEffect, useRef, useState, type ReactNode } from "react";
import type { LucideIcon } from "lucide-react";

interface Props {
  Icon: LucideIcon;
  ariaLabel: string;
  title?: string;
  badge?: number | null;
  children: (close: () => void) => ReactNode;
}

export function TopbarPopoverButton({ Icon, ariaLabel, title, badge, children }: Props) {
  const [open, setOpen] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      const t = e.target as Node;
      if (panelRef.current?.contains(t) || btnRef.current?.contains(t)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("mousedown", onClick);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onClick);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <span className="relative inline-flex">
      <button
        ref={btnRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={`relative p-1 rounded-md hover:bg-zinc-100 transition-colors ${
          open ? "text-zinc-900 bg-zinc-100" : "text-zinc-500 hover:text-zinc-800"
        }`}
        aria-label={ariaLabel}
        aria-haspopup="dialog"
        aria-expanded={open}
        title={title ?? ariaLabel}
      >
        <Icon className="w-[14px] h-[14px]" />
        {badge && badge > 0 ? (
          <span className="absolute -top-0.5 -right-0.5 min-w-[14px] h-[14px] px-1 rounded-full bg-red-500 text-white text-[9px] font-semibold flex items-center justify-center leading-none">
            {badge > 99 ? "99+" : badge}
          </span>
        ) : null}
      </button>

      {open ? (
        <div
          ref={panelRef}
          className="absolute right-0 top-9 z-[70] w-[360px] max-w-[92vw]"
        >
          {children(() => setOpen(false))}
        </div>
      ) : null}
    </span>
  );
}
