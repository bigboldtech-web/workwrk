"use client";

// Menu primitives: the one option-row used by every dropdown, "..."
// overflow, create popover, context menu and picker in the app.
//
// Restyled onto the design-system tokens (design-system 5.6, 3.2): a
// bordered `--os-surface` panel with the popover shadow and radius 8; rows
// 36px, 14/400, 16px icon in `--os-ink-2`, hover `--os-surface-hov`, a
// destructive row in `--os-danger-text`. No zinc, no hex, no dark literals:
// dark is a rebinding of the tokens.
//
// IMPORTANT: these render real <button>/<a> elements. Inside the OS shell
// (`.workwrk-os`) a global reset strips button border/padding/bg, so always
// render menus through a portal (MorePortal / Radix) as every call site does.

import { createElement, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { cva, type VariantProps } from "class-variance-authority";
import { Check, ChevronRight, type LucideIcon } from "lucide-react";
import { Dots } from "@/components/ui/dots";
import { cn } from "@/lib/utils";

/* ─────────────────────────── hover submenu ─────────────────────────── */

// A row that reveals a nested MenuList to its right on hover/click. The
// nested panel is a descendant, and a padding bridge spans the gap, so
// moving onto it doesn't close the submenu.
export function MenuSubmenu({
  icon,
  iconClassName,
  label,
  children,
  width = 200,
}: {
  icon?: LucideIcon;
  iconClassName?: string;
  label: ReactNode;
  children: ReactNode;
  width?: number;
}) {
  const [open, setOpen] = useState(false);
  // Opens to the right unless there is no room there (a menu hanging off the
  // bar's right edge, like the avatar menu), in which case it opens to the
  // left. Measured on open, so it follows the menu wherever it is anchored.
  const [flip, setFlip] = useState(false);
  const hostRef = useRef<HTMLDivElement>(null);
  const show = () => {
    const rect = hostRef.current?.getBoundingClientRect();
    if (rect && typeof window !== "undefined") setFlip(rect.right + width + 8 > window.innerWidth);
    setOpen(true);
  };
  return (
    <div
      ref={hostRef}
      className="relative"
      onMouseEnter={show}
      onMouseLeave={() => setOpen(false)}
    >
      <MenuItem icon={icon} iconClassName={iconClassName} label={label} submenu onClick={() => (open ? setOpen(false) : show())} aria-expanded={open} />
      {open ? (
        <div className={cn("absolute top-[-6px] z-[120]", flip ? "end-full pe-1" : "start-full ps-1")}>
          <MenuList style={{ minWidth: width }}>{children}</MenuList>
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
        "rounded-lg border border-line bg-raised py-1 text-ink shadow-[var(--os-shadow-pop)]",
        className,
      )}
      {...rest}
    >
      {children}
    </div>
  );
}

export function MenuSeparator({ className }: { className?: string }) {
  return <div role="separator" className={cn("my-1 h-px bg-line", className)} />;
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
        "px-3 pb-1 pt-2 text-micro uppercase tracking-[0.06em] text-ink-2",
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
  // (outside .workwrk-os), where the global button reset doesn't reach; native
  // buttons then draw their OS gray chrome, so appearance-none is required.
  "group/menuitem w-full flex items-center text-left appearance-none bg-transparent transition-colors disabled:opacity-100 focus-visible:outline-none focus-visible:bg-hover",
  {
    variants: {
      variant: {
        flush: "gap-2.5 px-3 min-h-9 text-base",
        inset: "gap-2 rounded-md px-2 py-1.5 min-h-9 text-base",
      },
      tone: {
        default: "text-ink",
        destructive: "text-danger-text",
        disabled: "text-ink-4 cursor-not-allowed",
      },
    },
    compoundVariants: [
      { tone: "default", class: "hover:bg-hover" },
      { tone: "destructive", class: "hover:bg-danger-bg" },
    ],
    defaultVariants: { variant: "flush", tone: "default" },
  },
);

const ICON_SIZE = { flush: "h-4 w-4", inset: "h-4 w-4" } as const;

export interface MenuItemProps extends VariantProps<typeof rowVariants> {
  /** Leading lucide icon. Ignored if `leading` is supplied. */
  icon?: LucideIcon;
  /** Arbitrary leading node (avatar, swatch, EntityTile); overrides `icon`. */
  leading?: ReactNode;
  label: ReactNode;
  /** Optional second line (forces the comfortable two-line layout). */
  description?: ReactNode;
  /** Right-aligned custom content. */
  trailing?: ReactNode;
  /** Right-aligned keyboard hint, e.g. "⌘⇧K". */
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
  /** Override the leading icon colour class. */
  iconClassName?: string;
  /** Fill the leading icon (e.g. a favorited star). */
  iconFilled?: boolean;
  href?: string;
  onClick?: (e: React.MouseEvent) => void;
  title?: string;
  className?: string;
  role?: string;
  "aria-expanded"?: boolean;
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
  "aria-expanded": ariaExpanded,
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
                  ? "text-ink-4"
                  : destructive
                    ? "text-danger-text"
                    : iconFilled
                      ? "text-ink"
                      : "text-ink-2"),
            ),
            strokeWidth: 1.5,
            style: iconFilled ? { fill: "currentColor" } : undefined,
          })
        : null;

  const labelBlock = description ? (
    <span className="min-w-0 flex-1 py-0.5">
      <span className="block truncate font-medium">{label}</span>
      <span className="block truncate text-sm font-normal text-ink-2">{description}</span>
    </span>
  ) : (
    <span className="min-w-0 flex-1 truncate">{label}</span>
  );

  const trailingNode = (
    <>
      {badge}
      {shortcut ? <span className="text-xs font-medium text-ink-3">{shortcut}</span> : null}
      {trailing}
      {selected ? <Check className="h-4 w-4 shrink-0 text-ink" strokeWidth={1.5} /> : null}
      {submenu ? <ChevronRight className="h-3.5 w-3.5 shrink-0 text-ink-3 rtl:rotate-180" strokeWidth={1.5} /> : null}
      {busy ? <Dots variant="pending" /> : null}
    </>
  );
  const hasTrailing = badge || shortcut || trailing || selected || submenu || busy;

  const rowClass = cn(
    rowVariants({ variant: v, tone }),
    active ? "bg-active" : null,
    className,
  );

  const inner = (
    <>
      {leadingNode}
      {labelBlock}
      {hasTrailing ? (
        <span className="ms-auto flex shrink-0 items-center gap-1.5 ps-1.5">{trailingNode}</span>
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
      aria-expanded={ariaExpanded}
      className={rowClass}
    >
      {inner}
    </button>
  );
}
