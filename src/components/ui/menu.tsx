"use client";

// Menu primitives — the one option-row used by every dropdown, "..."
// overflow, create popover, context menu and picker in the app.
//
// Before this, ~25 surfaces each re-implemented their own row with
// drifting `gap-2 / gap-2.5 / gap-3`, `px-2 / px-2.5 / px-3`,
// `py-1 / py-1.5 / py-2` and `text-[12.5px] / text-[13px] / text-sm`.
// That is the "unaligned options" the redesign is fixing.
//
// Canonical row (variant="flush", the dense menu default):
//   gap-2.5 · px-3 py-1.5 · text-[12.5px] · 14px icon · full-bleed hover
// Comfortable row (variant="inset", create-style with descriptions):
//   gap-2 · rounded-lg px-2 · min-h-9 · text-[13px] · 16px icon
//
// IMPORTANT: these render real <button>/<a> elements. Inside the OS
// shell (`.workwrk-os`) a global reset strips button border/padding/bg,
// so always render menus through a portal (MorePortal / Radix) — every
// existing call site already does.

import { createElement, useState, type ReactNode } from "react";
import Link from "next/link";
import { cva, type VariantProps } from "class-variance-authority";
import { Check, ChevronRight, Loader2, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

/* ─────────────────────────── hover submenu ─────────────────────────── */

// A row that reveals a nested MenuList to its right on hover/click (ClickUp
// "Favorite ›" style). The nested panel is a descendant, and a padding bridge
// spans the gap, so moving onto it doesn't close the submenu.
export function MenuSubmenu({
  icon,
  iconClassName,
  label,
  children,
}: {
  icon?: LucideIcon;
  iconClassName?: string;
  label: ReactNode;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div
      className="relative"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
    >
      <MenuItem icon={icon} iconClassName={iconClassName} label={label} submenu onClick={() => setOpen((v) => !v)} />
      {open ? (
        <div className="absolute left-full top-[-6px] z-[120] pl-1">
          <MenuList className="min-w-[190px]">{children}</MenuList>
        </div>
      ) : null}
    </div>
  );
}

/* ───────────────────────────── container ───────────────────────────── */

export function MenuList({
  children,
  className,
  ...rest
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      role="menu"
      className={cn(
        "bg-white dark:bg-[#1B1F26] rounded-xl border border-zinc-200 dark:border-[#2A2F38] shadow-2xl py-1.5",
        className,
      )}
      {...rest}
    >
      {children}
    </div>
  );
}

export function MenuSeparator({ className }: { className?: string }) {
  return <div role="separator" className={cn("h-px bg-zinc-100 dark:bg-[#2A2F38] my-1", className)} />;
}

export function MenuSectionLabel({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "px-3 pt-1 pb-0.5 text-[10.5px] font-semibold uppercase tracking-wide text-zinc-400 dark:text-zinc-500",
        className,
      )}
    >
      {children}
    </div>
  );
}

/* ─────────────────────────────── item ──────────────────────────────── */

const rowVariants = cva(
  // appearance-none + bg-transparent: these rows often render in a portal
  // (outside .workwrk-os), where the global button reset doesn't reach — native
  // buttons then draw their OS gray chrome (which ignores background-color), so
  // appearance-none is required to kill it. hover/active still paint the fill.
  "group/menuitem w-full flex items-center text-left appearance-none bg-transparent transition-colors disabled:opacity-100 focus-visible:outline-none",
  {
    variants: {
      variant: {
        flush: "gap-2.5 px-3 py-1.5 text-[12.5px]",
        inset: "gap-2 rounded-lg px-2 py-1.5 min-h-9 text-[13px]",
      },
      tone: {
        default: "text-zinc-800 dark:text-zinc-200",
        destructive: "text-red-600 dark:text-red-400",
        disabled: "text-zinc-400 dark:text-zinc-500 cursor-not-allowed",
      },
    },
    compoundVariants: [
      // NB: avoid `bg-white/10` here — a light-mode guardrail in globals.css
      // (`[class*="bg-white/10"] { background:#0000000f !important }`) matches the
      // class substring even on a `dark:hover:` variant and paints every row gray.
      { tone: "default", class: "hover:bg-zinc-50 dark:hover:bg-zinc-800" },
      { tone: "destructive", class: "hover:bg-red-50 dark:hover:bg-red-500/15" },
    ],
    defaultVariants: { variant: "flush", tone: "default" },
  },
);

