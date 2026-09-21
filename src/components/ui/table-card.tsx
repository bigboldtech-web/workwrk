"use client";

// TableCard (design-system 5.1): the bordered card every list page renders its
// rows in. One primitive, so /docs, /canvas, /files, /sops, /process-runs,
// /policies and /agreements cannot each invent a table again.
//
//   Card        --os-surface, 1px --os-line, radius 8, overflow hidden, no
//               shadow, 8px under the toolbar, overflow-x auto INSIDE the
//               card (the page never scrolls sideways).
//   Header row  --os-table-head-bg (N50), 1px line under, labels 13/500
//               ink-2 sentence case; the checkbox column is 44 wide; a
//               sortable column shows a 12px arrow only when sorted; an
//               inline header filter renders after the label.
//   Body rows   --os-row-h (44 at Comfortable, follows the density
//               preference), 1px line-soft under, hover surface-hov, no
//               zebra; cells 15/400 ink, 12px padding-inline, the title
//               column 15/500; numbers right-aligned with tnum; a selected
//               row --os-selected.
//   Footer      44px, 1px line over: "Total {noun} N" 13/500 left, "a to b"
//               13/400 ink-2 with the two 32px page arrows and a page-size
//               select on hover at the right.
//   Bulk bar    floats bottom-centre 150ms after the first selection: white,
//               1px line, radius 8, shadow-pop, "N selected" + ghost actions
//               + a close. Never dark.
//   Empty       one row "No {noun} yet · {action}" 15/400 ink-2 with the
//               action as a text link. No illustration inside a card.
//   Loading     `rows === null`: skeleton bars at the row height.
//
// Rows are REAL LINKS when `rowHref` is given, so middle-click and cmd-click
// open a tab; `onRowClick` is for surfaces that open a drawer instead. The
// "..." trigger the caller passes in `rowMenu` is visible on hover and focus
// and always at Compact density on touch devices (os.css `.os-tc__more`).

import Link from "next/link";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { ChevronDown, ChevronLeft, ChevronRight, ChevronUp, X } from "lucide-react";
import { cn } from "@/lib/utils";

export interface TableColumn<T> {
  key: string;
  label: ReactNode;
  /** A CSS grid track: "minmax(220px,1fr)", "140px". Default "minmax(120px,1fr)". */
  width?: string;
  align?: "start" | "end" | "center";
  /** The 15/500 column (one per table). */
  title?: boolean;
  /** Right-aligned tabular numbers. */
  numeric?: boolean;
  sortable?: boolean;
  /** The inline header filter, rendered after the label ("All ▾"). */
  headerFilter?: ReactNode;
  render: (row: T, index: number) => ReactNode;
  /** Tailwind classes for the cell. */
  cellClassName?: string;
  /** Hide under this width (a Tailwind breakpoint class pair). */
  className?: string;
}

export interface TableSort {
  key: string;
  dir: "asc" | "desc";
}

export interface TableFooter {
  /** The real total from the server, never `rows.length`. */
  total: number;
  /** "docs", "canvases", "files". */
  noun: string;
  /** 1-based range shown: "1 to 40". */
  from: number;
  to: number;
  onPrev?: () => void;
  onNext?: () => void;
  pageSize?: number;
  pageSizes?: number[];
  onPageSize?: (n: number) => void;
  /** Extra text after the total ("· 3.4 GB"). */
  extra?: ReactNode;
}

export interface TableCardProps<T> {
  columns: TableColumn<T>[];
  /** `null` = loading. */
  rows: T[] | null;
  rowKey: (row: T) => string;
  rowHref?: (row: T) => string | null | undefined;
  onRowClick?: (row: T, e: React.MouseEvent) => void;
  /** Row-level checkbox column. */
  selectable?: boolean;
  selected?: Set<string>;
  onSelectedChange?: (next: Set<string>) => void;
  sort?: TableSort | null;
  onSort?: (key: string) => void;
  /** The "..." trigger for a row (a 32px ghost button the caller controls). */
  rowMenu?: (row: T) => ReactNode;
  /** Content rendered in the one empty row. */
  empty?: ReactNode;
  footer?: TableFooter;
  /** The bulk-bar actions; the bar itself and "N selected" are drawn here. */
  bulkActions?: ReactNode;
  skeletonRows?: number;
  /** A row to visually call out (`?file=` deep link). */
  highlightKey?: string | null;
  /** The right-click handler for a row (every item is also in the "..."). */
  onRowContextMenu?: (row: T, e: React.MouseEvent) => void;
  className?: string;
  ariaLabel?: string;
}

