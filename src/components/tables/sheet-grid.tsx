"use client";

/* SheetGrid — the spreadsheet kernel (Tables Phase 1, docs/plans/tables.md).
 *
 * What it owns: virtualized rows, the selection model (active cell +
 * anchor + rectangular range), full keyboard navigation, frozen first
 * column, row multi-select + bulk delete, sortable headers.
 *
 * What it does NOT own: cell semantics. Display and editing are render
 * props — the page supplies them from its existing type-specific cells,
 * so all 18 column types keep working unchanged. Cells render as cheap
 * display values; ONLY the active cell mounts a live editor. That's the
 * real-spreadsheet pattern, and it's what makes virtualization worth it.
 *
 * Selection is keyed by rowId, never by row index: an instant-commit
 * editor (select/checkbox/rating) can change the value the grid is sorted
 * by, which reorders rowIds under the open editor. An index would then
 * point at a different record and the next commit would write to the
 * wrong row.
 *
 * Keyboard map: arrows move · Shift+arrows extend · Tab/Shift+Tab move
 * horizontally · Enter edits (or commits an edit and moves down) ·
 * F2/double-click edits · typing replaces · Escape cancels · Delete/
 * Backspace clears the selection · Cmd/Ctrl+A selects all.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowDown, ArrowUp, ChevronRight, Trash2 } from "lucide-react";

export const SHEET_ROW_H = 33;
const OVERSCAN = 8;
const HANDLE_W = 76; // checkbox + expand, frozen
const COL_W = 180;   // default column width

/* Every caret in the grid — the page's column-rename input in the sticky
 * header, a mounted cell editor — sits INSIDE the grid div, so its
 * keystrokes bubble to the grid's handler. Grid shortcuts must never fire
 * while the user is typing into a field: Backspace would wipe the selected
 * cells instead of deleting a character. */
const EDITABLE_SEL = 'input, textarea, select, [contenteditable]:not([contenteditable="false"])';

/* Keys that activate the grid when nothing is selected yet. Tab is
 * deliberately excluded: it stays the keyboard user's way OUT of the grid. */
const SEED_KEYS = new Set(["ArrowDown", "ArrowUp", "ArrowRight", "ArrowLeft", "PageDown", "PageUp", "Home", "End"]);

export type SheetSort = { colId: string; dir: "asc" | "desc" } | null;

export type SheetGridProps = {
  columns: { id: string; label: string; width?: number }[];
  rowIds: string[];
  /** Cheap display value for a cell — plain text/nodes, no live inputs. */
  renderDisplay: (rowId: string, colId: string) => React.ReactNode;
  /** Live editor for the active cell. Call commit() (with the editor's
   *  blur) when done; the kernel moves focus back to the grid. */
  renderEditor: (rowId: string, colId: string, opts: { seed: string | null; commit: () => void }) => React.ReactNode;
  /** Clear these cells (Delete key / future paste-empty). */
  onClearCells: (cells: { rowId: string; colId: string }[]) => void;
  onDeleteRows: (rowIds: string[]) => void;
  onOpenRow: (rowId: string) => void;
  onRowContextMenu?: (rowId: string, x: number, y: number) => void;
  sort: SheetSort;
  onSortChange: (sort: SheetSort) => void;
  /** Header extras (type icon, rename input, config buttons) — the page's
   *  existing header cell, rendered inside the kernel's th. */
  renderHeader: (colId: string) => React.ReactNode;
  headerTrailing?: React.ReactNode; // the add-column menu
  footer?: React.ReactNode;         // the add-row button
  /** Which column types can't take keyboard-seeded editing (computed). */
  readOnlyCols?: Set<string>;
};

type Cell = { rowId: string; c: number };

