"use client";

// ViewTabs — the underline tab strip, extracted verbatim from the board
// view-tab strip that is the app's "clean" reference (icon + label, a
// 2px active underline, per-view colored icon that goes mono when
// active). Space view tabs, drawer tabs and the field shelf all drifted
// to slightly different padding / colors / active treatments; this is
// the single source of truth they align to.

import { type ReactNode } from "react";
import Link from "next/link";
import { cva, type VariantProps } from "class-variance-authority";
import { type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

export function ViewTabStrip({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex items-center gap-1.5 border-b border-zinc-200", className)}>
      {children}
    </div>
  );
}

const tabVariants = cva(
  "group/view inline-flex items-center gap-1.5 px-2 py-2 text-[13px] border-b-[2.5px] -mb-px transition-colors whitespace-nowrap",
  {
    variants: {
      active: {
        true: "border-zinc-900 text-zinc-900 font-medium",
        false: "border-transparent text-zinc-600 hover:text-zinc-900",
      },
    },
    defaultVariants: { active: false },
  },
);

export interface ViewTabProps extends VariantProps<typeof tabVariants> {
  icon?: LucideIcon;
  /** Icon color when inactive (per-view tint). Mono zinc-900 when active. */
  iconClassName?: string;
  /** Hex color — when set, the icon renders as a small filled rounded-square
   *  tile (white glyph on this color), the ClickUp tab style. */
  iconTileColor?: string;
  label: ReactNode;
  /** Right-aligned content (e.g. a count badge). */
  trailing?: ReactNode;
  href?: string;
  onClick?: (e: React.MouseEvent) => void;
  title?: string;
  className?: string;
}

export function ViewTab({
  icon: Icon,
  iconClassName = "text-zinc-500",
  iconTileColor,
  label,
  trailing,
  active = false,
  href,
  onClick,
  title,
  className,
}: ViewTabProps) {
  const inner = (
    <>
      {Icon ? (
        iconTileColor ? (
          <span
            className="w-[17px] h-[17px] rounded-[5px] inline-flex items-center justify-center shrink-0"
            style={{ backgroundColor: iconTileColor }}
          >
            <Icon className="w-3 h-3 text-white" />
          </span>
        ) : (
          <Icon className={cn("w-4 h-4 shrink-0", active ? "text-zinc-900" : iconClassName)} />
        )
      ) : null}
      <span className="truncate">{label}</span>
      {trailing}
    </>
  );
  const cls = cn(tabVariants({ active }), className);

  if (href) {
    return (
      <Link href={href} onClick={onClick} title={title} className={cls}>
        {inner}
      </Link>
    );
  }
  return (
    <button type="button" onClick={onClick} title={title} className={cls}>
      {inner}
    </button>
  );
}
