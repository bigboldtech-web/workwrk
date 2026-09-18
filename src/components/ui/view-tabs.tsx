"use client";

// ViewTabs: the text-tab pill (design-system 5.12, 4.4 views row). One
// primitive for saved views, settings sub-tabs and drawer Comments / Activity
// tabs: 32px, 15/400 ink-2, radius 6, hover surface-hov, active surface-2
// with 15/500 ink. No underline anywhere in the app, no coloured view icons;
// an optional 16px Lucide glyph renders mono in ink-2 (ink when active).
//
// `ViewTabStrip` is the 36px `.os-row` the pills sit in (the page's views
// row when used under OsPageHeader; inside drawers the `dense` size gives
// 14px labels).

import { type ReactNode } from "react";
import Link from "next/link";
import { cva, type VariantProps } from "class-variance-authority";
import { type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

export function ViewTabStrip({
  children,
  className,
  "aria-label": ariaLabel,
}: {
  children: ReactNode;
  className?: string;
  "aria-label"?: string;
}) {
  return (
    <div role="tablist" aria-label={ariaLabel} className={cn("os-row os-chrome flex h-9 min-w-0 items-center gap-1 overflow-x-auto os-no-scrollbar", className)}>
      {children}
    </div>
  );
}

// .os-chrome on the pill itself: 32px tall and 12px padding in px wherever a
// tab renders (page views row, settings sub-tabs, drawer tabs), not 28 / 10.5
// under the product's 14px root.
const tabVariants = cva(
  "group/view os-chrome inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md px-3 whitespace-nowrap transition-colors duration-[var(--os-dur-base)]",
  {
    variants: {
      active: {
        true: "bg-active font-medium text-ink",
        false: "text-ink-2 hover:bg-hover hover:text-ink",
      },
      dense: {
        true: "text-base",
        false: "text-row",
      },
    },
    defaultVariants: { active: false, dense: false },
  },
);

export interface ViewTabProps extends VariantProps<typeof tabVariants> {
  icon?: LucideIcon;
  /**
   * Retired look-props (the per-view tint, the ClickUp coloured tile). Kept
   * on the type so callers compile; the pill renders every glyph mono.
   */
  iconClassName?: string;
  iconColor?: string;
  iconTileColor?: string;
  label: ReactNode;
  /** Right-aligned content (e.g. a count). */
  trailing?: ReactNode;
  href?: string;
  onClick?: (e: React.MouseEvent) => void;
  title?: string;
  className?: string;
}

export function ViewTab({
  icon: Icon,
  iconClassName: _iconClassName,
  iconColor: _iconColor,
  iconTileColor: _iconTileColor,
  label,
  trailing,
  active = false,
  dense = false,
  href,
  onClick,
  title,
  className,
}: ViewTabProps) {
  void _iconClassName;
  void _iconColor;
  void _iconTileColor;
  const inner = (
    <>
      {Icon ? (
        <Icon className={cn("h-4 w-4 shrink-0", active ? "text-ink" : "text-ink-2")} strokeWidth={1.5} aria-hidden />
      ) : null}
      <span className="truncate">{label}</span>
      {trailing}
    </>
  );
  const cls = cn(tabVariants({ active, dense }), className);

  if (href) {
    return (
      <Link href={href} role="tab" aria-selected={Boolean(active)} onClick={onClick} title={title} className={cls} draggable={false}>
        {inner}
      </Link>
    );
  }
  return (
    <button type="button" role="tab" aria-selected={Boolean(active)} onClick={onClick} title={title} className={cls} draggable={false}>
      {inner}
    </button>
  );
}
