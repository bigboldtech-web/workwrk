"use client";

/* SheetGrid — the spreadsheet kernel (Tables Phase 1, docs/plans/tables.md).
 *
 * What it owns: virtualized rows, the selection model (active cell +
 * anchor + rectangular range), full keyboard navigation, frozen first
 * column, and the Sheets-style row-number gutter: clicking a number
 * selects its row as a normal full-width range, dragging it reorders the
 * row (onRowMove). Sort UI and column operations live on the page —
 * headers here are pure content plus a right-click hook
 * (onHeaderContextMenu), exactly like Sheets.
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
 * Backspace clears the selection · Cmd/Ctrl+A selects all · Cmd/Ctrl+C/X/V
 * copy/cut/paste the selection · Cmd/Ctrl+D fills down · Cmd/Ctrl+R fills
 * right · Cmd/Ctrl+Z undoes · Shift+Cmd/Ctrl+Z and Ctrl+Y redo (page-owned
 * command stack; the grid only forwards).
 *
 * Phase 2 (clipboard + fill) keeps the same division of labour: the grid
 * owns geometry and gestures, the page owns data. The grid turns a
 * selection into a rectangle of { rowId, columnIndex } and asks the page to
 * read it (getRangeValues) or write it (applyMatrix); read-only columns,
 * row appends, batch chunking, optimistic update and rollback all live on
 * the page side of that line.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { fillSeries, parseClipboard, toHTMLTable, toTSV, type Matrix } from "@/lib/sheet-clipboard";

export const SHEET_ROW_H = 33;
const OVERSCAN = 8;
const GUTTER_W = 48; // row-number gutter, frozen (Sheets-sized: fits 4 digits)
const COL_W = 180;   // default column width

/* A pointer that travels further than this from its gutter pointerdown is a
 * row DRAG, not a click. Small enough that a deliberate drag converts almost
 * immediately, large enough that a twitchy click never moves a row. */
const ROW_DRAG_THRESHOLD_PX = 4;

/* Every caret in the grid — a mounted cell editor, anything the page renders
 * into a header — sits INSIDE the grid div, so its keystrokes bubble to the
 * grid's handler. Grid shortcuts must never fire while the user is typing
 * into a field: Backspace would wipe the selected cells instead of deleting
 * a character. */
const EDITABLE_SEL = 'input, textarea, select, [contenteditable]:not([contenteditable="false"])';

/** The active cell's page style minus its fill; see the gridcell `style`. */
function withoutBackground(style: React.CSSProperties | undefined): React.CSSProperties | undefined {
  if (!style || style.backgroundColor === undefined) return style;
  const rest = { ...style };
  delete rest.backgroundColor;
  return rest;
}

/* Keys that activate the grid when nothing is selected yet. Tab is
 * deliberately excluded: it stays the keyboard user's way OUT of the grid. */
const SEED_KEYS = new Set(["ArrowDown", "ArrowUp", "ArrowRight", "ArrowLeft", "PageDown", "PageUp", "Home", "End"]);

/** The page's sort state. The kernel renders NO sort UI (Sheets headers are
 *  pure letters; sorting lives in the page's header context menu) — the type
 *  stays exported from here so the page and any future surfaces share one
 *  shape. */
export type SheetSort = { colId: string; dir: "asc" | "desc" } | null;

/** A selection rectangle in CURRENT display coordinates. Only ever lives
 *  inside one interaction — every rectangle is resolved to rowIds against
 *  the live `rowIds` prop before it reaches the page. */
type Rect = { r1: number; r2: number; c1: number; c2: number };

/* Async Clipboard API write. Used only when the browser handed us no native
 * copy/cut event to write into: inside such an event `clipboardData.setData`
 * is synchronous and cannot half-fail after we have already suppressed the
 * browser's own copy, so it wins whenever it is available. Resolves false on
 * a denied permission rather than rejecting — a blocked clipboard must never
 * throw into React, and a cut must be able to see that the copy failed. */
async function writeClipboardAsync(tsv: string, html: string): Promise<boolean> {
  if (typeof ClipboardItem !== "undefined" && navigator.clipboard?.write) {
    try {
      await navigator.clipboard.write([
        new ClipboardItem({
          "text/plain": new Blob([tsv], { type: "text/plain" }),
          "text/html": new Blob([html], { type: "text/html" }),
        }),
      ]);
      return true;
    } catch {
      // Permission denied, unsupported MIME type, or the document lost
      // focus — fall through to the plain-text path.
    }
  }
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(tsv);
      return true;
    } catch {
      // Nothing else to try; the caller keeps the cells intact.
    }
  }
  return false;
}

/** Column overflow is clipped, never auto-creates columns. Rows are NOT
 *  clipped: overflowing the last row is an append, which the page performs.
 *  Short rows stay short (they write fewer cells) and empty rows stay in
 *  place — dropping one would shift every row below it up by one. */
function clipMatrix(m: string[][], c0: number, colCount: number): string[][] {
  const maxW = colCount - c0;
  if (maxW <= 0) return [];
  return m.map((row) => (Array.isArray(row) ? (row.length > maxW ? row.slice(0, maxW) : row) : []));
}