const CELL = "flex min-w-0 items-center px-3";

function alignClass(align?: "start" | "end" | "center", numeric?: boolean): string {
  if (numeric || align === "end") return "justify-end text-end tabular-nums";
  if (align === "center") return "justify-center text-center";
  return "";
}

export function TableCard<T>({
  columns,
  rows,
  rowKey,
  rowHref,
  onRowClick,
  selectable = false,
  selected,
  onSelectedChange,
  sort,
  onSort,
  rowMenu,
  empty,
  footer,
  bulkActions,
  skeletonRows = 8,
  highlightKey,
  onRowContextMenu,
  className,
  ariaLabel,
}: TableCardProps<T>) {
  const sel = selected ?? new Set<string>();
  const anySelected = sel.size > 0;

  // The bulk bar appears 150ms after the first selection (design-system 5.1).
  // The reset happens during render when the selection empties (the Picker
  // pattern); the only setState in the effect is inside its timer.
  const [barShown, setBarShown] = useState(false);
  const [seenAny, setSeenAny] = useState(anySelected);
  if (seenAny !== anySelected) { setSeenAny(anySelected); if (!anySelected) setBarShown(false); }
  useEffect(() => {
    if (!anySelected) return;
    const t = setTimeout(() => setBarShown(true), 150);
    return () => clearTimeout(t);
  }, [anySelected]);

  const template = useMemo(() => {
    const tracks: string[] = [];
    if (selectable) tracks.push("44px");
    for (const c of columns) tracks.push(c.width ?? "minmax(120px,1fr)");
    if (rowMenu) tracks.push("44px");
    return tracks.join(" ");
  }, [columns, selectable, rowMenu]);

  const allKeys = useMemo(() => (rows ?? []).map(rowKey), [rows, rowKey]);
  const allChecked = allKeys.length > 0 && allKeys.every((k) => sel.has(k));
  const someChecked = !allChecked && allKeys.some((k) => sel.has(k));

  function toggleAll() {
    if (!onSelectedChange) return;
    onSelectedChange(allChecked ? new Set() : new Set(allKeys));
  }
  function toggleOne(key: string) {
    if (!onSelectedChange) return;
    const next = new Set(sel);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    onSelectedChange(next);
  }

  const minWidth = useMemo(() => {
    // Sum of the fixed tracks plus 120 per fluid column, so the card scrolls
    // sideways inside itself rather than squashing cells to nothing.
    let w = (selectable ? 44 : 0) + (rowMenu ? 44 : 0);
    for (const c of columns) {
      const m = /(\d+)px/.exec(c.width ?? "");
      w += m ? Number(m[1]) : 120;
    }
    return w;
  }, [columns, selectable, rowMenu]);

  return (
    <div className={cn("os-tc os-chrome os-row relative flex min-h-0 flex-col overflow-hidden rounded-lg border border-line bg-raised", className)} role="table" aria-label={ariaLabel}>
      <div className="min-h-0 flex-1 overflow-auto">
        <div style={{ minWidth }}>
          {/* Header */}
          <div
            role="row"
            className="os-tc__head grid h-11 items-center border-b border-line bg-[var(--os-table-head-bg)] text-sm font-medium text-ink-2"
            style={{ gridTemplateColumns: template }}
          >
            {selectable ? (
              <div className={cn(CELL, "justify-center")}>
                <input
                  type="checkbox"
                  aria-label="Select all"
                  checked={allChecked}
                  ref={(el) => { if (el) el.indeterminate = someChecked; }}
                  onChange={toggleAll}
                  className="os-tc__check h-[18px] w-[18px] rounded border-line-strong accent-[var(--os-brand)]"
                />
              </div>
            ) : null}
            {columns.map((c) => {
              const sorted = sort?.key === c.key ? sort.dir : null;
              const inner = (
                <>
                  <span className="truncate">{c.label}</span>
                  {sorted ? (sorted === "asc" ? <ChevronUp className="h-3 w-3 shrink-0" strokeWidth={1.5} aria-hidden /> : <ChevronDown className="h-3 w-3 shrink-0" strokeWidth={1.5} aria-hidden />) : null}
                </>
              );
              return (
                <div key={c.key} role="columnheader" aria-sort={sorted ? (sorted === "asc" ? "ascending" : "descending") : undefined} className={cn(CELL, "gap-1", alignClass(c.align, c.numeric), c.className)}>
                  {c.sortable && onSort ? (
                    <button type="button" onClick={() => onSort(c.key)} className="inline-flex min-w-0 items-center gap-1 rounded px-0.5 hover:text-ink">
                      {inner}
                    </button>
                  ) : (
                    <span className="inline-flex min-w-0 items-center gap-1">{inner}</span>
                  )}
                  {c.headerFilter ? <span className="ms-1 shrink-0">{c.headerFilter}</span> : null}
                </div>
              );
            })}
            {rowMenu ? <div className={CELL} aria-hidden /> : null}
          </div>

          {/* Body */}
          {rows === null ? (
            <div aria-busy="true" aria-label="Loading">
              {Array.from({ length: skeletonRows }).map((_, i) => (
                <div key={i} className="flex items-center border-b border-line-soft px-3 last:border-b-0" style={{ height: "var(--os-row-h)" }}>
                  <span className="h-3.5 rounded bg-skeleton os-skeleton-pulse" style={{ width: ["60%", "40%", "80%"][i % 3] }} />
                  {i === 0 ? <span className="ms-4 text-sm text-ink-2" /> : null}
                </div>
              ))}
            </div>
          ) : rows.length === 0 ? (
            <div className="flex items-center px-4 text-row text-ink-2" style={{ height: "var(--os-row-h)" }}>
              {empty ?? "Nothing here yet"}
            </div>
          ) : (
            rows.map((row, i) => {
              const key = rowKey(row);
              const href = rowHref?.(row) ?? null;
              const isSel = sel.has(key);
              const isHi = highlightKey === key;
              const cells = columns.map((c) => (
                <div key={c.key} role="cell" className={cn(CELL, c.title ? "font-medium text-ink" : "text-ink", alignClass(c.align, c.numeric), c.className, c.cellClassName)}>
                  {c.render(row, i)}
                </div>
              ));
              const rowClass = cn(
                "os-tc__row group/row grid items-center border-b border-line-soft text-row text-ink last:border-b-0",
                "hover:bg-hover focus-within:bg-hover",
                isSel ? "bg-selected hover:bg-selected-hov" : "",
                isHi ? "bg-selected" : "",
              );
              const style = { gridTemplateColumns: template, height: "var(--os-row-h)" } as React.CSSProperties;
              const stop = (e: React.MouseEvent) => e.stopPropagation();
              const check = selectable ? (
                <div className={cn(CELL, "justify-center")} onClick={stop}>
                  <input
                    type="checkbox"
                    aria-label="Select row"
                    checked={isSel}
                    onChange={() => toggleOne(key)}
                    className={cn("os-tc__check h-[18px] w-[18px] rounded border-line-strong accent-[var(--os-brand)]", anySelected ? "is-any" : "")}
                  />
                </div>
              ) : null;
              const more = rowMenu ? (
                <div className={cn(CELL, "os-tc__more justify-center")} onClick={stop}>
                  {rowMenu(row)}
                </div>
              ) : null;
              const content = (
                <>
                  {check}
                  {cells}
                  {more}
                </>
              );
              if (href) {
                return (
                  <Link
                    key={key}
                    href={href}
                    role="row"
                    className={rowClass}
                    style={style}
                    data-key={key}
                    onClick={onRowClick ? (e) => onRowClick(row, e) : undefined}
                    onContextMenu={onRowContextMenu ? (e) => onRowContextMenu(row, e) : undefined}
                  >
                    {content}
                  </Link>
                );
              }
              return (
                <div
                  key={key}
                  role="row"
                  tabIndex={onRowClick ? 0 : undefined}
                  className={cn(rowClass, onRowClick ? "cursor-pointer" : "")}
                  style={style}
                  data-key={key}
                  onClick={onRowClick ? (e) => onRowClick(row, e) : undefined}
                  onKeyDown={onRowClick ? (e) => { if (e.key === "Enter" && e.target === e.currentTarget) onRowClick(row, e as unknown as React.MouseEvent); } : undefined}
                  onContextMenu={onRowContextMenu ? (e) => onRowContextMenu(row, e) : undefined}
                >
                  {content}
                </div>
              );
            })
          )}
        </div>
      </div>

      {footer ? <TableCardFooter {...footer} /> : null}

      {barShown && bulkActions ? (
        <div className="fixed bottom-6 start-1/2 z-40 flex h-12 -translate-x-1/2 items-center gap-1 rounded-lg border border-line bg-raised px-3 shadow-[var(--os-shadow-pop)] rtl:translate-x-1/2" role="toolbar" aria-label="Selected rows">
          <span className="me-2 text-base font-medium text-ink">{sel.size} selected</span>
          {bulkActions}
          <button type="button" onClick={() => onSelectedChange?.(new Set())} aria-label="Clear selection" className="ms-1 inline-flex h-8 w-8 items-center justify-center rounded-md text-ink-2 hover:bg-hover hover:text-ink">
            <X className="h-4 w-4" strokeWidth={1.5} aria-hidden />
          </button>
        </div>
      ) : null}
    </div>
  );
}

