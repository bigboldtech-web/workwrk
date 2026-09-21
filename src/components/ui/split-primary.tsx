"use client";

// SplitPrimary (design-system 5.10): the one blue button fused to a 36px
// chevron half separated by a 1px translucent divider. The primary half runs
// `onClick`; the chevron opens a MenuList of `children` rows under the
// button ("Blank doc", "From template…"). Pending replaces the icon with
// the monochrome four-dot mini-loader and keeps the label.
//
// OsPageHeader's `primary.split` takes ONE secondary action; surfaces whose
// chevron holds a small menu render this in `toolbar.right` instead.

import { useRef, useState, type ReactNode } from "react";
import { ChevronDown, Plus, type LucideIcon } from "lucide-react";
import { MenuList } from "@/components/ui/menu";
import { MorePortal } from "@/components/layout/os/more-portal";
import { Dots } from "@/components/ui/dots";
import { cn } from "@/lib/utils";

export function SplitPrimary({ label, icon: Icon = Plus, onClick, busy, disabled, children, menuLabel = "More ways to create", width = 240, className }: {
  label: string;
  icon?: LucideIcon | null;
  onClick: () => void;
  busy?: boolean;
  disabled?: boolean;
  /** The chevron menu's rows (MenuItem, MenuSeparator, ComingSoonRow). */
  children: ReactNode;
  menuLabel?: string;
  width?: number;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLButtonElement>(null);
  const off = Boolean(disabled || busy);
  return (
    <span className={cn("os-chrome inline-flex h-9 shrink-0 items-stretch overflow-hidden rounded-md", className)}>
      <button
        type="button"
        onClick={onClick}
        disabled={off}
        aria-busy={busy || undefined}
        className="inline-flex items-center gap-2 bg-brand pe-3 ps-3 text-base font-medium text-white hover:bg-brand-hover disabled:cursor-not-allowed disabled:bg-active disabled:text-ink-4"
      >
        {busy ? <Dots variant="pending" /> : Icon ? <Icon className="h-4 w-4" strokeWidth={1.5} aria-hidden /> : null}
        {label}
      </button>
      <button
        ref={ref}
        type="button"
        onClick={() => setOpen((o) => !o)}
        disabled={off}
        aria-label={menuLabel}
        aria-haspopup="menu"
        aria-expanded={open}
        className="inline-flex w-9 items-center justify-center bg-brand text-white hover:bg-brand-hover disabled:bg-active disabled:text-ink-4"
        style={{ borderInlineStart: "1px solid rgba(255,255,255,.24)" }}
      >
        <ChevronDown className="h-4 w-4" strokeWidth={1.5} aria-hidden />
      </button>
      <MorePortal anchorRef={ref} width={width} open={open} placement="below">
        <MenuList onMouseLeave={() => setOpen(false)} onClick={() => setOpen(false)}>
          {children}
        </MenuList>
      </MorePortal>
    </span>
  );
}
