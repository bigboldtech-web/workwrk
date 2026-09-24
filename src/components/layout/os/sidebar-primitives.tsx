"use client";

// The hub sidebar's row vocabulary (design-system 4.2, spec-shell 1.2,
// sidebar-map 0). Every hub sidebar renders its rows through these so the
// look is stated once: 36px rows in `.os-row`, a 20px icon or a neutral
// EntityTile, the N200 pill on the active row with no blue and no transform,
// 11/600 uppercase section labels with a rule to the right edge, one quiet
// line for an empty section, three skeleton rows while a section loads and
// one wired "Try again" line when it fails.
//
// Rows never take an `active` prop from a hand-rolled check; the hub sidebar
// resolves the active row through resolveActiveRow and passes the result in.

import Link from "next/link";
import { createElement, useState, type ReactNode } from "react";
import { ChevronDown, ChevronRight, Lock, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { EntityTile, type EntityTileProps } from "@/components/ui/entity-tile";

/** Marker attribute the container counts to decide whether the hub search renders. */
export const SIDEBAR_ROW_ATTR = "data-os-row";

export interface SidebarRowProps {
  href: string;
  label: ReactNode;
  icon?: LucideIcon;
  tile?: EntityTileProps;
  active?: boolean;
  /** Right-aligned 12/500 count; hidden at zero. */
  count?: number | null;
  /** A 6px unread dot when there is no count. */
  dot?: boolean;
  /** Findable object the viewer holds nothing on: grey label + lock glyph. */
  locked?: boolean;
  /** Tree depth: 20px per level. */
  depth?: number;
  /** The one hover "..." (or any trailing control). Always in the tab order. */
  trailing?: ReactNode;
  /** Opens in a new tab (plain <a>) instead of a client navigation. */
  external?: boolean;
  onClick?: (e: React.MouseEvent) => void;
  /** Right click: a shortcut to the row's "..." menu (every item is also there). */
  onContextMenu?: (e: React.MouseEvent) => void;
  className?: string;
  title?: string;
  /** A jump out of the hub: the row never goes active and shows an arrow. */
  jump?: boolean;
}

// No transition: the chrome never animates a colour change (design-system 6).
const ROW_BASE =
  "group/row relative flex h-9 w-full min-w-0 items-center gap-3 rounded-lg px-3 text-ink";
const ROW_REST = "hover:bg-hover";
const ROW_ACTIVE = "bg-side-pill font-medium";

export function SidebarRow({
  href, label, icon, tile, active, count, dot, locked, depth = 0, trailing, external, onClick, onContextMenu, className, title, jump,
}: SidebarRowProps) {
  const isActive = Boolean(active) && !jump;
  const glyph = tile ? (
    <EntityTile size="sm" {...tile} />
  ) : icon ? (
    createElement(icon, {
      className: cn("h-5 w-5 shrink-0", isActive ? "text-ink" : locked ? "text-ink-3" : "text-ink-2"),
      strokeWidth: 1.5,
      "aria-hidden": true,
    })
  ) : null;
  // With a trailing control the count and the "..." share the row's end: on
  // a pointer that hovers, the count gives way while the row is hovered or
  // focused and the row reserves the button's slot, so neither the count nor
  // a long name runs under the "..."; where nothing hovers (touch) the "..."
  // is always shown, so the slot is always reserved and the count stays.
  const endSwap = trailing ? "[@media(hover:hover)]:group-hover/row:invisible [@media(hover:hover)]:group-focus-within/row:invisible" : undefined;
  const inner = (
    <>
      {glyph}
      <span className={cn("min-w-0 flex-1 truncate", locked && "text-ink-3")}>{label}</span>
      {locked ? <Lock className="h-4 w-4 shrink-0 text-ink-3" strokeWidth={1.5} aria-hidden /> : null}
      {typeof count === "number" && count > 0 ? (
        <span className={cn("shrink-0 text-xs font-medium tabular-nums", isActive ? "text-ink-strong" : "text-ink-2", endSwap)}>
          {count > 99 ? "99+" : count}
        </span>
      ) : dot ? (
        <span className={cn("h-1.5 w-1.5 shrink-0 rounded-full bg-attention", endSwap)} aria-label="Unread" />
      ) : null}
      {jump ? <span className="inline-block text-ink-3 rtl:-scale-x-100" aria-hidden>↗</span> : null}
    </>
  );
  const cls = cn(
    ROW_BASE, isActive ? ROW_ACTIVE : ROW_REST,
    trailing && "[@media(hover:hover)]:group-hover/row:pe-9 [@media(hover:hover)]:group-focus-within/row:pe-9 [@media(hover:none)]:pe-9",
    className,
  );
  const style = depth > 0 ? { paddingInlineStart: 12 + depth * 20 } : undefined;
  return (
    <li className="group/row relative" onContextMenu={onContextMenu} {...{ [SIDEBAR_ROW_ATTR]: "" }}>
      {external ? (
        <a href={href} target="_blank" rel="noopener noreferrer" className={cls} style={style} onClick={onClick} title={title}>
          {inner}
        </a>
      ) : (
        <Link href={href} className={cls} style={style} onClick={onClick} title={title} aria-current={isActive ? "page" : undefined}>
          {inner}
        </Link>
      )}
      {trailing ? (
        <span className="absolute end-1 top-1/2 -translate-y-1/2 opacity-0 transition-opacity group-hover/row:opacity-100 focus-within:opacity-100 [@media(hover:none)]:opacity-100">
          {trailing}
        </span>
      ) : null}
    </li>
  );
}

/** A row that is a button (opens a dialog, toggles a group), same anatomy. */
export function SidebarButtonRow({
  label, icon, onClick, className, title, count, active, depth = 0, "aria-haspopup": ariaHasPopup, "aria-expanded": ariaExpanded,
}: {
  label: ReactNode;
  icon?: LucideIcon;
  onClick: () => void;
  className?: string;
  title?: string;
  count?: number | null;
  active?: boolean;
  depth?: number;
  "aria-haspopup"?: React.AriaAttributes["aria-haspopup"];
  "aria-expanded"?: boolean;
}) {
  return (
    <li className="relative" {...{ [SIDEBAR_ROW_ATTR]: "" }}>
      <button
        type="button"
        onClick={onClick}
        title={title}
        aria-haspopup={ariaHasPopup}
        aria-expanded={ariaExpanded}
        className={cn(ROW_BASE, active ? ROW_ACTIVE : ROW_REST, "text-start", className)}
        style={depth > 0 ? { paddingInlineStart: 12 + depth * 20 } : undefined}
      >
        {icon ? createElement(icon, { className: cn("h-5 w-5 shrink-0", active ? "text-ink" : "text-ink-2"), strokeWidth: 1.5, "aria-hidden": true }) : null}
        <span className="min-w-0 flex-1 truncate">{label}</span>
        {typeof count === "number" && count > 0 ? (
          <span className={cn("shrink-0 text-xs font-medium tabular-nums", active ? "text-ink-strong" : "text-ink-2")}>{count}</span>
        ) : null}
      </button>
    </li>
  );
}

/** A quiet ghost row (13/500 ink-2) for "See all", "+ New doc" and the like. */
export function SidebarGhostRow({
  href, label, icon, onClick,
}: {
  href?: string;
  label: ReactNode;
  icon?: LucideIcon;
  onClick?: () => void;
}) {
  const cls = "flex h-9 w-full items-center gap-3 rounded-lg px-3 text-sm font-medium text-ink-2 hover:bg-hover hover:text-ink";
  const inner = (
    <>
      {icon ? createElement(icon, { className: "h-4 w-4 shrink-0", strokeWidth: 1.5, "aria-hidden": true }) : null}
      <span className="min-w-0 flex-1 truncate">{label}</span>
    </>
  );
  return (
    <li {...{ [SIDEBAR_ROW_ATTR]: "" }}>
      {href ? (
        <Link href={href} className={cls} onClick={onClick}>{inner}</Link>
      ) : (
        <button type="button" className={cn(cls, "text-start")} onClick={onClick}>{inner}</button>
      )}
    </li>
  );
}

/**
 * Section label: 11/600 uppercase +0.06em ink-2 with a 1px rule from the label
 * to the right edge, 24px above, 8px below. A collapse control only, never a
 * link. `actions` (the label's own "..." and "+") render at the right edge on
 * hover and are always in the tab order.
 */
export function SidebarSectionLabel({
  children, collapsed, onToggle, actions, count,
}: {
  children: ReactNode;
  collapsed?: boolean;
  onToggle?: () => void;
  actions?: ReactNode;
  count?: number | null;
}) {
  const label = (
    <span className="inline-flex items-center gap-1.5 text-micro uppercase tracking-[0.06em] text-ink-2">
      {onToggle ? (
        <span className="-ms-4 inline-flex w-4 items-center justify-center opacity-0 transition-opacity group-hover/section:opacity-100 group-focus-within/section:opacity-100" aria-hidden>
          {collapsed ? <ChevronRight className="h-3.5 w-3.5 rtl:rotate-180" /> : <ChevronDown className="h-3.5 w-3.5" />}
        </span>
      ) : null}
      <span>{children}</span>
      {typeof count === "number" && count > 0 ? <span className="font-medium normal-case tracking-normal text-ink-3">{count}</span> : null}
    </span>
  );
  return (
    <div className="group/section mb-2 mt-6 flex h-5 items-center gap-2 ps-3 pe-1 first:mt-2">
      {onToggle ? (
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={!collapsed}
          className="flex min-w-0 items-center text-start"
        >
          {label}
        </button>
      ) : label}
      <span className="h-px min-w-3 flex-1 bg-line" aria-hidden />
      {actions ? (
        <span className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover/section:opacity-100 focus-within:opacity-100 [@media(hover:none)]:opacity-100">
          {actions}
        </span>
      ) : null}
    </div>
  );
}

/** A 28px ghost icon button for a section label's right edge. */
export function SidebarSectionAction({
  icon, label, onClick, className, "aria-haspopup": ariaHasPopup, "aria-expanded": ariaExpanded, ref,
}: {
  icon: LucideIcon;
  label: string;
  onClick: () => void;
  className?: string;
  "aria-haspopup"?: React.AriaAttributes["aria-haspopup"];
  "aria-expanded"?: boolean;
  ref?: React.Ref<HTMLButtonElement>;
}) {
  return (
    <button
      ref={ref}
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      aria-haspopup={ariaHasPopup}
      aria-expanded={ariaExpanded}
      className={cn("inline-flex h-7 w-7 items-center justify-center rounded-md text-ink-2 hover:bg-hover hover:text-ink", className)}
    >
      {createElement(icon, { className: "h-4 w-4", strokeWidth: 1.5, "aria-hidden": true })}
    </button>
  );
}

/** One quiet 36px line for a loaded section with no rows (1.2 rule 6). */
export function SidebarEmptyLine({ children }: { children: ReactNode }) {
  return <li className="flex h-9 items-center px-3 text-sm text-ink-2">{children}</li>;
}

/** One 36px line for a failed section with the retry wired (1.2 rule 7). */
export function SidebarErrorLine({ what, onRetry }: { what: string; onRetry: () => void }) {
  return (
    <li className="flex h-9 items-center gap-1 px-3 text-sm text-ink-2">
      <span className="truncate">Couldn&apos;t load {what}</span>
      <span aria-hidden>·</span>
      <button type="button" onClick={onRetry} className="shrink-0 font-medium text-brand-deep hover:underline">
        Try again
      </button>
    </li>
  );
}

/** Three 36px skeleton rows (bars 60 / 40 / 80 percent) for a section's first load. */
export function SidebarSkeletonRows({ rows = 3 }: { rows?: number }) {
  const widths = ["60%", "40%", "80%"];
  return (
    <>
      {Array.from({ length: rows }, (_, i) => (
        <li key={i} className="flex h-9 items-center gap-3 px-3" aria-hidden>
          <span className="h-5 w-5 shrink-0 rounded-md bg-skeleton os-skeleton-pulse" />
          <span className="h-3.5 rounded bg-skeleton os-skeleton-pulse" style={{ width: widths[i % widths.length] }} />
        </li>
      ))}
    </>
  );
}

/** A collapsible group row (a parent with children under it). */
export function useSidebarGroup(initialOpen: boolean) {
  const [open, setOpen] = useState(initialOpen);
  return { open, toggle: () => setOpen((v) => !v), setOpen };
}
