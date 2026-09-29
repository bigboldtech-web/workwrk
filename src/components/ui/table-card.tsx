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
// A surface whose rules forbid any hover-only affordance (the Staff console)
// passes `rowMenuAlwaysVisible`, and the trigger shows at rest on every row.

import Link from "next/link";
import { Fragment, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { ChevronDown, ChevronLeft, ChevronRight, ChevronUp, Settings2, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { useElementWidth } from "@/hooks/use-element-width";

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
  /** Extra classes for the header and body cells. Never a display class: a
   *  column hides through `hideBelow`, so its grid track goes with it. */
  className?: string;
  /**
   * The column priority rule (spec-tools-misc section 1): drop this column
   * when the CARD is narrower than this many pixels. The track and the
   * minimum width go with it, so the remaining columns fill the card and the
   * last one is never pushed under the sticky "..." cell. Hidden columns are
   * in the drawer, never truncated to nothing.
   */
  hideBelow?: number;
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
  /** A sentence at the footer's end edge, before any paging. */
  trailing?: ReactNode;
  /** A list that never pages (a person's KPIs): no range and no arrows. */
  hidePaging?: boolean;
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
  /** A row the viewer cannot act on gets no checkbox (spec-ai-automation 1.4). Default: every row. */
  isRowSelectable?: (row: T) => boolean;
  selected?: Set<string>;
  onSelectedChange?: (next: Set<string>) => void;
  sort?: TableSort | null;
  onSort?: (key: string) => void;
  /** The "..." trigger for a row (a 32px ghost button the caller controls). */
  rowMenu?: (row: T) => ReactNode;
  /**
   * The width in px of the pinned end column `rowMenu` renders into. The
   * default 44 fits the 32px "..." trigger. A caller that puts a labelled
   * action there instead (the Directory's Removed view: an icon plus
   * "Restore") passes the width that label needs, so the sticky cell is not
   * narrower than its content: at 44 the button spilled past the card's
   * edge, read "Restor" and gave the whole table a sideways scroll.
   */
  rowMenuWidth?: number;
  /**
   * The "..." shows at rest on every row, not only on hover and focus. Opt
   * in; the product's own tables keep the hover rule.
   */
  rowMenuAlwaysVisible?: boolean;
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
  /** Cmd/Ctrl+Backspace on a focused row (list pages: Move to Trash, behind
   *  the page's own confirm). Absent = the key does nothing. */
  onRowDeleteKey?: (row: T) => void;
  className?: string;
  ariaLabel?: string;
  /**
   * Grouped rendering inside ONE card: a 44px group header row starts each
   * run of rows with the same key (the caller sorts by the group first).
   * `count` is the server's total for the group, never the page's run.
   */
  groupOf?: (row: T) => { key: string; label: ReactNode; count?: number | null };
  collapsedGroups?: ReadonlySet<string>;
  onToggleGroup?: (key: string) => void;
  /**
   * The column settings control at the end of the header row (design-system
   * 5.1). Every column except the title column can be shown or hidden;
   * a column `hideBelow` dropped for width comes back here, and the card
   * then scrolls sideways inside itself. `storageKey` remembers the choice
   * on this device (a per-viewer convenience, never shared state).
   */
  columnSettings?: boolean | { storageKey?: string };
  /**
   * A controlled column choice, for a surface that keeps it somewhere other
   * than this device (the Staff console keeps it per staff member on the
   * server). When given it wins over `storageKey`, and every change goes to
   * `onColumnChoiceChange` instead of localStorage.
   */
  columnChoice?: ColumnChoice;
  onColumnChoiceChange?: (next: ColumnChoice) => void;
}

export type ColumnChoice = { shown: string[]; hidden: string[] };
const COL_NS = "workwrk:table-columns";
function readChoice(key: string | undefined): ColumnChoice {
  if (!key) return { shown: [], hidden: [] };
  try {
    const raw = window.localStorage.getItem(`${COL_NS}:${key}`);
    const v = raw ? (JSON.parse(raw) as Partial<ColumnChoice>) : null;
    return { shown: Array.isArray(v?.shown) ? v!.shown : [], hidden: Array.isArray(v?.hidden) ? v!.hidden : [] };
  } catch { return { shown: [], hidden: [] }; }
}
function writeChoice(key: string | undefined, c: ColumnChoice) {
  if (!key) return;
  try {
    if (!c.shown.length && !c.hidden.length) window.localStorage.removeItem(`${COL_NS}:${key}`);
    else window.localStorage.setItem(`${COL_NS}:${key}`, JSON.stringify(c));
  } catch { /* private mode: the choice lasts until the page closes */ }
}

/**
 * Which columns render: the viewer's hidden ones never, the ones they chose
 * to show always, and the rest by the card-width priority rule. Pure, so
 * the rule is tested without a DOM.
 */
export function visibleTableColumns<T>(
  all: TableColumn<T>[],
  cardWidth: number,
  fixed: number,
  choice: ColumnChoice = { shown: [], hidden: [] },
): TableColumn<T>[] {
  const hidden = new Set(choice.hidden);
  const forced = new Set(choice.shown);
  const base = all.filter((c) => c.title || !hidden.has(c.key));
  if (cardWidth === 0) return base;
  let cols = base.filter((c) => forced.has(c.key) || !c.hideBelow || cardWidth >= c.hideBelow);
  const minOf = (c: TableColumn<T>) => { const m = /(\d+)px/.exec(c.width ?? ""); return m ? Number(m[1]) : 120; };
  const total = () => cols.reduce((w, c) => w + minOf(c), fixed);
  while (total() > cardWidth) {
    const droppable = cols.filter((c) => c.hideBelow && !forced.has(c.key));
    if (droppable.length === 0) break;
    const drop = droppable.reduce((a, b) => ((b.hideBelow ?? 0) > (a.hideBelow ?? 0) ? b : a));
    cols = cols.filter((c) => c !== drop);
  }
  return cols;
}

const CELL = "flex min-w-0 items-center px-3";

function alignClass(align?: "start" | "end" | "center", numeric?: boolean): string {
  if (numeric || align === "end") return "justify-end text-end tabular-nums";
  if (align === "center") return "justify-center text-center";
  return "";
}

export function TableCard<T>({
  columns: allColumns,
  rows,
  rowKey,
  rowHref,
  onRowClick,
  selectable = false,
  isRowSelectable,
  selected,
  onSelectedChange,
  sort,
  onSort,
  rowMenu,
  rowMenuWidth = 44,
  rowMenuAlwaysVisible = false,
  empty,
  footer,
  bulkActions,
  skeletonRows = 8,
  highlightKey,
  onRowContextMenu,
  onRowDeleteKey,
  className,
  ariaLabel,
  groupOf,
  collapsedGroups,
  onToggleGroup,
  columnSettings,
  columnChoice,
  onColumnChoiceChange,
}: TableCardProps<T>) {
  const bodyRef = useRef<HTMLDivElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const cardWidth = useElementWidth(cardRef);
  const scrollRef = useRef<HTMLDivElement>(null);
  // The room the columns really get: the card less its two 1px borders and
  // any vertical scrollbar the body scroller draws (a classic scrollbar is
  // about 15px; an overlay one is 0). Without these the fit below believed
  // the row had room it did not, and the pinned end cell covered the last
  // column ("Signed up" read "Sign").
  const gutter = useScrollGutter(scrollRef, cardWidth);
  // The columns this card is wide enough for. Unmeasured (the first frame,
  // a test) shows every column.
  // Beyond each column's own hideBelow, the droppable columns (the ones
  // that declared a hideBelow) also give way, widest threshold first, while
  // the row's minimum is wider than the card: otherwise the pinned "..."
  // cell sits over the last visible column and cuts it mid-word (a date
  // reading "17 S" with the Filter panel open).
  const settingsKey = typeof columnSettings === "object" ? columnSettings.storageKey : undefined;
  const [localChoice, setChoice] = useState<ColumnChoice>({ shown: [], hidden: [] });
  const choice = columnChoice ?? localChoice;
  // Read after mount, so server render and hydration agree.
  // The setState runs in a timer (the bulk bar's pattern), after the first paint.
  useEffect(() => {
    if (!settingsKey || columnChoice !== undefined) return;
    const t = setTimeout(() => setChoice(readChoice(settingsKey)), 0);
    return () => clearTimeout(t);
  }, [settingsKey, columnChoice]);
  const controlled = columnChoice !== undefined;
  const updateChoice = useCallback((next: ColumnChoice) => {
    if (controlled) { onColumnChoiceChange?.(next); return; }
    setChoice(next); writeChoice(settingsKey, next);
  }, [settingsKey, controlled, onColumnChoiceChange]);
  const columns = useMemo(
    () =>
      visibleTableColumns(
        allColumns,
        cardWidth,
        (selectable ? 44 : 0) + (rowMenu ? rowMenuWidth : 0) + (cardWidth > 0 ? 2 + gutter : 0),
        choice,
      ),
    [allColumns, cardWidth, selectable, rowMenu, rowMenuWidth, choice, gutter],
  );
  const [settingsOpen, setSettingsOpen] = useState(false);
  const settingsBtnRef = useRef<HTMLButtonElement>(null);
  const settingsButton = columnSettings ? (
    <button
      ref={settingsBtnRef}
      type="button"
      onClick={(e) => { e.stopPropagation(); setSettingsOpen((x) => !x); }}
      aria-label="Column settings"
      aria-haspopup="dialog"
      aria-expanded={settingsOpen}
      title="Column settings"
      className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-ink-2 hover:bg-hover hover:text-ink"
    >
      <Settings2 className="h-4 w-4" strokeWidth={1.5} aria-hidden />
    </button>
  ) : null;
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
    if (rowMenu) tracks.push(`${rowMenuWidth}px`);
    return tracks.join(" ");
  }, [columns, selectable, rowMenu, rowMenuWidth]);

  const allKeys = useMemo(
    () => (rows ?? []).filter((r) => !isRowSelectable || isRowSelectable(r)).map(rowKey),
    [rows, rowKey, isRowSelectable],
  );
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

  // The list keyboard (spec-tables-forms section 1: every right-click action
  // has a keyboard path). On a focused row: j / ArrowDown and k / ArrowUp move
  // between rows, Space selects it (when rows are selectable), "." opens its
  // "..." menu, and Cmd/Ctrl+Backspace runs onRowDeleteKey. Typing in an
  // input inside a row is never intercepted, and Space or "." on a button
  // inside a row keeps that button's own meaning.
  function onBodyKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    const t = e.target as HTMLElement;
    if (t.isContentEditable || t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement || t instanceof HTMLSelectElement) return;
    const rowEl = t.closest<HTMLElement>("[role=row][data-key]");
    const body = bodyRef.current;
    if (!rowEl || !body || !body.contains(rowEl) || !rows) return;
    const plain = !e.metaKey && !e.ctrlKey && !e.altKey;
    const list = Array.from(body.querySelectorAll<HTMLElement>("[role=row][data-key]"));
    const idx = list.indexOf(rowEl);
    if (plain && (e.key === "j" || e.key === "ArrowDown" || e.key === "k" || e.key === "ArrowUp")) {
      const next = list[idx + (e.key === "j" || e.key === "ArrowDown" ? 1 : -1)];
      if (next) { e.preventDefault(); next.focus(); }
      return;
    }
    if (t !== rowEl) return;
    const key = rowEl.dataset.key ?? "";
    const row = rows.find((r) => rowKey(r) === key);
    if (!row) return;
    if (plain && e.key === " " && selectable && (!isRowSelectable || isRowSelectable(row))) { e.preventDefault(); toggleOne(key); return; }
    if (plain && e.key === ".") {
      const more = rowEl.querySelector<HTMLElement>(".os-tc__more button, .os-tc__more [role=button]");
      if (more) { e.preventDefault(); more.click(); }
      return;
    }
    if ((e.metaKey || e.ctrlKey) && (e.key === "Backspace" || e.key === "Delete") && onRowDeleteKey) {
      e.preventDefault();
      onRowDeleteKey(row);
    }
  }

  const minWidth = useMemo(() => {
    // Sum of the fixed tracks plus 120 per fluid column, so the card scrolls
    // sideways inside itself rather than squashing cells to nothing.
    let w = (selectable ? 44 : 0) + (rowMenu ? rowMenuWidth : 0);
    for (const c of columns) {
      const m = /(\d+)px/.exec(c.width ?? "");
      w += m ? Number(m[1]) : 120;
    }
    return w;
  }, [columns, selectable, rowMenu, rowMenuWidth]);

  return (
    <div ref={cardRef} className={cn("os-tc os-chrome os-row relative flex min-h-0 flex-col overflow-hidden rounded-lg border border-line bg-raised", rowMenuAlwaysVisible ? "os-tc--menus-visible" : "", className)} role="table" aria-label={ariaLabel}>
      <div ref={scrollRef} className="min-h-0 flex-1 overflow-auto">
        <div ref={bodyRef} style={{ minWidth }} onKeyDown={onBodyKeyDown}>
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
            {columns.map((c, ci) => {
              const sorted = sort?.key === c.key ? sort.dir : null;
              // Without a row menu the settings control is pinned over the end
              // of the header (below), so the last header cell leaves it room.
              const endRoom = !rowMenu && settingsButton && ci === columns.length - 1;
              const inner = (
                <>
                  <span className="truncate">{c.label}</span>
                  {sorted ? (sorted === "asc" ? <ChevronUp className="h-3 w-3 shrink-0" strokeWidth={1.5} aria-hidden /> : <ChevronDown className="h-3 w-3 shrink-0" strokeWidth={1.5} aria-hidden />) : null}
                </>
              );
              return (
                <div key={c.key} role="columnheader" aria-sort={sorted ? (sorted === "asc" ? "ascending" : "descending") : undefined} className={cn(CELL, "gap-1", alignClass(c.align, c.numeric), c.className, endRoom ? "pe-11" : "")}>
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
            {rowMenu ? (
              settingsButton
                ? <div className={cn(CELL, "sticky end-0 justify-center bg-[var(--os-table-head-bg)] px-0")}>{settingsButton}</div>
                : <div className={cn(CELL, "sticky end-0 bg-[var(--os-table-head-bg)]")} aria-hidden />
            ) : null}
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
              const group = groupOf ? groupOf(row) : null;
              const startsGroup = !!group && (i === 0 || groupOf!(rows[i - 1]).key !== group.key);
              const groupCollapsed = !!group && !!collapsedGroups?.has(group.key);
              const header = startsGroup && group ? (
                <div key={`group:${group.key}:${i}`} role="row" className="os-tc__group border-b border-line-soft bg-subtle">
                  <button
                    type="button"
                    role="rowheader"
                    aria-expanded={!groupCollapsed}
                    onClick={onToggleGroup ? () => onToggleGroup(group.key) : undefined}
                    className="flex h-11 w-full items-center gap-2 px-4 text-start"
                  >
                    {onToggleGroup ? (
                      groupCollapsed ? <ChevronRight className="h-3.5 w-3.5 shrink-0 text-ink-2 rtl:rotate-180" strokeWidth={1.5} aria-hidden /> : <ChevronDown className="h-3.5 w-3.5 shrink-0 text-ink-2" strokeWidth={1.5} aria-hidden />
                    ) : null}
                    <span className="truncate text-row font-medium text-ink">{group.label}</span>
                    {group.count != null ? <span className="text-xs font-medium tabular-nums text-ink-2">{group.count}</span> : null}
                  </button>
                </div>
              ) : null;
              if (groupCollapsed) return header;
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
                // The same state as a tint the sticky "..." cell paints over
                // the card surface (see `more` below). Chosen here rather than
                // stacked as classes, so two hover rules never race.
                isSel
                  ? "[--tc-tint:var(--os-selected)] hover:[--tc-tint:var(--os-selected-hov)]"
                  : cn(isHi ? "[--tc-tint:var(--os-selected)]" : "", "hover:[--tc-tint:var(--os-surface-hov)] focus-within:[--tc-tint:var(--os-surface-hov)]"),
              );
              const style = { gridTemplateColumns: template, height: "var(--os-row-h)" } as React.CSSProperties;
              const stop = (e: React.MouseEvent) => e.stopPropagation();
              const check = selectable && isRowSelectable && !isRowSelectable(row) ? (
                <div className={CELL} aria-hidden />
              ) : selectable ? (
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
              // The "..." column is pinned to the card's end edge. When the
              // columns are wider than the card (a narrow window, the Filter
              // panel open) the other cells scroll sideways under it, so the
              // row menu is never parked behind a scroll nobody can see
              // (overlay scrollbars draw nothing). It needs an opaque fill for
              // that: the card surface with the row's state tint on top, since
              // the selected tint is translucent in dark mode. Every row menu
              // opens through MorePortal, so the stacking context sticky makes
              // cannot clip a menu.
              const more = rowMenu ? (
                <div
                  className={cn(CELL, "os-tc__more sticky end-0 justify-center bg-raised")}
                  style={{ backgroundImage: "linear-gradient(var(--tc-tint, transparent), var(--tc-tint, transparent))" }}
                  onClick={stop}
                >
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
                const link = (
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
                return header ? <Fragment key={key}>{header}{link}</Fragment> : link;
              }
              const plain = (
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
              return header ? <Fragment key={key}>{header}{plain}</Fragment> : plain;
            })
          )}
        </div>
      </div>

      {/* Pinned to the card's top end, outside the sideways scroll, so it is
          reachable (to put columns back) however far the table scrolls. */}
      {settingsButton && !rowMenu ? (
        <div className="absolute end-0 top-0 z-[2] flex h-11 items-center border-b border-line bg-[var(--os-table-head-bg)] px-2">{settingsButton}</div>
      ) : null}
      {footer ? <TableCardFooter {...footer} /> : null}

      {settingsOpen && columnSettings ? (
        <ColumnSettingsPopover
          anchorRef={settingsBtnRef}
          columns={allColumns}
          visible={new Set(columns.map((c) => c.key))}
          choice={choice}
          onChange={updateChoice}
          onClose={() => setSettingsOpen(false)}
        />
      ) : null}

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

function TableCardFooter({ total, noun, from, to, onPrev, onNext, pageSize, pageSizes = [40, 100], onPageSize, extra, trailing, hidePaging }: TableFooter) {
  const hasRows = total > 0;
  return (
    <div className="group/foot flex h-11 shrink-0 items-center gap-3 border-t border-line px-4 text-sm">
      <span className="font-medium text-ink">
        Total {noun} <span className="tabular-nums">{new Intl.NumberFormat().format(total)}</span>
      </span>
      {extra ? <span className="text-ink-2">{extra}</span> : null}
      <span className="flex-1" />
      {trailing ? <span className="min-w-0 truncate text-ink-2">{trailing}</span> : null}
      {onPageSize && pageSize ? (
        // Shown on hover, and to the keyboard: opacity (not display:none),
        // so Tab still reaches the select and it shows while it has focus.
        <label className="inline-flex items-center gap-1 text-xs text-ink-2 opacity-0 transition-opacity focus-within:opacity-100 group-hover/foot:opacity-100">
          Rows
          <select value={pageSize} onChange={(e) => onPageSize(Number(e.target.value))} className="h-7 rounded-md border border-line bg-raised px-1.5 text-xs text-ink">
            {pageSizes.map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
        </label>
      ) : null}
      {hidePaging ? null : <>
      <span className="tabular-nums text-ink-2">{hasRows ? `${from} to ${to}` : "0 to 0"}</span>
      <span className="inline-flex items-center">
        <button type="button" onClick={onPrev} disabled={!onPrev} aria-label="Previous page" className="inline-flex h-8 w-8 items-center justify-center rounded-md text-ink-2 hover:bg-hover hover:text-ink disabled:opacity-40 disabled:hover:bg-transparent">
          <ChevronLeft className="h-4 w-4 rtl:rotate-180" strokeWidth={1.5} aria-hidden />
        </button>
        <button type="button" onClick={onNext} disabled={!onNext} aria-label="Next page" className="inline-flex h-8 w-8 items-center justify-center rounded-md text-ink-2 hover:bg-hover hover:text-ink disabled:opacity-40 disabled:hover:bg-transparent">
          <ChevronRight className="h-4 w-4 rtl:rotate-180" strokeWidth={1.5} aria-hidden />
        </button>
      </span>
      </>}
    </div>
  );
}

/**
 * The column settings popover: one switch row per column (the title column
 * always shows). Portaled to <body> with fixed coordinates, because the
 * card clips its own overflow. Esc and an outside click close it.
 */
function ColumnSettingsPopover<T>({ anchorRef, columns, visible, choice, onChange, onClose }: {
  anchorRef: React.RefObject<HTMLElement | null>;
  columns: TableColumn<T>[];
  visible: Set<string>;
  choice: ColumnChoice;
  onChange: (next: ColumnChoice) => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  useEffect(() => {
    const anchor = anchorRef.current;
    const place = () => {
      if (!anchor) return;
      const r = anchor.getBoundingClientRect();
      const w = 240;
      setPos({ top: r.bottom + 4, left: Math.max(8, Math.min(window.innerWidth - w - 8, r.right - w)) });
    };
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => { window.removeEventListener("resize", place); window.removeEventListener("scroll", place, true); };
  }, [anchorRef]);
  useEffect(() => {
    const anchor = anchorRef.current;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") { e.stopPropagation(); onClose(); anchor?.focus(); } };
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (ref.current?.contains(t) || anchor?.contains(t)) return;
      onClose();
    };
    window.addEventListener("keydown", onKey, true);
    window.addEventListener("mousedown", onDown);
    return () => { window.removeEventListener("keydown", onKey, true); window.removeEventListener("mousedown", onDown); };
  }, [anchorRef, onClose]);
  if (typeof document === "undefined" || !pos) return null;
  const toggle = (key: string, on: boolean) => {
    const shown = new Set(choice.shown);
    const hidden = new Set(choice.hidden);
    if (on) { hidden.delete(key); shown.add(key); } else { shown.delete(key); hidden.add(key); }
    onChange({ shown: [...shown], hidden: [...hidden] });
  };
  const changed = choice.shown.length > 0 || choice.hidden.length > 0;
  return createPortal(
    <div
      ref={ref}
      role="dialog"
      aria-label="Column settings"
      className="workwrk-os fixed z-[80] w-[240px] rounded-lg border border-line bg-raised py-1 text-row text-ink"
      style={{ top: pos.top, left: pos.left, boxShadow: "var(--os-shadow-pop)" }}
    >
      <p className="m-0 px-3 pb-1 pt-1.5 text-xs font-semibold uppercase tracking-wide text-ink-2">Columns</p>
      {columns.filter((c) => c.label !== "" && c.label != null).map((c) => (
        <label key={c.key} className={cn("flex h-8 items-center gap-2 px-3", c.title ? "text-ink-2" : "cursor-pointer hover:bg-hover")}>
          <input
            type="checkbox"
            className="os-tc__check h-4 w-4 accent-[var(--os-brand)]"
            checked={c.title ? true : visible.has(c.key)}
            disabled={c.title}
            onChange={(e) => toggle(c.key, e.target.checked)}
          />
          <span className="min-w-0 flex-1 truncate">{c.label}</span>
        </label>
      ))}
      <p className="m-0 border-t border-line-soft px-3 pb-1 pt-1.5 text-xs text-ink-2">Columns that do not fit scroll sideways inside the table.</p>
      {changed ? (
        <button type="button" onClick={() => onChange({ shown: [], hidden: [] })} className="mx-1 mb-1 flex h-8 w-[calc(100%-8px)] items-center rounded-md px-2 text-start text-sm text-ink-2 hover:bg-hover hover:text-ink">
          Reset to fit the width
        </button>
      ) : null}
    </div>,
    document.body,
  );
}

/**
 * The width of the vertical scrollbar `ref` draws (offsetWidth less
 * clientWidth), re-read whenever the element or its content resizes. 0 for
 * overlay scrollbars and before the first measurement.
 */
function useScrollGutter(ref: React.RefObject<HTMLElement | null>, cardWidth: number): number {
  const [gutter, setGutter] = useState(0);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const read = () => setGutter(Math.max(0, el.offsetWidth - el.clientWidth));
    read();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(read);
    ro.observe(el);
    if (el.firstElementChild) ro.observe(el.firstElementChild);
    return () => ro.disconnect();
  }, [ref, cardWidth]);
  return gutter;
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