const ICON_SIZE = { flush: "h-3.5 w-3.5", inset: "h-4 w-4" } as const;

export interface MenuItemProps extends VariantProps<typeof rowVariants> {
  /** Leading lucide icon. Ignored if `leading` is supplied. */
  icon?: LucideIcon;
  /** Arbitrary leading node (avatar, swatch, EntityTile) — overrides `icon`. */
  leading?: ReactNode;
  label: ReactNode;
  /** Optional second line (forces the comfortable two-line layout). */
  description?: ReactNode;
  /** Right-aligned custom content. */
  trailing?: ReactNode;
  /** Right-aligned keyboard hint, e.g. "⌥T". */
  shortcut?: string;
  badge?: ReactNode;
  /** Renders a chevron-right (opens a sub-step / submenu). */
  submenu?: boolean;
  /** Renders a check on the right (current selection). */
  selected?: boolean;
  /** Spinner on the right; also disables the row. */
  busy?: boolean;
  /** Persistent highlight (current route / focused option). */
  active?: boolean;
  destructive?: boolean;
  disabled?: boolean;
  /** Override the leading icon color (e.g. "text-blue-500"). */
  iconClassName?: string;
  /** Fill the leading icon (e.g. a favorited star). */
  iconFilled?: boolean;
  href?: string;
  onClick?: (e: React.MouseEvent) => void;
  title?: string;
  className?: string;
  role?: string;
}

export function MenuItem({
  icon,
  leading,
  label,
  description,
  trailing,
  shortcut,
  badge,
  submenu,
  selected,
  busy,
  active,
  destructive,
  disabled,
  iconClassName,
  iconFilled,
  variant = "flush",
  href,
  onClick,
  title,
  className,
  role = "menuitem",
}: MenuItemProps) {
  const v = variant ?? "flush";
  const tone = disabled ? "disabled" : destructive ? "destructive" : "default";
  const isDisabled = Boolean(disabled || busy);

  const leadingNode =
    leading !== undefined
      ? leading
      : icon
        ? createElement(icon, {
            className: cn(
              ICON_SIZE[v],
              "shrink-0",
              iconClassName ??
                (disabled
                  ? "text-zinc-300 dark:text-zinc-600"
                  : destructive
                    ? "text-red-500"
                    : iconFilled
                      ? "text-amber-400"
                      : "text-zinc-500 dark:text-zinc-400"),
            ),
            style: iconFilled ? { fill: "currentColor" } : undefined,
          })
        : null;

  const labelBlock = description ? (
    <span className="min-w-0 flex-1">
      <span className="block truncate font-medium">{label}</span>
      <span className="block truncate text-[12px] font-normal text-zinc-500 dark:text-zinc-400">{description}</span>
    </span>
  ) : (
    <span className="min-w-0 flex-1 truncate">{label}</span>
  );

  const trailingNode = (
    <>
      {badge}
      {shortcut ? <span className="text-[12px] text-zinc-400 dark:text-zinc-500">{shortcut}</span> : null}
      {trailing}
      {selected ? <Check className="h-3.5 w-3.5 text-zinc-900 dark:text-zinc-100 shrink-0" /> : null}
      {submenu ? <ChevronRight className="h-3 w-3 text-zinc-400 dark:text-zinc-500 shrink-0" /> : null}
      {busy ? <Loader2 className="h-3 w-3 animate-spin text-zinc-400 dark:text-zinc-500 shrink-0" /> : null}
    </>
  );
  const hasTrailing = badge || shortcut || trailing || selected || submenu || busy;

  const rowClass = cn(
    rowVariants({ variant: v, tone }),
    active ? "bg-zinc-100 dark:bg-zinc-800" : null,
    className,
  );

  const inner = (
    <>
      {leadingNode}
      {labelBlock}
      {hasTrailing ? (
        <span className="ml-auto flex items-center gap-1.5 shrink-0 pl-1.5">{trailingNode}</span>
      ) : null}
    </>
  );

  if (href && !isDisabled) {
    return (
      <Link href={href} role={role} onClick={onClick} title={title} className={rowClass}>
        {inner}
      </Link>
    );
  }

  return (
    <button
      type="button"
      role={role}
      onClick={onClick}
      disabled={isDisabled}
      title={title}
      aria-disabled={isDisabled || undefined}
      className={rowClass}
    >
      {inner}
    </button>
  );
}