export type SheetGridProps = {
  columns: { id: string; label: string; width?: number }[];
  rowIds: string[];
  /** Cheap display value for a cell — plain text/nodes, no live inputs. */
  renderDisplay: (rowId: string, colId: string) => React.ReactNode;
  /** Live editor for the active cell. Call commit() (with the editor's
   *  blur) when done; the kernel moves focus back to the grid. */
  renderEditor: (rowId: string, colId: string, opts: { seed: string | null; commit: () => void }) => React.ReactNode;
  /** Clear these cells (Delete key). */
  onClearCells: (cells: { rowId: string; colId: string }[]) => void;
  /** Read values for a rectangular block. Grid supplies geometry, page owns
   *  data. cells is row-major: cells[r][c] = { rowId, c: columnIndex }. */
  getRangeValues: (cells: { rowId: string; c: number }[][]) => string[][];
  /** Write a matrix anchored at topLeft, row-major. The page is responsible
   *  for: skipping read-only columns, appending rows when the matrix
   *  overflows the bottom of the table, chunking to the batch cap, and
   *  optimistic update + rollback. Grid awaits it and does nothing else. */
  applyMatrix: (topLeft: { rowId: string; c: number }, matrix: string[][]) => Promise<void>;
  onRowContextMenu?: (rowId: string, x: number, y: number) => void;
  /** Right-click on a column header (Sheets' column-ops surface — the page
   *  hangs sort/rename/formula/delete off it). Default menu suppressed. */
  onHeaderContextMenu?: (colId: string, x: number, y: number) => void;
  /** Reorder a row by dragging its gutter number. Called ONCE per drop with
   *  the DISPLAY index the row should land at. Omit it and the gutter is
   *  click-select only — the page withholds it while sorted/filtered/
   *  streaming/read-only, where a display index is not a storage index. */
  onRowMove?: (rowId: string, toDisplayIndex: number) => void;
  /** The user walked off the bottom edge (ArrowDown / Enter-commit-move on
   *  the last row). Growth is page-owned (it appends real rows); the kernel
   *  only signals intent, throttled to once per second so a held key at the
   *  floor doesn't spam appends. */
  onGrowRows?: () => void;
  /** Cmd/Ctrl+Z / Shift+Cmd/Ctrl+Z / Ctrl+Y (Tables Phase 4). The grid only
   *  forwards the keystroke — the page owns the command stack. */
  onUndo?: () => void;
  onRedo?: () => void;
  /** Cmd/Ctrl+B / I / U while NOT editing (per-cell formatting). The grid
   *  only forwards the keystroke — the page owns the selection-to-style
   *  write. An open editor keeps the browser's own shortcuts. */
  onFormatKey?: (key: "b" | "i" | "u") => void;
  /** Extra inline style for a cell (per-cell formatting + conditional-
   *  formatting background). Page-owned semantics; the grid just paints
   *  what it is told, except that the ACTIVE cell drops backgroundColor
   *  so its white ground keeps the editor and outline legible. */
  cellStyle?: (rowId: string, colId: string) => React.CSSProperties | undefined;
  /** Selection readout (Tables Phase 5b stats). Called with the range's
   *  rowIds in CURRENT display order plus the inclusive column-index span
   *  when a multi-cell selection settles; null when the selection clears
   *  or collapses to a single cell. Coalesced to at most one call per
   *  animation frame and deduped by content, so wiring it costs the page
   *  nothing until the selection actually changes. */
  onSelectionChange?: (sel: { rowIds: string[]; c1: number; c2: number } | null) => void;
  /** The page's header cell content, rendered inside the kernel's
   *  columnheader (post-Sheets-parity: the bare A/B/C letter). */
  renderHeader: (colId: string) => React.ReactNode;
  headerTrailing?: React.ReactNode; // the add-column menu
  footer?: React.ReactNode;         // the add-row button
  /** Which column types can't take keyboard-seeded editing (computed). */
  readOnlyCols?: Set<string>;
};

type Cell = { rowId: string; c: number };