/** A ghost action inside the bulk bar. */
export function BulkAction({ icon: Icon, label, onClick, destructive, disabled }: {
  icon?: React.ComponentType<{ className?: string; strokeWidth?: number }>;
  label: string;
  onClick: () => void;
  destructive?: boolean;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "inline-flex h-8 items-center gap-1.5 rounded-md px-2.5 text-sm font-medium disabled:opacity-50",
        destructive ? "text-danger-text hover:bg-danger-bg" : "text-ink-2 hover:bg-hover hover:text-ink",
      )}
    >
      {Icon ? <Icon className="h-4 w-4" strokeWidth={1.5} /> : null}
      {label}
    </button>
  );
}

function TableCardFooter({ total, noun, from, to, onPrev, onNext, pageSize, pageSizes = [40, 100], onPageSize, extra }: TableFooter) {
  const hasRows = total > 0;
  return (
    <div className="group/foot flex h-11 shrink-0 items-center gap-3 border-t border-line px-4 text-sm">
      <span className="font-medium text-ink">
        Total {noun} <span className="tabular-nums">{new Intl.NumberFormat().format(total)}</span>
      </span>
      {extra ? <span className="text-ink-2">{extra}</span> : null}
      <span className="flex-1" />
      {onPageSize && pageSize ? (
        <label className="hidden items-center gap-1 text-xs text-ink-2 group-hover/foot:inline-flex">
          Rows
          <select value={pageSize} onChange={(e) => onPageSize(Number(e.target.value))} className="h-7 rounded-md border border-line bg-raised px-1.5 text-xs text-ink">
            {pageSizes.map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
        </label>
      ) : null}
      <span className="tabular-nums text-ink-2">{hasRows ? `${from} to ${to}` : "0 to 0"}</span>
      <span className="inline-flex items-center">
        <button type="button" onClick={onPrev} disabled={!onPrev} aria-label="Previous page" className="inline-flex h-8 w-8 items-center justify-center rounded-md text-ink-2 hover:bg-hover hover:text-ink disabled:opacity-40 disabled:hover:bg-transparent">
          <ChevronLeft className="h-4 w-4 rtl:rotate-180" strokeWidth={1.5} aria-hidden />
        </button>
        <button type="button" onClick={onNext} disabled={!onNext} aria-label="Next page" className="inline-flex h-8 w-8 items-center justify-center rounded-md text-ink-2 hover:bg-hover hover:text-ink disabled:opacity-40 disabled:hover:bg-transparent">
          <ChevronRight className="h-4 w-4 rtl:rotate-180" strokeWidth={1.5} aria-hidden />
        </button>
      </span>
    </div>
  );
}

/** The 32px ghost "..." trigger a row menu mounts inside `rowMenu`. */
export function RowMoreButton({ onClick, open, label = "More actions", buttonRef }: {
  onClick: (e: React.MouseEvent<HTMLButtonElement>) => void;
  open?: boolean;
  label?: string;
  buttonRef?: React.Ref<HTMLButtonElement>;
}) {
  return (
    <button
      ref={buttonRef}
      type="button"
      onClick={(e) => { e.preventDefault(); e.stopPropagation(); onClick(e); }}
      aria-label={label}
      aria-haspopup="menu"
      aria-expanded={open}
      title={label}
      className={cn(
        "os-tc__more-btn inline-flex h-8 w-8 items-center justify-center rounded-md text-ink-2 hover:bg-active hover:text-ink",
        open ? "is-open bg-active text-ink" : "",
      )}
    >
      <svg viewBox="0 0 16 16" className="h-4 w-4" aria-hidden><circle cx="3" cy="8" r="1.25" fill="currentColor" /><circle cx="8" cy="8" r="1.25" fill="currentColor" /><circle cx="13" cy="8" r="1.25" fill="currentColor" /></svg>
    </button>
  );
}