export function SheetGrid({
  columns, rowIds, renderDisplay, renderEditor, onClearCells, onDeleteRows,
  onOpenRow, onRowContextMenu, sort, onSortChange, renderHeader, headerTrailing,
  footer, readOnlyCols,
}: SheetGridProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  const [viewport, setViewport] = useState({ top: 0, height: 600 });
  const [active, setActive] = useState<Cell | null>(null);
  const [anchor, setAnchor] = useState<Cell | null>(null);
  const [editing, setEditing] = useState<{ rowId: string; c: number; seed: string | null } | null>(null);
  const [checked, setChecked] = useState<Set<string>>(new Set());

  const rowCount = rowIds.length;
  const colCount = columns.length;

  /** rowId → current index. The only bridge between id-keyed state and the
   *  index geometry virtualization needs; re-derived whenever rows reorder. */
  const rowIndex = useMemo(() => {
    const m = new Map<string, number>();
    for (let i = 0; i < rowIds.length; i++) m.set(rowIds[i], i);
    return m;
  }, [rowIds]);

  /* ── virtualization ─────────────────────────────────────────── */
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const measure = () => setViewport({ top: el.scrollTop, height: el.clientHeight });
    measure();
    el.addEventListener("scroll", measure, { passive: true });
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => { el.removeEventListener("scroll", measure); ro.disconnect(); };
  }, []);

  const first = Math.max(0, Math.floor(viewport.top / SHEET_ROW_H) - OVERSCAN);
  const last = Math.min(rowCount, Math.ceil((viewport.top + viewport.height) / SHEET_ROW_H) + OVERSCAN);

  /* ── geometry ───────────────────────────────────────────────── */
  // Columns aren't virtualized, but horizontal scrolling still needs their
  // real left edges: offs[c] = left of column c, offs[c + 1] = its right.
  const colOffsets = useMemo(() => {
    const offs = [HANDLE_W];
    for (const col of columns) offs.push(offs[offs.length - 1] + (col.width ?? COL_W));
    return offs;
  }, [columns]);

  /* ── selection helpers ──────────────────────────────────────── */
  const range = useMemo(() => {
    if (!active) return null;
    const ar = rowIndex.get(active.rowId);
    if (ar == null) return null;
    // A stale anchor (its row deleted or filtered away) collapses to the
    // active cell rather than selecting a wrong rectangle.
    const anr = anchor ? rowIndex.get(anchor.rowId) : undefined;
    const a = anchor && anr != null ? { r: anr, c: anchor.c } : { r: ar, c: active.c };
    return {
      r1: Math.min(a.r, ar), r2: Math.max(a.r, ar),
      c1: Math.min(a.c, active.c), c2: Math.max(a.c, active.c),
    };
  }, [active, anchor, rowIndex]);

  const inRange = (r: number, c: number) =>
    !!range && r >= range.r1 && r <= range.r2 && c >= range.c1 && c <= range.c2;

  const scrollCellIntoView = useCallback((r: number, c: number) => {
    const el = scrollRef.current;
    if (!el) return;
    const top = r * SHEET_ROW_H;
    const bottom = top + SHEET_ROW_H;
    if (top < el.scrollTop) el.scrollTop = top;
    else if (bottom > el.scrollTop + el.clientHeight - SHEET_ROW_H) el.scrollTop = bottom - el.clientHeight + SHEET_ROW_H;
    const left = colOffsets[c];
    const right = colOffsets[c + 1];
    if (left == null || right == null) return;
    // The handle column is sticky-left, so it covers the first HANDLE_W px
    // of the viewport — a cell isn't really visible until it clears that.
    if (left - HANDLE_W < el.scrollLeft) el.scrollLeft = Math.max(0, left - HANDLE_W);
    else if (right > el.scrollLeft + el.clientWidth) el.scrollLeft = right - el.clientWidth;
  }, [colOffsets]);

  const activeRef = useRef<Cell | null>(null);
  useEffect(() => { activeRef.current = active; }, [active]);

  /** Activate the first cell. Used for keyboard-only entry (arrows before
   *  any click) and when the active row has been filtered away. */
  const seedActive = useCallback(() => {
    if (rowCount === 0 || colCount === 0) return;
    setAnchor(null);
    setActive({ rowId: rowIds[0], c: 0 });
    scrollCellIntoView(0, 0);
  }, [rowCount, colCount, rowIds, scrollCellIntoView]);

  const move = useCallback((dr: number, dc: number, extend: boolean) => {
    if (rowCount === 0 || colCount === 0) return;
    const cur = activeRef.current;
    const curR = cur ? rowIndex.get(cur.rowId) : undefined;
    if (!cur || curR == null) { seedActive(); return; }
    const r = Math.max(0, Math.min(rowCount - 1, curR + dr));
    const c = Math.max(0, Math.min(colCount - 1, cur.c + dc));
    if (extend) setAnchor((a) => a ?? cur);
    else setAnchor(null);
    setActive({ rowId: rowIds[r], c });
    scrollCellIntoView(r, c);
  }, [rowCount, colCount, rowIds, rowIndex, seedActive, scrollCellIntoView]);

  // commitEdit must stay ref-free: it is passed into renderEditor during
  // render, so the compiler requires it not to read refs. The refocus
  // happens in the effect below when editing closes.
  const commitEdit = useCallback(() => setEditing(null), []);
  useEffect(() => {
    if (!editing) {
      const t = requestAnimationFrame(() => {
        const el = gridRef.current;
        if (!el) return;
        // Reclaim focus only when the editor's unmount dropped it on the
        // floor. If the user clicked into something real (the header rename
        // input, a toolbar button), leave their caret where they put it.
        const ae = document.activeElement;
        if (ae && ae !== document.body && ae !== el) return;
        el.focus();
      });
      return () => cancelAnimationFrame(t);
    }
  }, [editing]);

  // A row can vanish under an open editor (deleted, or filtered out by a
  // value the editor itself just changed). Close without committing —
  // there is no longer a record to write to — so the grid isn't left
  // keyboard-dead behind the `editing` guard below, and a stale seed can
  // never resurrect into a row that comes back. Adjusted during render,
  // not in an effect: an effect would commit a frame with a dead editor
  // and the compiler rejects synchronous setState there.
  if (editing && !rowIndex.has(editing.rowId)) setEditing(null);

  /* ── keyboard ───────────────────────────────────────────────── */
  const onKeyDown = (e: React.KeyboardEvent) => {
    const target = e.target as HTMLElement | null;
    if (target?.closest?.(EDITABLE_SEL)) return;

    if (editing) {
      // The editor owns keys while open; kernel only handles Escape as a
      // safety net (editors also handle it).
      if (e.key === "Escape") { e.stopPropagation(); commitEdit(); }
      return;
    }

    const activeR = active ? rowIndex.get(active.rowId) : undefined;
    if (!active || activeR == null) {
      // Keyboard-only entry: nothing is selected (or the selected row is
      // gone), so a navigation key activates the first cell instead of
      // being swallowed.
      if (!SEED_KEYS.has(e.key)) return;
      e.preventDefault();
      seedActive();
      return;
    }

    const extend = e.shiftKey;
    switch (e.key) {
      case "ArrowDown": e.preventDefault(); move(1, 0, extend); return;
      case "ArrowUp": e.preventDefault(); move(-1, 0, extend); return;
      case "ArrowRight": e.preventDefault(); move(0, 1, extend); return;
      case "ArrowLeft": e.preventDefault(); move(0, -1, extend); return;
      case "PageDown": e.preventDefault(); move(Math.max(1, Math.floor(viewport.height / SHEET_ROW_H) - 2), 0, extend); return;
      case "PageUp": e.preventDefault(); move(-Math.max(1, Math.floor(viewport.height / SHEET_ROW_H) - 2), 0, extend); return;
      case "Home": e.preventDefault(); setAnchor(extend ? (anchor ?? active) : null); setActive({ rowId: active.rowId, c: 0 }); scrollCellIntoView(activeR, 0); return;
      case "End": e.preventDefault(); setAnchor(extend ? (anchor ?? active) : null); setActive({ rowId: active.rowId, c: colCount - 1 }); scrollCellIntoView(activeR, colCount - 1); return;
      case "Tab":
        e.preventDefault();
        setAnchor(null);
        move(0, e.shiftKey ? -1 : 1, false);
        return;
      case "Enter": {
        e.preventDefault();
        const colId = columns[active.c]?.id;
        if (colId && !readOnlyCols?.has(colId)) setEditing({ rowId: active.rowId, c: active.c, seed: null });
        return;
      }
      case "F2": {
        e.preventDefault();
        const colId = columns[active.c]?.id;
        if (colId && !readOnlyCols?.has(colId)) setEditing({ rowId: active.rowId, c: active.c, seed: null });
        return;
      }
      case "Delete":
      case "Backspace": {
        e.preventDefault();
        if (!range) return;
        const cells: { rowId: string; colId: string }[] = [];
        for (let r = range.r1; r <= range.r2; r++) {
          const rowId = rowIds[r];
          if (!rowId) continue;
          for (let c = range.c1; c <= range.c2; c++) {
            const colId = columns[c]?.id;
            if (colId && !readOnlyCols?.has(colId)) cells.push({ rowId, colId });
          }
        }
        if (cells.length > 0) onClearCells(cells);
        return;
      }
      case "Escape": setAnchor(null); return;
      case "a": case "A":
        if (e.metaKey || e.ctrlKey) {
          e.preventDefault();
          if (rowCount > 0 && colCount > 0) { setAnchor({ rowId: rowIds[0], c: 0 }); setActive({ rowId: rowIds[rowCount - 1], c: colCount - 1 }); }
        }
        return;
      default: {
        const colId = columns[active.c]?.id;
        if (!colId || readOnlyCols?.has(colId)) return;
        // IME composition starts arrive as "Process" (keyCode 229) and dead
        // keys as "Dead" — never a 1-char key — so without this branch CJK
        // and accent users could never type into a cell. No preventDefault:
        // that would kill the composition before the editor mounts.
        if (e.key === "Process" || e.keyCode === 229 || e.key === "Dead") {
          setEditing({ rowId: active.rowId, c: active.c, seed: null });
          return;
        }
        // Type-to-replace: a single printable character starts editing
        // seeded with that character.
        if (e.key.length === 1 && !e.metaKey && !e.ctrlKey && !e.altKey) {
          e.preventDefault();
          setEditing({ rowId: active.rowId, c: active.c, seed: e.key });
        }
      }
    }
  };

  /* ── row checkboxes ─────────────────────────────────────────── */
  // Stale checks (rows deleted/filtered away) are pruned by DERIVING the
  // live set at render — no state write needed, dead ids are just inert.
  const liveChecked = useMemo(() => {
    const live = new Set(rowIds);
    return new Set([...checked].filter((id) => live.has(id)));
  }, [checked, rowIds]);
  const allChecked = rowCount > 0 && liveChecked.size === rowCount;
  const toggleAll = () => setChecked(allChecked ? new Set() : new Set(rowIds));
  const toggleRow = (rowId: string) =>
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(rowId)) next.delete(rowId); else next.add(rowId);
      return next;
    });

  const cycleSort = (colId: string) => {
    if (sort?.colId !== colId) onSortChange({ colId, dir: "asc" });
    else if (sort.dir === "asc") onSortChange({ colId, dir: "desc" });
    else onSortChange(null);
  };

  const gridWidth = colOffsets[colOffsets.length - 1] + 44;

  /* Rows to mount: the virtual window, PLUS the row being edited if it has
   * scrolled out of it. Unmounting an open editor is not a blur, so the
   * editor host would never commit and the typed value would be lost.
   *
   * The pinned row keeps its sorted position (before/after the window, not
   * appended): React moves a DOM node whose sibling order changes, and
   * moving a node blurs whatever is focused inside it. Staying at the edge
   * it already occupied means no move, so the caret survives the scroll. */
  const mounted: { rowId: string; r: number }[] = [];
  for (let r = first; r < last; r++) mounted.push({ rowId: rowIds[r], r });
  const editingR = editing ? rowIndex.get(editing.rowId) : undefined;
  if (editing && editingR != null) {
    if (editingR < first) mounted.unshift({ rowId: editing.rowId, r: editingR });
    else if (editingR >= last) mounted.push({ rowId: editing.rowId, r: editingR });
  }

  /* ── render ─────────────────────────────────────────────────── */
  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      {liveChecked.size > 0 && (
        <div className="absolute left-1/2 -translate-x-1/2 bottom-16 z-30 flex items-center gap-3 rounded-xl border border-zinc-200 bg-white px-4 h-11 shadow-lg">
          <span className="text-[13px] text-zinc-700 font-medium">{liveChecked.size} selected</span>
          <button
            type="button"
            onClick={() => { onDeleteRows([...liveChecked]); setChecked(new Set()); }}
            className="inline-flex items-center gap-1.5 h-7 px-2.5 rounded-md text-[13px] text-red-600 hover:bg-red-50"
          >
            <Trash2 className="w-3.5 h-3.5" /> Delete
          </button>
          <button type="button" onClick={() => setChecked(new Set())} className="text-[13px] text-zinc-400 hover:text-zinc-700">
            Clear
          </button>
        </div>
      )}

      <div
        ref={scrollRef}
        className="min-h-0 flex-1 overflow-auto rounded-lg border border-zinc-200 bg-white outline-none"
      >
        <div
          ref={gridRef}
          role="grid"
          aria-rowcount={rowCount}
          aria-colcount={colCount}
          tabIndex={0}
          onKeyDown={onKeyDown}
          className="relative outline-none"
          style={{ width: gridWidth, minWidth: "100%" }}
        >
          {/* Header */}
          <div className="sticky top-0 z-20 flex border-b border-zinc-200 bg-zinc-50/95 backdrop-blur" style={{ height: SHEET_ROW_H }}>
            <div className="sticky left-0 z-10 flex items-center gap-1 border-r border-zinc-200 bg-zinc-50 px-2" style={{ width: HANDLE_W, minWidth: HANDLE_W }}>
              <input type="checkbox" checked={allChecked} onChange={toggleAll} aria-label="Select all rows" className="accent-[#0073EA]" />
            </div>
            {columns.map((col, ci) => (
              <div
                key={col.id}
                role="columnheader"
                className="group/head flex items-center border-r border-zinc-100 px-1"
                style={{ width: col.width ?? COL_W, minWidth: col.width ?? COL_W }}
              >
                <div className="min-w-0 flex-1">{renderHeader(col.id)}</div>
                <button
                  type="button"
                  onClick={() => cycleSort(col.id)}
                  title={sort?.colId === col.id ? (sort.dir === "asc" ? "Sorted A→Z — click for Z→A" : "Sorted Z→A — click to unsort") : "Sort"}
                  className={`shrink-0 inline-flex h-5 w-5 items-center justify-center rounded ${
                    sort?.colId === col.id ? "text-[#0073EA]" : "text-transparent group-hover/head:text-zinc-300 hover:!text-zinc-600"
                  }`}
                >
                  {sort?.colId === col.id && sort.dir === "desc" ? <ArrowDown className="w-3.5 h-3.5" /> : <ArrowUp className="w-3.5 h-3.5" />}
                </button>
                <span data-colindex={ci} className="hidden" />
              </div>
            ))}
            <div className="flex items-center px-1" style={{ width: 44 }}>{headerTrailing}</div>
          </div>

          {/* Virtualized body */}
          <div style={{ height: rowCount * SHEET_ROW_H, position: "relative" }}>
            {rowCount === 0 ? (
              <div className="flex h-24 items-center justify-center text-[13px] text-zinc-400">No rows yet. Add one below.</div>
            ) : (
              mounted.map(({ rowId, r }) => (
                <div
                  key={rowId}
                  role="row"
                  aria-rowindex={r + 1}
                  className={`absolute left-0 right-0 flex border-b border-zinc-50 ${liveChecked.has(rowId) ? "bg-[#0073EA]/4" : ""}`}
                  style={{ top: r * SHEET_ROW_H, height: SHEET_ROW_H }}
                  onContextMenu={(e) => {
                    if ((e.target as HTMLElement).closest("input, textarea, [contenteditable=true]")) return;
                    if (!onRowContextMenu) return;
                    e.preventDefault();
                    onRowContextMenu(rowId, e.clientX, e.clientY);
                  }}
                >
                  <div className="sticky left-0 z-10 flex items-center gap-0.5 border-r border-zinc-200 bg-white px-2" style={{ width: HANDLE_W, minWidth: HANDLE_W }}>
                    <input
                      type="checkbox"
                      checked={liveChecked.has(rowId)}
                      onChange={() => toggleRow(rowId)}
                      aria-label="Select row"
                      className="accent-[#0073EA]"
                    />
                    <button
                      type="button"
                      onClick={() => onOpenRow(rowId)}
                      title="Open row"
                      className="inline-flex h-6 w-6 items-center justify-center rounded text-zinc-300 hover:bg-zinc-100 hover:text-zinc-600"
                    >
                      <ChevronRight className="w-3.5 h-3.5" />
                    </button>
                  </div>
                  {columns.map((col, c) => {
                    const isActive = active?.rowId === rowId && active.c === c;
                    const isEditing = editing?.rowId === rowId && editing.c === c;
                    const selected = inRange(r, c);
                    return (
                      <div
                        key={col.id}
                        role="gridcell"
                        aria-colindex={c + 1}
                        aria-selected={selected || isActive}
                        className={`flex items-center overflow-hidden border-r border-zinc-100 px-2 text-[13px] leading-tight ${
                          isActive ? "outline outline-2 -outline-offset-1 outline-[#0073EA] bg-white" : selected ? "bg-[#0073EA]/8" : ""
                        }`}
                        style={{ width: col.width ?? COL_W, minWidth: col.width ?? COL_W }}
                        onMouseDown={(e) => {
                          if (isEditing) return;
                          gridRef.current?.focus();
                          e.preventDefault();
                          if (e.shiftKey && active) { setAnchor((a) => a ?? active); setActive({ rowId, c }); }
                          else { setAnchor(null); setActive({ rowId, c }); }
                        }}
                        onDoubleClick={() => {
                          if (!readOnlyCols?.has(col.id)) setEditing({ rowId, c, seed: null });
                        }}
                      >
                        {isEditing ? (
                          <div className="w-full" onMouseDown={(e) => e.stopPropagation()}>
                            {renderEditor(rowId, col.id, { seed: editing.seed, commit: commitEdit })}
                          </div>
                        ) : (
                          <div className="w-full truncate pointer-events-none select-none">
                            {renderDisplay(rowId, col.id)}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              ))
            )}
          </div>
        </div>
      </div>
      {footer}
    </div>
  );
}