export function SheetGrid({
  columns, rowIds, renderDisplay, renderEditor, onClearCells,
  onRowContextMenu, onHeaderContextMenu, onRowMove, onGrowRows, renderHeader,
  headerTrailing, footer, readOnlyCols, getRangeValues, applyMatrix, onUndo,
  onRedo, onFormatKey, cellStyle, onSelectionChange,
}: SheetGridProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  const [viewport, setViewport] = useState({ top: 0, height: 600 });
  const [active, setActive] = useState<Cell | null>(null);
  const [anchor, setAnchor] = useState<Cell | null>(null);
  const [editing, setEditing] = useState<{ rowId: string; c: number; seed: string | null } | null>(null);
  /* Fill-handle drag. Kept in state, not a ref: the preview rectangle is
   * rendered from it, and reading a ref during render is forbidden. */
  const [fillDrag, setFillDrag] = useState<{ base: Rect; to: number } | null>(null);
  /* Gutter row drag. Same state-for-render rule as fillDrag; the ref beside
   * it is the commit-once source of truth (pointerup and lostpointercapture
   * can both fire for one drop, and a row must never move twice). `gap` is
   * the candidate insertion gap, 0..rowCount inclusive. */
  const [rowDrag, setRowDrag] = useState<{ rowId: string; from: number; gap: number } | null>(null);
  const rowDragRef = useRef<{ rowId: string; from: number; gap: number } | null>(null);
  /* Armed on gutter pointerdown; becomes a real drag only after the pointer
   * crosses ROW_DRAG_THRESHOLD_PX, so a plain click stays a click. */
  const pendingRowDragRef = useRef<{ pointerId: number; rowId: string; startY: number } | null>(null);
  const [applying, setApplying] = useState(false);
  const applyingRef = useRef(false);

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
    const offs = [GUTTER_W];
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

  /* ── selection readout (Tables Phase 5b stats) ──────────────── */
  // The callback lives in a ref so a page that passes an inline arrow
  // doesn't retrigger the emission effect on every parent render.
  const onSelectionChangeRef = useRef(onSelectionChange);
  useEffect(() => { onSelectionChangeRef.current = onSelectionChange; });
  // Content key of the last emission. Starts at the no-selection key so
  // mounting with nothing selected emits nothing. The dedupe is by VALUE,
  // not identity, and that is load-bearing: the page passes a fresh
  // rowIds array every render, so `range` (memoized on rowIndex, which is
  // memoized on rowIds) gets a new identity every parent render too. An
  // identity-keyed dedupe would then loop forever: emit → page setState →
  // re-render → new identities → effect → emit… The value key makes the
  // second pass a no-op and the loop terminates in one round.
  const lastSelKeyRef = useRef("null");
  useEffect(() => {
    if (!onSelectionChangeRef.current) return; // unwired: zero cost
    // One rAF per effect run, cancelled by the next run's cleanup: any
    // burst of selection changes (shift+arrow key-repeat, rows reordering
    // under a live range) collapses to at most one emission per animation
    // frame, and the trailing schedule always sees the LATEST state — the
    // settle is never lost. Every path that moves the selection funnels
    // through setActive/setAnchor into the `range` memo above, so this one
    // effect covers click, shift+click, shift+arrows, Cmd/Ctrl+A, Escape,
    // paste/fill landing (selectRect) and rows vanishing under the range.
    // The fill-handle drag never touches `range` mid-drag (it renders from
    // fillDrag state and commits via selectRect on release), so a drag
    // emits exactly once, at the settle.
    const raf = requestAnimationFrame(() => {
      const fn = onSelectionChangeRef.current;
      if (!fn) return;
      // A single cell is not a range: Sheets shows no readout for one
      // cell, so the page hears null and clears its stats.
      const sel = range != null && (range.r1 !== range.r2 || range.c1 !== range.c2)
        ? { rowIds: rowIds.slice(range.r1, range.r2 + 1), c1: range.c1, c2: range.c2 }
        : null;
      const key = sel == null ? "null" : `${sel.c1}:${sel.c2}:${sel.rowIds.join("\u0000")}`;
      if (key === lastSelKeyRef.current) return; // identity churn, not a change
      lastSelKeyRef.current = key;
      fn(sel);
    });
    return () => cancelAnimationFrame(raf);
  }, [range, rowIds]);

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
    // The number gutter is sticky-left, so it covers the first GUTTER_W px
    // of the viewport — a cell isn't really visible until it clears that.
    if (left - GUTTER_W < el.scrollLeft) el.scrollLeft = Math.max(0, left - GUTTER_W);
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

  /* ── growth signal (onGrowRows) ─────────────────────────────── */
  // Ref-read so move() — a dependency of the whole keyboard path — doesn't
  // churn when the page passes a fresh arrow function every render.
  const onGrowRowsRef = useRef(onGrowRows);
  useEffect(() => { onGrowRowsRef.current = onGrowRows; });
  const lastGrowRef = useRef(0);
  const requestGrowRows = useCallback(() => {
    const fn = onGrowRowsRef.current;
    if (!fn) return;
    const now = Date.now();
    if (now - lastGrowRef.current < 1000) return; // a held ArrowDown repeats far faster than appends land
    lastGrowRef.current = now;
    fn();
  }, []);

  const move = useCallback((dr: number, dc: number, extend: boolean) => {
    if (rowCount === 0 || colCount === 0) return;
    const cur = activeRef.current;
    const curR = cur ? rowIndex.get(cur.rowId) : undefined;
    if (!cur || curR == null) { seedActive(); return; }
    // A single-step move off the bottom edge (ArrowDown or Enter-commit-move
    // on the last row) asks the page to grow the sheet — Sheets' "the grid
    // never ends" feel. The move itself still clamps: appended rows arrive
    // asynchronously, and PageDown deliberately doesn't trigger growth (a
    // page-jump from mid-table is navigation, not an append request).
    if (dr === 1 && curR === rowCount - 1) requestGrowRows();
    const r = Math.max(0, Math.min(rowCount - 1, curR + dr));
    const c = Math.max(0, Math.min(colCount - 1, cur.c + dc));
    if (extend) setAnchor((a) => a ?? cur);
    else setAnchor(null);
    setActive({ rowId: rowIds[r], c });
    scrollCellIntoView(r, c);
  }, [rowCount, colCount, rowIds, rowIndex, seedActive, scrollCellIntoView, requestGrowRows]);

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

  /* ── clipboard + fill (Phase 2) ─────────────────────────────── */

  /** Row-major geometry for a rectangle, resolved against the CURRENT row
   *  order. A rectangle is display geometry; what leaves the grid is always
   *  rowIds, because a sort (or an instant-commit editor that changes the
   *  sorted-by value) can renumber every row between gesture and write. */
  const rectCells = useCallback((rect: Rect) => {
    const cells: { rowId: string; c: number }[][] = [];
    for (let r = rect.r1; r <= rect.r2; r++) {
      const rowId = rowIds[r];
      if (!rowId) continue;
      const row: { rowId: string; c: number }[] = [];
      for (let c = rect.c1; c <= rect.c2 && c < colCount; c++) row.push({ rowId, c });
      if (row.length > 0) cells.push(row);
    }
    return cells;
  }, [rowIds, colCount]);

  /** Values for a rectangle, normalised to a dense string matrix of exactly
   *  the geometry we asked for — the page's reader is not trusted to be
   *  rectangular, and a hole must read as "" rather than reach toTSV or
   *  fillSeries as undefined. */
  const readRect = useCallback((rect: Rect): Matrix | null => {
    const cells = rectCells(rect);
    if (cells.length === 0) return null;
    let raw: string[][];
    try {
      raw = getRangeValues(cells);
    } catch {
      return null;
    }
    if (!Array.isArray(raw)) return null;
    return cells.map((row, r) => row.map((_, c) => {
      const v = raw[r]?.[c];
      return v == null ? "" : String(v);
    }));
  }, [rectCells, getRangeValues]);

  const payloadFor = useCallback((rect: Rect) => {
    const m = readRect(rect);
    if (!m) return null;
    try {
      return { tsv: toTSV(m), html: toHTMLTable(m) };
    } catch {
      return null;
    }
  }, [readRect]);

  /** The single writer. Every block mutation funnels through here: one write
   *  in flight at a time (a second paste landing mid-flight would race the
   *  page's optimistic update), column overflow clipped, and a rejected
   *  write reported back as false instead of thrown — the page owns the
   *  rollback and the message, but a cut must not clear on a failed copy and
   *  a fill must not move the selection onto cells it never wrote. */
  const runApply = useCallback(async (topLeft: { rowId: string; c: number }, matrix: string[][]) => {
    if (applyingRef.current) return false;
    const clipped = clipMatrix(matrix, topLeft.c, colCount);
    if (!clipped.some((row) => row.length > 0)) return false;
    applyingRef.current = true;
    setApplying(true);
    try {
      await applyMatrix(topLeft, clipped);
      return true;
    } catch {
      return false;
    } finally {
      applyingRef.current = false;
      setApplying(false);
    }
  }, [applyMatrix, colCount]);

  /** Land the selection on a rectangle after a write. Clamped to rows that
   *  exist: rows the page appended have ids this render hasn't seen. */
  const selectRect = useCallback((rect: Rect) => {
    if (rowCount === 0 || colCount === 0) return;
    const top = rowIds[Math.max(0, Math.min(rowCount - 1, rect.r1))];
    const bottom = rowIds[Math.max(0, Math.min(rowCount - 1, rect.r2))];
    if (!top || !bottom) return;
    setAnchor({ rowId: top, c: Math.max(0, Math.min(colCount - 1, rect.c1)) });
    setActive({ rowId: bottom, c: Math.max(0, Math.min(colCount - 1, rect.c2)) });
  }, [rowIds, rowCount, colCount]);

  const clearRect = useCallback(async (rect: Rect) => {
    const rowId = rowIds[rect.r1];
    if (!rowId) return false;
    const height = Math.min(rect.r2, rowCount - 1) - rect.r1 + 1;
    const width = Math.min(rect.c2, colCount - 1) - rect.c1 + 1;
    if (height <= 0 || width <= 0) return false;
    const blank = Array.from({ length: height }, () => Array.from({ length: width }, () => ""));
    return runApply({ rowId, c: rect.c1 }, blank);
  }, [rowIds, rowCount, colCount, runApply]);

  const applyPaste = useCallback(async (m: Matrix, target: Rect) => {
    if (!Array.isArray(m) || m.length === 0 || !Array.isArray(m[0]) || m[0].length === 0) return;
    const height = target.r2 - target.r1 + 1;
    const width = target.c2 - target.c1 + 1;
    // Sheets behaviour: a single value pasted over a range fills the range.
    // A single EMPTY value does not: parseClipboard bottoms out at 1x1 blank
    // for a payload it can't read (an html-only clipboard with no table, an
    // image), and expanding that would silently wipe the whole selection.
    // Pasting a genuinely empty cell still clears the anchor cell, so the
    // blast radius of a junk clipboard is one cell; Delete clears a range.
    const single = m.length === 1 && m[0].length === 1;
    const matrix = single && (m[0][0] ?? "") !== "" && (height > 1 || width > 1)
      ? Array.from({ length: height }, () => Array.from({ length: width }, () => m[0][0]))
      : m;
    const rowId = rowIds[target.r1];
    if (!rowId) return;
    const ok = await runApply({ rowId, c: target.c1 }, matrix);
    if (!ok) return;
    selectRect({
      r1: target.r1,
      r2: target.r1 + matrix.length - 1,
      c1: target.c1,
      c2: target.c1 + (matrix[0]?.length ?? 1) - 1,
    });
  }, [rowIds, runApply, selectRect]);

  /* The native copy/cut/paste events are the primary path: their
   * DataTransfer is synchronous, needs no permission prompt, carries
   * text/html both ways, and also covers the Edit and context menus. Not
   * every browser fires them for a non-editable selection (cut especially),
   * so the shortcut schedules an async-Clipboard-API attempt that runs only
   * if no event arrived on this tick. */
  const clipSeqRef = useRef(0);
  const fallbackTimerRef = useRef<number | null>(null);
  useEffect(() => () => {
    if (fallbackTimerRef.current != null) window.clearTimeout(fallbackTimerRef.current);
  }, []);
  const ifNoClipboardEvent = useCallback((run: () => void) => {
    const seq = clipSeqRef.current;
    if (fallbackTimerRef.current != null) window.clearTimeout(fallbackTimerRef.current);
    fallbackTimerRef.current = window.setTimeout(() => {
      fallbackTimerRef.current = null;
      if (clipSeqRef.current === seq) run();
    }, 0);
  }, []);

  const asyncCopy = useCallback(async (rect: Rect, cut: boolean) => {
    // A cut whose clear would be refused (a write is already in flight)
    // would leave the user believing the cells were moved. Do nothing.
    if (cut && applyingRef.current) return;
    const payload = payloadFor(rect);
    if (!payload) return;
    const ok = await writeClipboardAsync(payload.tsv, payload.html);
    // A cut clears only once the copy is confirmed: a denied clipboard
    // permission must not destroy cells with nothing to paste back.
    if (ok && cut) await clearRect(rect);
  }, [payloadFor, clearRect]);

  const asyncPaste = useCallback(async (target: Rect) => {
    if (!navigator.clipboard?.readText) return;
    let text = "";
    try {
      text = await navigator.clipboard.readText();
    } catch {
      return; // denied — the user sees nothing happen, which beats a throw
    }
    if (!text) return;
    await applyPaste(parseClipboard({ text }), target);
  }, [applyPaste]);

  const onClipboardCopy = (e: React.ClipboardEvent, cut: boolean) => {
    // Same guard as the keyboard handler: a caret inside a cell editor or
    // the column-rename input keeps the browser's own copy.
    if ((e.target as HTMLElement | null)?.closest?.(EDITABLE_SEL)) return;
    if (editing || !range) return;
    // Same reason as asyncCopy: never half-perform a cut.
    if (cut && applyingRef.current) return;
    const payload = payloadFor(range);
    if (!payload) {
      clipSeqRef.current += 1; // nothing to copy — don't let the fallback try
      return;
    }
    const dt = e.clipboardData;
    if (!dt) return; // no DataTransfer: leave it to the async fallback
    e.preventDefault();
    dt.setData("text/plain", payload.tsv);
    dt.setData("text/html", payload.html);
    clipSeqRef.current += 1;
    if (cut) void clearRect(range);
  };

  const onClipboardPaste = (e: React.ClipboardEvent) => {
    if ((e.target as HTMLElement | null)?.closest?.(EDITABLE_SEL)) return;
    if (editing || !range) return;
    const dt = e.clipboardData;
    if (!dt) return;
    const text = dt.getData("text/plain");
    const html = dt.getData("text/html");
    clipSeqRef.current += 1;
    if (!text && !html) return; // image or file paste — not ours
    e.preventDefault();
    void applyPaste(parseClipboard({ text: text || undefined, html: html || undefined }), range);
  };

  /** Cmd/Ctrl+D and Cmd/Ctrl+R. A plain copy of the leading row/column, not
   *  a series: that is what a spreadsheet's fill-down does, and it keeps the
   *  result predictable (a lone "Item 1" stays "Item 1"). A one-row (or
   *  one-column) selection fills from the neighbour above/left, like Excel. */
  const fillFromEdge = useCallback(async (dir: "down" | "right") => {
    if (!range) return;
    const { r1, r2, c1, c2 } = range;
    if (dir === "down") {
      const srcR = r2 > r1 ? r1 : r1 - 1;
      const dstR = r2 > r1 ? r1 + 1 : r1;
      if (srcR < 0) return;
      const src = readRect({ r1: srcR, r2: srcR, c1, c2 });
      const srcRow = src?.[0];
      if (!srcRow) return;
      const rowId = rowIds[dstR];
      if (!rowId) return;
      await runApply({ rowId, c: c1 }, Array.from({ length: r2 - dstR + 1 }, () => [...srcRow]));
      return;
    }
    const srcC = c2 > c1 ? c1 : c1 - 1;
    const dstC = c2 > c1 ? c1 + 1 : c1;
    if (srcC < 0) return;
    const src = readRect({ r1, r2, c1: srcC, c2: srcC });
    if (!src || src.length === 0) return;
    const rowId = rowIds[r1];
    if (!rowId) return;
    const width = c2 - dstC + 1;
    await runApply({ rowId, c: dstC }, src.map((row) => Array.from({ length: width }, () => row[0] ?? "")));
  }, [range, readRect, rowIds, runApply]);

  /** Which row a pointer is over. The header sits in normal flow at the top
   *  of the scrolled content, so body row r starts at (r + 1) * ROW_H. */
  const rowFromClientY = useCallback((clientY: number) => {
    const el = scrollRef.current;
    if (!el || rowCount === 0) return null;
    const rect = el.getBoundingClientRect();
    // clientY is visual px — scaled when an ancestor applies CSS zoom (the
    // page's zoom control) — while scrollTop/ROW_H are unscaled layout px.
    // Normalize the client-space offset before mixing the two, or a fill
    // drag at 75%/150% writes into rows the user never touched.
    const cssZoom = (el as HTMLElement & { currentCSSZoom?: number }).currentCSSZoom
      ?? (el.offsetWidth > 0 ? rect.width / el.offsetWidth : 1);
    const y = (clientY - rect.top) / (cssZoom || 1) - el.clientTop + el.scrollTop - SHEET_ROW_H;
    return Math.max(0, Math.min(rowCount - 1, Math.floor(y / SHEET_ROW_H)));
  }, [rowCount]);

  const commitFill = useCallback(async (base: Rect, to: number) => {
    const down = to > base.r2;
    // Dragging back inside the seed is a no-op. Sheets would shrink the
    // range by clearing cells; we never destroy data the drag didn't add.
    const count = down ? to - base.r2 : base.r1 - to;
    if (count <= 0) return;
    const seed = readRect(base);
    if (!seed) return;
    const width = Math.min(base.c2, colCount - 1) - base.c1 + 1;
    if (width <= 0) return;
    // One series per column — a two-column seed extends each column
    // independently, like Sheets.
    const series: string[][] = [];
    for (let ci = 0; ci < width; ci++) {
      series.push(fillSeries(seed.map((row) => row[ci] ?? ""), count, !down));
    }
    // fillSeries returns values in drag order: index 0 is the cell adjacent
    // to the seed, index count-1 the far end of the drag. An upward fill is
    // therefore written bottom-up.
    const matrix: string[][] = [];
    for (let i = 0; i < count; i++) {
      const k = down ? i : count - 1 - i;
      matrix.push(series.map((vals) => vals[k] ?? ""));
    }
    const topR = down ? base.r2 + 1 : to;
    const rowId = rowIds[topR];
    if (!rowId) return;
    const ok = await runApply({ rowId, c: base.c1 }, matrix);
    if (ok) selectRect({ r1: Math.min(base.r1, to), r2: Math.max(base.r2, to), c1: base.c1, c2: base.c2 });
  }, [readRect, colCount, rowIds, runApply, selectRect]);

  /** Shared by the fill handle and the gutter row drag. */
  const releasePointer = (e: React.PointerEvent) => {
    const el = e.currentTarget as HTMLElement;
    try {
      if (el.hasPointerCapture?.(e.pointerId)) el.releasePointerCapture(e.pointerId);
    } catch {
      // Capture was never taken (or already lost) — nothing to release.
    }
  };

  /** End of a fill drag. Browsers disagree on whether lostpointercapture
   *  lands before or after pointerup, so both end the drag; if they both
   *  fire in one tick they see the same pre-batch state and both commit —
   *  harmless, because runApply is single-flight and refuses the second. */
  const endFillDrag = (commit: boolean) => {
    const drag = fillDrag;
    if (!drag) return;
    setFillDrag(null);
    if (commit) void commitFill(drag.base, drag.to);
  };

  /* ── gutter row drag (Sheets row reorder) ───────────────────── */

  /** Which INSERTION GAP a pointer is nearest — 0..rowCount inclusive, where
   *  gap g is the boundary above display row g. Same zoom-normalized math as
   *  rowFromClientY, but rounded instead of floored: the top half of a row
   *  snaps to the gap above it, the bottom half to the gap below, which is
   *  how the Sheets drop line behaves. */
  const gapFromClientY = useCallback((clientY: number) => {
    const el = scrollRef.current;
    if (!el || rowCount === 0) return null;
    const rect = el.getBoundingClientRect();
    const cssZoom = (el as HTMLElement & { currentCSSZoom?: number }).currentCSSZoom
      ?? (el.offsetWidth > 0 ? rect.width / el.offsetWidth : 1);
    const y = (clientY - rect.top) / (cssZoom || 1) - el.clientTop + el.scrollTop - SHEET_ROW_H;
    return Math.max(0, Math.min(rowCount, Math.round(y / SHEET_ROW_H)));
  }, [rowCount]);

  /** End of a row drag. Same dual-exit story as endFillDrag (pointerup and
   *  lostpointercapture race), but a move is NOT idempotent the way the
   *  single-flight fill is — so the REF is the commit token: whoever nulls
   *  it performs the move, everyone after sees null and does nothing. */
  const endRowDrag = (commit: boolean) => {
    pendingRowDragRef.current = null;
    const drag = rowDragRef.current;
    if (!drag) return;
    rowDragRef.current = null;
    setRowDrag(null);
    if (!commit || !onRowMove) return;
    // Gap → the display index the row lands at: the row vacates its old slot
    // first, so gaps below it collapse by one (splice-out/splice-in math,
    // mirroring the host's rowMoved contract).
    const target = drag.gap > drag.from ? drag.gap - 1 : drag.gap;
    // Dropped back where it started (gap == from or from + 1): not a move.
    if (target === drag.from) return;
    onRowMove(drag.rowId, target);
  };

  // Escape abandons a row drag without moving anything. Window-level and
  // capture-phase: mid-drag the pointer capture sits on the gutter cell and
  // focus can be anywhere, so the grid's own keydown may never hear the key.
  useEffect(() => {
    if (!rowDrag) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.stopPropagation(); // the grid's Escape would also collapse the selection
      pendingRowDragRef.current = null;
      rowDragRef.current = null;
      setRowDrag(null);
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [rowDrag]);

  // The dragged row itself can vanish (concurrent delete, or a filter
  // change from another surface): the drag has nothing left to move, and
  // the ref must not linger to hijack a later gesture.
  useEffect(() => {
    if (rowDrag && !rowIndex.has(rowDrag.rowId)) endRowDrag(false);
  });

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

    /* Undo/redo (Tables Phase 4). Deliberately BEHIND the EDITABLE_SEL and
     * `editing` guards above, so a caret in a cell editor or the rename
     * input keeps the browser's native text undo — and deliberately BEFORE
     * the active-cell guard below, because history needs no selection.
     * Ctrl+Y is the Windows redo; Cmd+Y stays the browser's (history). */
    if ((e.metaKey || e.ctrlKey) && !e.altKey) {
      const k = e.key.toLowerCase();
      if (k === "z") {
        const fn = e.shiftKey ? onRedo : onUndo;
        if (fn) { e.preventDefault(); fn(); return; }
      } else if (k === "y" && e.ctrlKey && !e.metaKey && !e.shiftKey && onRedo) {
        e.preventDefault();
        onRedo();
        return;
      }
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

    /* Cmd/Ctrl shortcuts. They sit behind the EDITABLE_SEL and `editing`
     * guards above, so a caret inside a cell editor or the column-rename
     * input keeps the browser's own copy/cut/paste/select-all. Handled here
     * rather than as `case "c"` in the switch below, so the same letters
     * still reach type-to-replace when no modifier is held. Anything not
     * listed falls through to the switch — Cmd+Arrow still navigates.
     *
     * Shift and Alt combinations are left to the browser: Cmd+Shift+R has to
     * stay a hard reload, and Cmd+Shift+V still pastes through the paste
     * event below, which is where the work actually happens. */
    if ((e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey) {
      switch (e.key.toLowerCase()) {
        case "a":
          e.preventDefault();
          if (rowCount > 0 && colCount > 0) { setAnchor({ rowId: rowIds[0], c: 0 }); setActive({ rowId: rowIds[rowCount - 1], c: colCount - 1 }); }
          return;
        case "c":
        case "x": {
          // Deliberately NOT prevented: letting the keystroke through is
          // what makes the browser fire the copy/cut event we prefer.
          if (!range) return;
          const rect = { ...range };
          const cut = e.key.toLowerCase() === "x";
          ifNoClipboardEvent(() => { void asyncCopy(rect, cut); });
          return;
        }
        case "v": {
          if (!range) return;
          const rect = { ...range };
          ifNoClipboardEvent(() => { void asyncPaste(rect); });
          return;
        }
        // Cmd+D bookmarks and Cmd+R reloads — both have to be swallowed
        // once the grid owns them.
        case "d": e.preventDefault(); void fillFromEdge("down"); return;
        case "r": e.preventDefault(); void fillFromEdge("right"); return;
        // Bold / italic / underline (Sheets). Prevented so Cmd+B/I/U never
        // reach the browser's own bookmark/page-info handling; the page
        // decides what "the selection" means and writes the style.
        case "b":
        case "i":
        case "u": {
          if (!onFormatKey) return;
          e.preventDefault();
          onFormatKey(e.key.toLowerCase() as "b" | "i" | "u");
          return;
        }
      }
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

  /* ── gutter selection (Sheets row select) ───────────────────── */
  // A gutter click is nothing special to the selection model: it just sets
  // an ordinary full-width rectangle (anchor at column 0, active at the last
  // column), so stats, clipboard, Delete-to-clear and the context menu all
  // behave exactly as if the user had dragged across the row.
  const selectRow = (rowId: string, extend: boolean) => {
    const lastC = colCount - 1;
    if (lastC < 0) return;
    // Extending re-anchors at column 0 of the anchor ROW: a cell-range
    // anchor mid-row must widen to the full row, like Sheets.
    const anchorRowId = extend ? (anchor?.rowId ?? active?.rowId ?? rowId) : rowId;
    setAnchor({ rowId: anchorRowId, c: 0 });
    setActive({ rowId, c: lastC });
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

  /* Fill handle: the bottom-right corner of the selection. Hidden while an
   * editor is open (it would sit on top of the editor's own corner) and
   * while a write is in flight. Kept out of the tab order on purpose — it is
   * a pointer affordance; Cmd+D / Cmd+R are its keyboard equivalent. */
  const fillAnchor = range && rowCount > 0 && colCount > 0 && !editing
    ? { r: Math.min(range.r2, rowCount - 1), c: Math.min(range.c2, colCount - 1) }
    : null;
  const fillPreview = fillDrag ? (() => {
    const r1 = Math.min(fillDrag.base.r1, fillDrag.to);
    const r2 = Math.max(fillDrag.base.r2, fillDrag.to);
    const left = colOffsets[fillDrag.base.c1] ?? GUTTER_W;
    const right = colOffsets[Math.min(fillDrag.base.c2, colCount - 1) + 1] ?? left;
    return { top: r1 * SHEET_ROW_H, height: (r2 - r1 + 1) * SHEET_ROW_H, left, width: Math.max(0, right - left) };
  })() : null;

  /* ── render ─────────────────────────────────────────────────── */
  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
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
          onCopy={(e) => onClipboardCopy(e, false)}
          onCut={(e) => onClipboardCopy(e, true)}
          onPaste={onClipboardPaste}
          className="relative outline-none"
          // The grabbing cursor covers the whole grid mid-drag: the pointer
          // is captured by the gutter cell, but visually it roams the grid.
          style={{ width: gridWidth, minWidth: "100%", cursor: rowDrag ? "grabbing" : undefined }}
        >
          {/* Header */}
          <div className="sticky top-0 z-20 flex border-b border-zinc-200 bg-zinc-50/95 backdrop-blur" style={{ height: SHEET_ROW_H }}>
            {/* Corner above the gutter: empty, like Sheets. */}
            <div className="sticky left-0 z-10 border-r border-zinc-200 bg-zinc-50" style={{ width: GUTTER_W, minWidth: GUTTER_W }} />
            {columns.map((col) => (
              <div
                key={col.id}
                role="columnheader"
                className="flex items-center border-r border-zinc-100 px-1"
                style={{ width: col.width ?? COL_W, minWidth: col.width ?? COL_W }}
                onContextMenu={(e) => {
                  // Right-click inside a page-rendered field keeps the
                  // browser's own menu (same guard as the row menu).
                  if ((e.target as HTMLElement).closest("input, textarea, [contenteditable=true]")) return;
                  if (!onHeaderContextMenu) return;
                  e.preventDefault();
                  onHeaderContextMenu(col.id, e.clientX, e.clientY);
                }}
              >
                <div className="min-w-0 flex-1">{renderHeader(col.id)}</div>
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
                  className="absolute left-0 right-0 flex border-b border-zinc-50"
                  style={{ top: r * SHEET_ROW_H, height: SHEET_ROW_H }}
                  onContextMenu={(e) => {
                    if ((e.target as HTMLElement).closest("input, textarea, [contenteditable=true]")) return;
                    if (!onRowContextMenu) return;
                    e.preventDefault();
                    onRowContextMenu(rowId, e.clientX, e.clientY);
                  }}
                >
                  {/* Row-number gutter cell: click selects the row, shift+
                    * click extends the row span, drag (past the threshold)
                    * reorders. Right-click bubbles to the row's context
                    * menu above, like the rest of the row. */}
                  <div
                    className={`sticky left-0 z-10 flex items-center justify-end border-r border-zinc-200 pr-2 text-[11px] tabular-nums select-none ${
                      range && r >= range.r1 && r <= range.r2 ? "bg-zinc-100 text-zinc-600" : "bg-white text-zinc-400"
                    }`}
                    style={{ width: GUTTER_W, minWidth: GUTTER_W, touchAction: "none" }}
                    onPointerDown={(e) => {
                      if (e.button !== 0) return; // right-click stays the context menu
                      // Same as a cell mousedown: stealing focus from an open
                      // editor blurs it, and blur is how editors commit.
                      gridRef.current?.focus();
                      e.preventDefault();
                      // A scroll can unmount the captured gutter cell, and
                      // Chrome then fires lostpointercapture at the document
                      // where React's delegated handler never hears it — the
                      // ref survives. On touch there are no hover moves to
                      // self-heal, so THIS gesture would drive the previous
                      // drag: abandon any stale drag before arming a new one.
                      if (rowDragRef.current) endRowDrag(false);
                      selectRow(rowId, e.shiftKey);
                      // Shift extends a selection; it never starts a move.
                      if (!onRowMove || e.shiftKey) return;
                      pendingRowDragRef.current = { pointerId: e.pointerId, rowId, startY: e.clientY };
                      (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
                    }}
                    onPointerMove={(e) => {
                      // Button already up means we missed the pointerup (a
                      // failed capture and a release outside this cell).
                      // Abandon rather than commit: a move the user never
                      // saw land must not happen on a later hover.
                      if (e.buttons === 0) { endRowDrag(false); return; }
                      const pending = pendingRowDragRef.current;
                      if (pending && pending.pointerId === e.pointerId && !rowDragRef.current) {
                        if (Math.abs(e.clientY - pending.startY) <= ROW_DRAG_THRESHOLD_PX) return;
                        const from = rowIndex.get(pending.rowId);
                        // The row vanished mid-gesture (concurrent delete):
                        // there is nothing left to move.
                        if (from == null) { pendingRowDragRef.current = null; return; }
                        const drag = { rowId: pending.rowId, from, gap: gapFromClientY(e.clientY) ?? from };
                        rowDragRef.current = drag;
                        setRowDrag(drag);
                        return;
                      }
                      const drag = rowDragRef.current;
                      if (!drag) return;
                      const gap = gapFromClientY(e.clientY);
                      if (gap != null && gap !== drag.gap) {
                        const next = { ...drag, gap };
                        rowDragRef.current = next;
                        setRowDrag(next);
                      }
                    }}
                    onPointerUp={(e) => { releasePointer(e); endRowDrag(true); }}
                    onPointerCancel={(e) => { releasePointer(e); endRowDrag(false); }}
                    onLostPointerCapture={() => endRowDrag(true)}
                  >
                    {r + 1}
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
                        // Page-owned cell style (text styles + fill +
                        // conditional-formatting background). The ACTIVE
                        // cell keeps its text styles but drops the
                        // background: its white ground keeps the editor and
                        // outline legible (inline style would beat the
                        // bg-white class).
                        style={{
                          width: col.width ?? COL_W,
                          minWidth: col.width ?? COL_W,
                          ...(isActive ? withoutBackground(cellStyle?.(rowId, col.id)) : cellStyle?.(rowId, col.id)),
                        }}
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

            {/* Row-drag drop indicator: a 2px line centred on the candidate
              * gap. z-30 so it rides above the sticky gutter cells (z-10)
              * — the line must be visible across the numbers it is
              * dropping between. */}
            {rowDrag && (
              <div
                aria-hidden
                className="pointer-events-none absolute left-0 right-0 z-30 bg-[#0073EA]"
                style={{ top: rowDrag.gap * SHEET_ROW_H - 1, height: 2 }}
              />
            )}
            {fillPreview && (
              <div
                aria-hidden
                className="pointer-events-none absolute z-10 border-2 border-dashed border-[#0073EA]"
                style={fillPreview}
              />
            )}
            {fillAnchor && (
              <div
                aria-hidden
                title="Drag to fill"
                className="absolute z-10 flex items-center justify-center"
                style={{
                  top: (fillAnchor.r + 1) * SHEET_ROW_H - 7,
                  left: (colOffsets[fillAnchor.c + 1] ?? GUTTER_W) - 7,
                  width: 14,
                  height: 14,
                  cursor: "crosshair",
                  touchAction: "none",
                  pointerEvents: applying ? "none" : "auto",
                }}
                onPointerDown={(e) => {
                  if (!range || applyingRef.current) return;
                  // Stop the gesture reaching the cell underneath, which
                  // would collapse the selection we are about to fill from.
                  e.preventDefault();
                  e.stopPropagation();
                  (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
                  setFillDrag({ base: { ...range }, to: range.r2 });
                }}
                onPointerMove={(e) => {
                  if (!fillDrag) return;
                  const r = rowFromClientY(e.clientY);
                  if (r != null && r !== fillDrag.to) setFillDrag({ base: fillDrag.base, to: r });
                }}
                onPointerUp={(e) => { releasePointer(e); endFillDrag(true); }}
                onPointerCancel={(e) => { releasePointer(e); endFillDrag(false); }}
                onLostPointerCapture={() => endFillDrag(true)}
              >
                <div className="h-[7px] w-[7px] rounded-[1px] border border-white bg-[#0073EA]" />
              </div>
            )}
          </div>
        </div>
      </div>
      {footer}
    </div>
  );
}
