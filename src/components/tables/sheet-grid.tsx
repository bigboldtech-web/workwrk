"use client";

/* SheetGrid — the spreadsheet kernel (Tables Phase 1, docs/plans/tables.md).
 *
 * What it owns: virtualized rows, the selection model (active cell +
 * anchor + rectangular range — set by click, Shift+click, Shift/Cmd+
 * arrows, and Sheets' click-hold-pull drag with edge auto-scroll, see the
 * cell-selection-drag section), full keyboard navigation, frozen first
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
 * Keyboard map: arrows move · Shift+arrows extend · Cmd/Ctrl+arrows jump
 * to the edge of the data block (Cmd/Ctrl+Shift+arrows extend the same
 * way) · Tab/Shift+Tab move
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
 *
 * Freeze panes (`freeze` prop) are display-only, like Sheets' View > Freeze:
 * the first N display rows render in a sticky band under the header and the
 * first N columns get sticky-left offsets after the gutter. Nothing about
 * the selection model, the engine or the data changes — a frozen row is
 * still display row r, a frozen cell still cell (rowId, colId). The layout
 * math is written down at the band/virtual-window code below.
 *
 * Row heights (Sheets' row resize): per-row custom heights arrive through
 * `rowHeight` and every vertical computation routes through ONE RowGeometry
 * (sheet-row-geometry.ts) — O(1) closed-form and formula-identical to the
 * old constant-height kernel when no custom height exists, prefix sums +
 * binary search when one does. The gutter grows a boundary hit-zone per row
 * (drag = guide line, release = onRowResize, double-click = autofit via
 * onRowAutofit when the page provides it, else reset to default); column
 * resize stays page-owned, the kernel only draws its guide line
 * (colResizeGuideId).
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { fillSeries, parseClipboard, toHTMLTable, toTSV, type Matrix } from "@/lib/sheet-clipboard";
import { buildRowGeometry, clampRowHeight } from "@/lib/sheet-row-geometry";

export const SHEET_ROW_H = 33;

/* Height of the row-resize hit-zone: a strip along the BOTTOM edge of each
 * gutter number (Sheets' between-two-numbers boundary). Kept fully inside
 * the upper row's gutter cell so it can never overlap the next row's
 * number body — see the disjointness note at the zone itself. */
const ROW_RESIZE_ZONE_PX = 4;
const OVERSCAN = 8;
const GUTTER_W = 48; // row-number gutter, frozen (Sheets-sized: fits 4 digits)
const COL_W = 180;   // default column width

/* A pointer that travels further than this from its gutter pointerdown is a
 * row DRAG, not a click. Small enough that a deliberate drag converts almost
 * immediately, large enough that a twitchy click never moves a row. */
const ROW_DRAG_THRESHOLD_PX = 4;

/* Edge auto-scroll cap for the click-hold-pull selection drag, in layout px
 * per animation frame. The step ramps at overshoot/4 and tops out here —
 * fast enough to cross a 1000-row grid in a few held seconds, slow enough
 * to release on the row you meant. */
const CELL_DRAG_MAX_SCROLL_PX = 24;

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

/** Where Cmd/Ctrl+Arrow lands along ONE axis — Sheets' data-edge rule.
 *  `cur` is the current index, `count` the axis length, `step` ±1, and
 *  `isEmpty(i)` the emptiness of cell i along the axis.
 *
 *  Inside a block of data (this cell AND the next are non-empty) the jump
 *  runs to the block's far edge: the last non-empty cell before a gap. On
 *  a block's edge, or in a gap, it skips the empties to the next block's
 *  first cell. Either way, with nothing further in that direction it lands
 *  on the sheet edge. Pure and exported so the page's tests can pin it. */
export function dataEdgeTarget(cur: number, count: number, step: 1 | -1, isEmpty: (i: number) => boolean): number {
  if (count <= 0) return 0;
  const edge = step > 0 ? count - 1 : 0;
  const from = Math.max(0, Math.min(count - 1, cur));
  if (from === edge) return from;
  let i = from + step;
  if (!isEmpty(from) && !isEmpty(i)) {
    while (i !== edge && !isEmpty(i + step)) i += step;
    return i;
  }
  while (i !== edge && isEmpty(i)) i += step;
  return i;
}

export type SheetGridProps = {
  columns: { id: string; label: string; width?: number }[];
  rowIds: string[];
  /** Cheap display value for a cell — plain text/nodes, no live inputs. */
  renderDisplay: (rowId: string, colId: string) => React.ReactNode;
  /** Live editor for the active cell. Call commit() (with the editor's
   *  blur) when done; the kernel moves focus back to the grid. */
  renderEditor: (rowId: string, colId: string, opts: { seed: string | null; commit: () => void; move: (dr: number, dc: number) => void }) => React.ReactNode;
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
  /** Freeze panes (Sheets' View > Freeze). Counts of DISPLAY rows/columns
   *  that stay put while the rest scrolls; clamped so at least one row and
   *  one column remain scrollable. Display-only: the page persists it with
   *  the view, the engine never hears about it. */
  freeze?: { rows?: number; cols?: number };
  /** Emptiness signal for Cmd/Ctrl+Arrow data-edge jumps. The kernel has
   *  no other view of cell values (renderDisplay returns nodes, and
   *  getRangeValues is the clipboard reader — formatted, and wrong to call
   *  per cell across a whole column). The page answers from its mirror:
   *  null / "" / undefined are empty; a formula cell is NOT. Omitted, every
   *  cell counts as data and Cmd/Ctrl+Arrow jumps straight to the sheet
   *  edge, which is what Sheets does on a solid block anyway. */
  isCellEmpty?: (rowId: string, colId: string) => boolean;
  /** Per-row custom height in px (Sheets' row resize), answered from the
   *  page's mirror (row.values["$rh"]); undefined = the default
   *  SHEET_ROW_H. Sampled ONCE per geometry build, never per scroll frame
   *  — see the geometry memo for the complexity story. Absent (or all-
   *  default) the kernel's vertical math is formula-identical to the
   *  constant-height kernel. */
  rowHeight?: (rowId: string) => number | undefined;
  /** Bump this whenever any row's stored height changes. It is the
   *  geometry's identity for `rowHeight` (the function itself is
   *  deliberately NOT a dependency, so a page passing an inline arrow
   *  costs nothing per render). */
  rowHeightsVersion?: number;
  /** A gutter row-boundary drag ended: persist `height` px (already
   *  clamped 16..400) on the row. A double-click on the boundary fires
   *  with SHEET_ROW_H, meaning "reset to default" — unless `onRowAutofit`
   *  is provided, which then owns the double-click. Omit it and the gutter
   *  renders no resize zones at all — rendering is byte-identical to the
   *  pre-resize kernel. */
  onRowResize?: (rowId: string, height: number) => void;
  /** Sheets' boundary DOUBLE-CLICK semantics: fit the row to its content.
   *  The kernel cannot compute the fit (it never sees raw cell text, only
   *  rendered nodes), so the page owns the measurement and the write; the
   *  kernel only reroutes the gesture. Provided, double-click fires this
   *  INSTEAD of onRowResize(rowId, SHEET_ROW_H); absent, the old
   *  reset-to-default double-click stands. Drag is untouched either way. */
  onRowAutofit?: (rowId: string) => void;
  /** Column-resize guide line (the column GESTURE stays page-owned): while
   *  the page is dragging a width it passes the resizing column's id and
   *  the kernel draws a full-height 2px guide at that column's LIVE right
   *  edge — the page's optimistic width updates flow through the `columns`
   *  prop every mousemove, so the line tracks the pointer with zero extra
   *  math and is immune to zoom and scroll by construction. null/absent
   *  renders nothing. */
  colResizeGuideId?: string | null;
};

type Cell = { rowId: string; c: number };

export function SheetGrid({
  columns, rowIds, renderDisplay, renderEditor, onClearCells,
  onRowContextMenu, onHeaderContextMenu, onRowMove, onGrowRows, renderHeader,
  headerTrailing, footer, readOnlyCols, getRangeValues, applyMatrix, onUndo,
  onRedo, onFormatKey, cellStyle, onSelectionChange, freeze, isCellEmpty,
  rowHeight, rowHeightsVersion, onRowResize, onRowAutofit, colResizeGuideId,
}: SheetGridProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  // `left` exists for the freeze overlays only (a fill handle in a frozen
  // column has to ride along with the sticky cell); nothing else reads it.
  const [viewport, setViewport] = useState({ top: 0, left: 0, height: 600 });
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
  /* Gutter row-BOUNDARY drag (Sheets row resize). Same state-for-render +
   * commit-once-ref pairing as rowDrag: the guide line renders from state,
   * the ref is the token that guarantees pointerup and lostpointercapture
   * (which can both fire for one release) commit at most once. `h` is the
   * live clamped height the guide previews; nothing is applied until
   * release (Sheets shows only the line while dragging). `zoom` is the CSS
   * zoom captured at pointerdown — it cannot change mid-drag, and clientY
   * deltas are visual px while heights are layout px. */
  /* No row INDEX in here on purpose: rows can reorder under a captured
   * drag (an instant-commit editor elsewhere, a concurrent sort), so the
   * guide resolves rowId → live index at render and the commit carries
   * the rowId — the same id-not-index discipline as the selection model. */
  type RowResizeState = { rowId: string; pointerId: number; startY: number; startH: number; h: number; zoom: number };
  const [rowResize, setRowResize] = useState<RowResizeState | null>(null);
  const rowResizeRef = useRef<RowResizeState | null>(null);
  const [applying, setApplying] = useState(false);
  const applyingRef = useRef(false);

  const rowCount = rowIds.length;
  const colCount = columns.length;

  /* ── freeze panes ───────────────────────────────────────────── */
  // fr / fc are the EFFECTIVE frozen counts; every freeze code path below is
  // gated on them being > 0, so with no `freeze` prop the grid renders and
  // hit-tests exactly as it did before freeze existed. Clamped to leave at
  // least one scrollable row/column: freezing everything would pin the
  // whole sheet and make the scroller pointless (Sheets refuses it too).
  const fr = Math.max(0, Math.min(Math.floor(Number(freeze?.rows) || 0), rowCount - 1));
  const fc = Math.max(0, Math.min(Math.floor(Number(freeze?.cols) || 0), colCount - 1));

  /* ── row geometry (variable heights) ────────────────────────── */
  /* ONE geometry object answers every vertical question: row tops, row
   * heights, total body height, pointer→row, pointer→gap, the virtual
   * window and the freeze-band height all route through it, so the
   * constant SHEET_ROW_H appears below only as (a) the header height and
   * (b) the PageUp/Down page-step estimate — both deliberate.
   *
   * Complexity (the 50k perf contract): with no `rowHeight` prop, or when
   * every answer is undefined/default, buildRowGeometry allocates NOTHING
   * and every query is the same O(1) closed-form arithmetic as the old
   * constant-height kernel (rowTop = r*H, rowAtY = floor(y/H), rowEndAtY =
   * ceil(y/H), gapAtY = round(y/H)) — the fast-path proof lives with the
   * formulas in sheet-row-geometry.ts. Only when at least one custom
   * height exists does it build a prefix-sum array: O(n) once per
   * [rowIds, rowHeightsVersion] change (a DATA event, never a scroll
   * event), then O(log n) binary search per pointer/scroll query.
   *
   * `rowHeight` itself is deliberately NOT a dependency: pages pass inline
   * arrows, and re-deriving 50k heights per parent render would defeat the
   * memo. rowHeightsVersion is the function's identity — the page bumps it
   * whenever any stored height changes (same contract as a reducer's
   * version counter). */
  const geom = useMemo(
    () => buildRowGeometry(rowCount, SHEET_ROW_H, rowHeight ? (i) => rowHeight(rowIds[i]) : undefined),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- rowHeight is snapshotted by design; rowHeightsVersion is its identity (see above)
    [rowIds, rowCount, rowHeightsVersion],
  );
  /* Height of the frozen band = sum of the frozen rows' heights. rowTop is
   * defined through index rowCount, so fr = 0 gives 0 and the whole freeze
   * math below degrades to the unfrozen formulas exactly as before. */
  const bandH = geom.rowTop(fr);

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
    const measure = () => setViewport({ top: el.scrollTop, left: el.scrollLeft, height: el.clientHeight });
    measure();
    el.addEventListener("scroll", measure, { passive: true });
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => { el.removeEventListener("scroll", measure); ro.disconnect(); };
  }, []);

  /* Layout with a frozen band (fr > 0), in scroll-space px from the top of
   * the grid div (ROW_H = the header's height; row heights come from geom):
   *   header        [0, ROW_H)                      sticky top 0
   *   frozen band   [ROW_H, ROW_H + bandH)          sticky top ROW_H
   *   body box      [ROW_H + bandH, ROW_H + geom.totalHeight)
   * Body row r (r >= fr) sits at geom.rowTop(r) - bandH inside the body
   * box, so its scroll-space top is still ROW_H + geom.rowTop(r) — the
   * same place it had with no freeze. What changes is what the viewport
   * SHOWS: the band is pinned at header-bottom whatever scrollTop is, so
   * the first bandH px of body content under it is always covered. The
   * virtual window therefore starts bandH px later for the same scrollTop
   * (and never before row fr — rows below fr live in the band and are
   * always mounted). With fr = 0 both lines reduce to the pre-freeze
   * formulas.
   *
   * Fast-path proof (all heights default): rowAtY(top + fr*H) =
   * floor(top/H) + fr and rowEndAtY(top + height) = ceil((top + height)/H)
   * — exactly the constant-height window this grid always mounted, so a
   * sheet with no custom heights renders byte-identical rows. */
  const first = Math.max(fr, geom.rowAtY(viewport.top + bandH) - OVERSCAN);
  const last = Math.min(rowCount, geom.rowEndAtY(viewport.top + viewport.height) + OVERSCAN);

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
    // A frozen row is pinned on screen: scrolling can neither hide nor
    // reveal it, so only a body row has a vertical requirement.
    if (r >= fr) {
      const top = geom.rowTop(r);
      const bottom = top + geom.rowHeight(r);
      // The sticky header covers the first ROW_H of the viewport and the
      // frozen band the next bandH px: a body row is only visible once it
      // clears both, i.e. when its top minus the band height is at or past
      // scrollTop (fr = 0 gives the original header-only test; all-default
      // heights give top = r * ROW_H, bottom = (r + 1) * ROW_H — the exact
      // pre-variable-heights formulas). The ROW_H in the bottom test is
      // the HEADER's height, not a row's.
      if (top - bandH < el.scrollTop) el.scrollTop = top - bandH;
      else if (bottom > el.scrollTop + el.clientHeight - SHEET_ROW_H) el.scrollTop = bottom - el.clientHeight + SHEET_ROW_H;
    }
    if (c < fc) return; // a frozen column is likewise always on screen
    const left = colOffsets[c];
    const right = colOffsets[c + 1];
    if (left == null || right == null) return;
    // The number gutter is sticky-left, so it covers the first GUTTER_W px
    // of the viewport — a cell isn't really visible until it clears that.
    // Frozen columns extend that cover to their right edge: colOffsets[fc]
    // is exactly GUTTER_W when nothing is frozen.
    const inset = colOffsets[fc] ?? GUTTER_W;
    if (left - inset < el.scrollLeft) el.scrollLeft = Math.max(0, left - inset);
    else if (right > el.scrollLeft + el.clientWidth) el.scrollLeft = right - el.clientWidth;
  }, [colOffsets, fr, fc, geom, bandH]);

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

  /** Cmd/Ctrl+Arrow (extend = the Shift variant): the active cell jumps to
   *  the edge of its data block, see dataEdgeTarget. Never asks the page to
   *  grow: a jump that ends on the last row is a landing, not a step off
   *  the edge. The page's predicate is untrusted the same way
   *  getRangeValues is — a throw reads as "not empty" instead of killing
   *  the keystroke. */
  const jumpToEdge = useCallback((dr: 1 | -1 | 0, dc: 1 | -1 | 0, extend: boolean) => {
    if (rowCount === 0 || colCount === 0) return;
    const cur = activeRef.current;
    const curR = cur ? rowIndex.get(cur.rowId) : undefined;
    if (!cur || curR == null) { seedActive(); return; }
    const empty = (rowId: string, colId: string) => {
      if (!isCellEmpty) return false;
      try {
        return !!isCellEmpty(rowId, colId);
      } catch {
        return false;
      }
    };
    let r = curR;
    let c = Math.max(0, Math.min(colCount - 1, cur.c));
    if (dr !== 0) {
      const colId = columns[c]?.id ?? "";
      r = dataEdgeTarget(curR, rowCount, dr, (i) => empty(rowIds[i], colId));
    } else if (dc !== 0) {
      c = dataEdgeTarget(c, colCount, dc, (i) => empty(cur.rowId, columns[i]?.id ?? ""));
    }
    if (extend) setAnchor((a) => a ?? cur);
    else setAnchor(null);
    setActive({ rowId: rowIds[r], c });
    scrollCellIntoView(r, c);
  }, [rowCount, colCount, rowIds, rowIndex, columns, isCellEmpty, seedActive, scrollCellIntoView]);

  // commitEdit must stay ref-free: it is passed into renderEditor during
  // render, so the compiler requires it not to read refs. The refocus
  // happens in the effect below when editing closes.
  const commitEdit = useCallback(() => setEditing(null), []);
  /** Tab/Enter inside an editor: the editor's own blur already wrote the
   *  draft (the host blurs before calling this); the kernel closes the
   *  editor, takes focus back — so the next keystroke types into the grid,
   *  not the void the browser's default Tab would have focused — and steps
   *  the active cell (Sheets: Tab right, Shift+Tab left, Enter down). */
  const commitEditAndMove = useCallback((dr: number, dc: number) => {
    setEditing(null);
    gridRef.current?.focus();
    move(dr, dc, false);
  }, [move]);
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

  /** The scroller's effective CSS zoom: clientX/Y are visual px — scaled
   *  when an ancestor applies CSS zoom (the page's zoom control) — while
   *  scrollTop / row heights / column widths are unscaled layout px.
   *  Every pointer gesture divides by this before mixing the two, or a
   *  drag at 75%/150% lands on rows the user never touched. */
  const cssZoomOf = (el: HTMLElement) => {
    const z = (el as HTMLElement & { currentCSSZoom?: number }).currentCSSZoom
      ?? (el.offsetWidth > 0 ? el.getBoundingClientRect().width / el.offsetWidth : 1);
    return z || 1;
  };

  /** A pointer's y in BODY-SPACE px — the coordinate geom.rowAtY answers
   *  in (0 = the top of row 0): geom.rowAtY of it is the display row under
   *  the pointer, geom.gapAtY the nearest insertion gap. Shared by the
   *  fill handle and the gutter row drag. Pre-variable-heights this
   *  returned row UNITS (y / ROW_H); dividing by the constant moved into
   *  the geometry's uniform formulas, so floor/round of the old value and
   *  rowAtY/gapAtY of this one are the same integers.
   *
   *  The header sits in normal flow at the top of the scrolled content, so
   *  body row r starts at scroll-space ROW_H + rowTop(r): subtract the
   *  header and add scrollTop. With a frozen band the first fr rows are
   *  NOT in scroll space — the band is pinned at viewport y
   *  ROW_H..ROW_H + bandH whatever scrollTop is, so a pointer inside it is
   *  over band-local px (vy - ROW_H) — which IS body-space px, band rows
   *  sit at rowTop 0..bandH — and scrollTop must not be added. Below the
   *  band the scroll-space formula still holds unchanged (body rows never
   *  moved, the band merely covers the first bandH px of them). At
   *  scrollTop 0 both formulas agree at the boundary, so the function is
   *  continuous across it. */
  const bodyYFromClientY = useCallback((clientY: number) => {
    const el = scrollRef.current;
    if (!el) return null;
    const rect = el.getBoundingClientRect();
    const vy = (clientY - rect.top) / cssZoomOf(el) - el.clientTop;
    // Above the header (the pointer drifted out of the scroller) the band
    // formula would snap to frozen row 0 — a fill drag that wandered up
    // would then paint every row from the top. Fall through to the scroll-
    // space formula instead, which resolves to about the top visible body
    // row, exactly what the unfrozen grid does there.
    if (fr > 0 && vy >= SHEET_ROW_H && vy < SHEET_ROW_H + bandH) return vy - SHEET_ROW_H;
    return vy + el.scrollTop - SHEET_ROW_H;
  }, [fr, bandH]);

  /** Which DISPLAY row a pointer is over, 0..rowCount-1. */
  const rowFromClientY = useCallback((clientY: number) => {
    if (rowCount === 0) return null;
    const y = bodyYFromClientY(clientY);
    if (y == null) return null;
    return geom.rowAtY(y);
  }, [rowCount, bodyYFromClientY, geom]);

  /** Which column a pointer is over, 0..colCount-1 — the horizontal mirror
   *  of bodyYFromClientY + rowFromClientY, collapsed into one function
   *  because columns need no band split (they are not virtualized and
   *  colOffsets already holds every edge).
   *
   *  Mirror math (bodyYFromClientY's, rotated 90°):
   *    vx = (clientX - rect.left) / zoom - clientLeft
   *  clientX is VISUAL px, colOffsets are LAYOUT px: divide by the
   *  effective CSS zoom first, then drop the scroller's left border
   *  (clientLeft, the twin of clientTop above) — vx is now the pointer's
   *  layout-px x inside the scroller's viewport.
   *
   *  The gutter + frozen columns are sticky-left: they sit pinned at
   *  viewport x 0..colOffsets[fc] whatever scrollLeft is (colOffsets[fc]
   *  is exactly GUTTER_W when fc = 0 — the same identity the
   *  scroll-into-view inset uses). A pointer INSIDE that zone is over
   *  content whose layout x equals its viewport x (frozen cells never
   *  move), so it resolves WITHOUT scrollLeft; past the zone it is over
   *  scrolled content, x = vx + scrollLeft. The threshold compare happens
   *  in layout px AFTER the zoom division, mirroring the band test in
   *  bodyYFromClientY.
   *
   *  Clamping is Sheets': a selection drag never cancels for leaving the
   *  columns. The gutter (and anything left of the scroller) reads as
   *  column 0; anything past the last column's right edge (including the
   *  trailing add-column strip) reads as the last column. */
  const colFromClientX = useCallback((clientX: number) => {
    const el = scrollRef.current;
    if (!el || colCount === 0) return null;
    const rect = el.getBoundingClientRect();
    const vx = (clientX - rect.left) / cssZoomOf(el) - el.clientLeft;
    const frozenEdge = colOffsets[fc] ?? GUTTER_W;
    const x = vx < frozenEdge ? vx : vx + el.scrollLeft;
    if (x < colOffsets[1]) return 0;                    // gutter / left overshoot / column 0
    if (x >= colOffsets[colCount]) return colCount - 1; // right overshoot
    // Greatest c with colOffsets[c] <= x — the same invariant rowAtY keeps.
    let lo = 1;
    let hi = colCount - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (colOffsets[mid] <= x) lo = mid;
      else hi = mid - 1;
    }
    return lo;
  }, [colCount, colOffsets, fc]);

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
   *  rowFromClientY, but snapped to the nearest boundary instead of floored:
   *  the top half of a row snaps to the gap above it, the bottom half to the
   *  gap below, which is how the Sheets drop line behaves (gapAtY reduces to
   *  the old Math.round(y / ROW_H) when heights are uniform). */
  const gapFromClientY = useCallback((clientY: number) => {
    if (rowCount === 0) return null;
    const y = bodyYFromClientY(clientY);
    if (y == null) return null;
    return geom.gapAtY(y);
  }, [rowCount, bodyYFromClientY, geom]);

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

  /* ── gutter row resize (Sheets row-boundary drag) ───────────── */

  /** End of a boundary drag. Same dual-exit story as endRowDrag (pointerup
   *  and lostpointercapture race) and the same ref-as-commit-token: a
   *  resize write is not idempotent through undo (two identical commits
   *  would push two undo entries), so whoever nulls the ref commits and
   *  everyone after sees null. A release whose height never actually
   *  changed (a plain click on the boundary, or a drag returned to its
   *  start) fires nothing — Sheets treats that as a no-op too, and firing
   *  would litter the page's undo stack with zero-delta writes. */
  const endRowResize = (commit: boolean) => {
    const st = rowResizeRef.current;
    if (!st) return;
    rowResizeRef.current = null;
    setRowResize(null);
    if (!commit || !onRowResize) return;
    const h = Math.round(st.h);
    if (h === Math.round(st.startH)) return;
    onRowResize(st.rowId, h);
  };

  // Escape abandons a boundary drag without resizing — window-level and
  // capture-phase for the same reason as the row-drag Escape above: the
  // pointer capture sits on the boundary zone and focus can be anywhere.
  useEffect(() => {
    if (!rowResize) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.stopPropagation(); // the grid's Escape would also collapse the selection
      rowResizeRef.current = null;
      setRowResize(null);
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [rowResize]);

  // The resized row can vanish mid-drag exactly like a dragged row; the
  // guide must not linger over a row that no longer exists.
  useEffect(() => {
    if (rowResize && !rowIndex.has(rowResize.rowId)) endRowResize(false);
  });

  /* ── cell selection drag (Sheets' click-hold-pull) ──────────── */
  /* Press a cell and pull: the selection grows to the rectangle between
   * the mousedown cell and the cell under the pointer — Sheets' primary
   * selection gesture. Three deliberate structural choices:
   *
   * · ARM on cell pointerdown, but touch NO state: the selection itself
   *   is still set by the cell's onMouseDown exactly as before, so a
   *   plain click renders byte-identical and emits nothing new. Only a
   *   pointer that hits a DIFFERENT cell touches state (the lastHit gate
   *   below), so a micro-jitter click causes zero churn too.
   * · Document listeners, NOT pointer capture: the pressed cell is
   *   virtualized and WILL unmount when edge auto-scroll carries it out
   *   of the mount window (capture on it would die mid-drag — the
   *   stranded-capture bug the gutter comments describe), and capture on
   *   the grid div would retarget the compat mouseup there, composing
   *   dblclick on the grid instead of the cell and killing double-click-
   *   to-edit. The listeners are created per drag and carried ON the drag
   *   object, so teardown removes exactly this drag's ears and can never
   *   detach a newer drag's.
   * · The selection applies LIVE on every hit change — there is no commit
   *   step — so ending the drag is pure teardown, idempotent by
   *   construction: every exit (pointerup, pointercancel, Escape, the
   *   missed-release self-heal, unmount) just calls endCellDrag, and a
   *   nulled ref can never hijack a later gesture. Escape ends the DRAG
   *   but keeps the range selected so far, like Sheets. */
  type CellDragState = {
    pointerId: number;
    /** The mousedown cell — the anchor fallback (`anchor ?? origin`): a
     *  plain press anchors here on its first extending move, while a
     *  Shift+press keeps extending from the anchor its own mousedown
     *  already set (the functional update never overwrites a non-null
     *  anchor), so Shift+click-then-pull extends like Sheets. */
    origin: Cell;
    /** Last hit-tested (display row, col). Selection updates are gated on
     *  the hit actually CHANGING; seeded with the pressed cell so motion
     *  inside it is free. */
    lastHit: { r: number; c: number };
    /** Last pointer position in client px. The auto-scroll loop
     *  re-hit-tests with THIS while the content slides underneath a
     *  stationary pointer — hold-at-the-edge keeps selecting. */
    lastClientX: number;
    lastClientY: number;
    /** Press position — the engagement threshold measures from here. */
    startClientX: number;
    startClientY: number;
    /** True once the pointer actually dragged (left the press threshold).
     *  The auto-scroll frame is gated on this: a plain click on a
     *  frozen-zone cell must never move the viewport. */
    engaged: boolean;
    /** Live rAF handle of the auto-scroll loop; cancelled at teardown. */
    raf: number | null;
    listeners: {
      move: (e: PointerEvent) => void;
      up: (e: PointerEvent) => void;
      key: (e: KeyboardEvent) => void;
    };
  };
  const cellDragRef = useRef<CellDragState | null>(null);
  /* The rAF loop and the per-drag document listeners outlive many renders
   * (auto-scroll itself re-renders through viewport state), so they reach
   * the CURRENT render's hit-test/scroll logic through these refs — the
   * onSelectionChangeRef pattern. */
  const cellDragMoveRef = useRef<(clientX: number, clientY: number) => void>(() => {});
  const cellDragFrameRef = useRef<() => void>(() => {});

  /** End of the cell drag: pure teardown, nothing to commit (the
   *  selection was applied live). Whoever nulls the ref tears down;
   *  every later exit sees null and does nothing — the endFillDrag/
   *  endRowDrag dual-exit safety, made trivial by having no commit.
   *  Stable and ref-only so the unmount cleanup below can BE it. */
  const endCellDrag = useCallback(() => {
    const drag = cellDragRef.current;
    if (!drag) return;
    cellDragRef.current = null;
    if (drag.raf != null) cancelAnimationFrame(drag.raf);
    document.removeEventListener("pointermove", drag.listeners.move);
    document.removeEventListener("pointerup", drag.listeners.up);
    document.removeEventListener("pointercancel", drag.listeners.up);
    window.removeEventListener("keydown", drag.listeners.key, true);
  }, []);
  // A mid-drag unmount must not leak the document listeners or the rAF
  // loop: the unmount cleanup IS endCellDrag.
  useEffect(() => endCellDrag, [endCellDrag]);

  /** Hit-test the pointer and extend the selection to it. Row via the
   *  freeze/zoom-aware rowFromClientY (geom.rowAtY clamps into the
   *  sheet's rows), column via its mirror colFromClientX (gutter → 0,
   *  right overshoot → last) — Sheets CLAMPS an out-of-grid pointer to
   *  the nearest cell, it never cancels the drag. The functional
   *  setAnchor is ordering-proof: even when the arming mousedown's
   *  setAnchor(null) and the first extending move land in one React
   *  batch, `a ?? origin` reads the queued null and anchors at the
   *  pressed cell. A vanished origin row leaves a stale anchor, which
   *  the range memo already collapses to the active cell — the same
   *  stale-anchor story as every other gesture. */
  const updateCellDragSel = (clientX: number, clientY: number) => {
    const drag = cellDragRef.current;
    if (!drag || rowCount === 0 || colCount === 0) return;
    const c = colFromClientX(clientX);
    const r = rowFromClientY(clientY);
    if (c == null || r == null) return;
    if (drag.lastHit.r === r && drag.lastHit.c === c) return; // same cell: zero churn
    drag.lastHit = { r, c };
    const rowId = rowIds[r];
    if (!rowId) return;
    const origin = drag.origin;
    setAnchor((a) => a ?? origin);
    setActive({ rowId, c });
    // No scrollCellIntoView here: mid-drag scrolling belongs to the
    // proportional edge loop below, and snapping would fight it.
  };

  /* One edge auto-scroll frame, run on a rAF loop that lives exactly as
   * long as the drag. While the pointer sits outside the scroller's BODY
   * area — past the sticky header + frozen band on top, past the gutter +
   * frozen columns on the left, past the client box's right/bottom — the
   * scroller moves by a step proportional to the overshoot (capped at
   * CELL_DRAG_MAX_SCROLL_PX) and the selection is re-hit-tested with the
   * LAST pointer position: pointermove stops when the pointer stops, but
   * the content keeps sliding underneath it, and re-hit-testing here is
   * what makes hold-at-the-edge keep selecting like Sheets. Inside the
   * body area the frame is a cheap bounds check that does nothing.
   * Bounds are computed in VISUAL px (clientX/Y's space): layout offsets
   * are multiplied by the effective CSS zoom — the exact inverse of the
   * division the hit-test helpers apply. */
  const cellDragFrame = () => {
    const drag = cellDragRef.current;
    const el = scrollRef.current;
    if (!drag || !el) return;
    // Scroll only once the gesture has ENGAGED (pointer left the pressed
    // cell or crossed the drag threshold): a plain click on a frozen-zone
    // cell is "outside the body area" by these bounds from the first
    // frame, and without this gate a 150ms press visibly yanked the
    // viewport. Selection extension itself needs no gate.
    if (!drag.engaged) return;
    const rect = el.getBoundingClientRect();
    const z = cssZoomOf(el);
    const bodyTop = rect.top + (el.clientTop + SHEET_ROW_H + bandH) * z;
    const bodyBottom = rect.top + (el.clientTop + el.clientHeight) * z;
    const bodyRight = rect.left + (el.clientLeft + el.clientWidth) * z;
    // min() guards the degenerate frozen-columns-wider-than-viewport
    // layout: the left bound must never cross the right one.
    const bodyLeft = Math.min(rect.left + (el.clientLeft + (colOffsets[fc] ?? GUTTER_W)) * z, bodyRight);
    const x = drag.lastClientX;
    const y = drag.lastClientY;
    const overX = x < bodyLeft ? x - bodyLeft : x > bodyRight ? x - bodyRight : 0;
    const overY = y < bodyTop ? y - bodyTop : y > bodyBottom ? y - bodyBottom : 0;
    if (overX === 0 && overY === 0) return;
    // Overshoot (visual px) → layout scroll step: divide by zoom, ramp at
    // a quarter of the overshoot, floor 1 so any overshoot creeps, cap so
    // a wild fling stays controllable.
    const step = (over: number) => {
      const mag = Math.min(CELL_DRAG_MAX_SCROLL_PX, Math.max(1, Math.abs(over) / (4 * z)));
      return over < 0 ? -mag : mag;
    };
    const prevTop = el.scrollTop;
    const prevLeft = el.scrollLeft;
    if (overY !== 0) el.scrollTop = prevTop + step(overY);
    if (overX !== 0) el.scrollLeft = prevLeft + step(overX);
    // At a scroll limit nothing moved and the hit cannot have changed —
    // skip the re-test so a pinned drag idles instead of churning.
    if (el.scrollTop !== prevTop || el.scrollLeft !== prevLeft) cellDragMoveRef.current(x, y);
  };

  // Re-point the loop/listener refs at THIS render's logic (every render:
  // rowIds, geometry, freeze and zoom all flow through these closures).
  useEffect(() => {
    cellDragMoveRef.current = updateCellDragSel;
    cellDragFrameRef.current = cellDragFrame;
  });

  /** Arm the drag from a cell's pointerdown. State untouched here — see
   *  the section comment. Mutual exclusion with the other three drag
   *  gestures is by construction: each arms from a disjoint DOM zone
   *  (cells here; the gutter, its resize strip and the fill handle each
   *  own theirs, and the handle additionally stops propagation), and
   *  every arm site abandons any STALE sibling ref first — a gesture
   *  whose release was missed (capture lost off-window, per the gutter's
   *  Chrome note) must never keep driving a later one. */
  const armCellDrag = (e: React.PointerEvent, origin: Cell, r: number, c: number) => {
    // A touch pan must scroll, not select: the browser cancels the pointer
    // once native scrolling takes over, but the few moves before that
    // would flicker the selection.
    if (e.pointerType === "touch") return;
    if (cellDragRef.current) endCellDrag();
    if (rowDragRef.current) endRowDrag(false);
    if (rowResizeRef.current) endRowResize(false);
    // A LIVE fill drag holds pointer capture, so a cell pointerdown from
    // that pointer is impossible — this only ever clears a stale one.
    if (fillDrag) endFillDrag(false);

    const onMove = (ev: PointerEvent) => {
      if (cellDragRef.current !== drag || ev.pointerId !== drag.pointerId) return;
      // Button already up: the release happened where no listener heard
      // it. Abandon on the next move — the row-drag self-heal rule.
      if (ev.buttons === 0) { endCellDrag(); return; }
      if (!drag.engaged
        && (Math.abs(ev.clientX - drag.startClientX) > ROW_DRAG_THRESHOLD_PX
          || Math.abs(ev.clientY - drag.startClientY) > ROW_DRAG_THRESHOLD_PX)) {
        drag.engaged = true;
      }
      drag.lastClientX = ev.clientX;
      drag.lastClientY = ev.clientY;
      cellDragMoveRef.current(ev.clientX, ev.clientY);
    };
    const onUp = (ev: PointerEvent) => {
      if (cellDragRef.current !== drag || ev.pointerId !== drag.pointerId) return;
      endCellDrag();
    };
    // Escape ends the DRAG, keeps the selection made so far (Sheets).
    // Window-level and capture-phase like the row drag's Escape: it must
    // work with focus anywhere, and it must stop the grid's own Escape
    // handler, which would collapse the anchor we are keeping.
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key !== "Escape" || cellDragRef.current !== drag) return;
      ev.stopPropagation();
      endCellDrag();
    };
    const drag: CellDragState = {
      pointerId: e.pointerId,
      origin,
      lastHit: { r, c },
      startClientX: e.clientX,
      startClientY: e.clientY,
      lastClientX: e.clientX,
      lastClientY: e.clientY,
      engaged: false,
      raf: null,
      listeners: { move: onMove, up: onUp, key: onKey },
    };
    cellDragRef.current = drag;
    document.addEventListener("pointermove", onMove);
    document.addEventListener("pointerup", onUp);
    document.addEventListener("pointercancel", onUp);
    window.addEventListener("keydown", onKey, true);
    // The auto-scroll / re-hit-test loop, alive for exactly this drag:
    // both identity checks pin the loop to THE drag it was started for,
    // so a superseding drag always runs on its own fresh loop and a
    // finished one reschedules nothing.
    const tick = () => {
      if (cellDragRef.current !== drag) return;
      cellDragFrameRef.current();
      if (cellDragRef.current === drag) drag.raf = requestAnimationFrame(tick);
    };
    drag.raf = requestAnimationFrame(tick);
  };

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
    // Cmd/Ctrl+Arrow is Sheets' data-edge jump (Shift extends to it). Alt is
    // excluded so Option+Arrow combinations stay whatever the OS makes of
    // them; with no modifier the arrows step one cell as before.
    const step = (e.metaKey || e.ctrlKey) && !e.altKey ? jumpToEdge : move;
    switch (e.key) {
      case "ArrowDown": e.preventDefault(); step(1, 0, extend); return;
      case "ArrowUp": e.preventDefault(); step(-1, 0, extend); return;
      case "ArrowRight": e.preventDefault(); step(0, 1, extend); return;
      case "ArrowLeft": e.preventDefault(); step(0, -1, extend); return;
      // PageUp/Down step by viewport ÷ the DEFAULT row height — an
      // estimate, kept deliberately even with custom row heights (contract:
      // a page-jump is coarse navigation; an exact variable-height page
      // count would cost a scan and land somewhere equally arbitrary).
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
  // A frozen editing row (editingR < fr) is already mounted in the band.
  if (editing && editingR != null && editingR >= fr) {
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

  /* ── overlay geometry under freeze ──────────────────────────── */
  /* The fill preview, fill handle and drop indicator are absolute boxes in
   * display coordinates. With no freeze they live in the body box at
   * (row * ROW_H, colOffsets[col]) and scroll with it. A freeze splits the
   * screen into regions that scroll differently, and an overlay that
   * crosses a freeze line has to be split the same way:
   *   · rows < fr render INSIDE the sticky band (band-local top r * ROW_H)
   *     so they stay pinned with it; rows >= fr render in the body box at
   *     (r - fr) * ROW_H;
   *   · cols < fc sit over sticky cells, so their piece is shifted right by
   *     scrollLeft (it is an absolute box in scroll space, and adding the
   *     scroll offset holds it at a fixed viewport x) and raised above the
   *     frozen cells' z; cols >= fc keep the plain offset and the original
   *     z, so they slide UNDER the frozen cells exactly like the cells they
   *     outline.
   * Borders on the cut edges are dropped so the pieces read as one box. */
  type Piece = { key: string; band: boolean; top: number; height: number; left: number; width: number; stuck: boolean; cut: { t: boolean; b: boolean; l: boolean; r: boolean } };
  const splitRect = (r1: number, r2: number, c1: number, c2: number): Piece[] => {
    const rowSpans: { a: number; b: number; band: boolean }[] = [];
    if (fr > 0 && r1 < fr) rowSpans.push({ a: r1, b: Math.min(r2, fr - 1), band: true });
    if (r2 >= fr) rowSpans.push({ a: Math.max(r1, fr), b: r2, band: false });
    const colSpans: { a: number; b: number; stuck: boolean }[] = [];
    if (fc > 0 && c1 < fc) colSpans.push({ a: c1, b: Math.min(c2, fc - 1), stuck: true });
    if (c2 >= fc) colSpans.push({ a: Math.max(c1, fc), b: c2, stuck: false });
    const pieces: Piece[] = [];
    for (const rs of rowSpans) {
      for (const cs of colSpans) {
        const left = colOffsets[cs.a] ?? GUTTER_W;
        const right = colOffsets[Math.min(cs.b, colCount - 1) + 1] ?? left;
        pieces.push({
          key: `${rs.band ? "b" : "y"}${cs.stuck ? "s" : "f"}`,
          band: rs.band,
          // Band rows sit at body-space rowTop directly (the band holds
          // rows 0..fr-1 from its own top); body-box rows shift up by the
          // band height. rowTop(rs.b + 1) - rowTop(rs.a) is the span's
          // height whatever the rows measure (uniform: (b - a + 1) * H).
          top: rs.band ? geom.rowTop(rs.a) : geom.rowTop(rs.a) - bandH,
          height: geom.rowTop(rs.b + 1) - geom.rowTop(rs.a),
          left: left + (cs.stuck ? viewport.left : 0),
          width: Math.max(0, right - left),
          stuck: cs.stuck,
          cut: {
            t: rs.band ? false : rowSpans.length > 1,
            b: rs.band && rowSpans.length > 1,
            l: cs.stuck ? false : colSpans.length > 1,
            r: cs.stuck && colSpans.length > 1,
          },
        });
      }
    }
    return pieces;
  };
  const fillPreview = fillDrag
    ? splitRect(Math.min(fillDrag.base.r1, fillDrag.to), Math.max(fillDrag.base.r2, fillDrag.to), fillDrag.base.c1, Math.min(fillDrag.base.c2, colCount - 1))
    : null;
  const renderFillPreview = (band: boolean) => fillPreview?.filter((p) => p.band === band).map((p) => (
    <div
      key={p.key}
      aria-hidden
      className={`pointer-events-none absolute ${p.stuck ? "z-[16]" : "z-10"} border-2 border-dashed border-[#0073EA]`}
      style={{
        top: p.top, height: p.height, left: p.left, width: p.width,
        ...(p.cut.t ? { borderTopWidth: 0 } : null),
        ...(p.cut.b ? { borderBottomWidth: 0 } : null),
        ...(p.cut.l ? { borderLeftWidth: 0 } : null),
        ...(p.cut.r ? { borderRightWidth: 0 } : null),
      }}
    />
  ));
  /** The handle is one point, (fillAnchor.r, fillAnchor.c)'s bottom-right
   *  corner: it lives in the band when its row is frozen and rides along
   *  with a frozen column by the same scrollLeft shift as the preview. */
  const renderFillHandle = (band: boolean) => {
    if (!fillAnchor || (fillAnchor.r < fr) !== band) return null;
    const stuck = fillAnchor.c < fc;
    return (
      <div
        aria-hidden
        title="Drag to fill"
        className={`absolute ${stuck ? "z-[16]" : "z-10"} flex items-center justify-center`}
        style={{
          // The anchor row's BOTTOM edge: rowTop(r + 1), band-local or
          // body-local (uniform: (r + 1) * ROW_H, as before).
          top: (band ? geom.rowTop(fillAnchor.r + 1) : geom.rowTop(fillAnchor.r + 1) - bandH) - 7,
          left: (colOffsets[fillAnchor.c + 1] ?? GUTTER_W) - 7 + (stuck ? viewport.left : 0),
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
          if (cellDragRef.current) endCellDrag(); // never two live gestures
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
    );
  };
  /** Row-drag drop indicator: a 2px line centred on the candidate gap.
   *  z-30 so it rides above the sticky gutter cells (z-10) and frozen cells
   *  (z-[15]) — the line must be visible across the numbers it is dropping
   *  between. Gap g is the boundary ABOVE display row g, so gaps 0..fr-1
   *  are inside the band and gap fr (the freeze line itself) is the body
   *  box's top edge. */
  const renderDropIndicator = (band: boolean) => {
    if (!rowDrag || (rowDrag.gap < fr) !== band) return null;
    return (
      <div
        aria-hidden
        className="pointer-events-none absolute left-0 right-0 z-30 bg-[#0073EA]"
        // Gap g's y is rowTop(g) — defined through g = rowCount (the gap
        // below the last row = totalHeight), band-local or body-local.
        style={{ top: (band ? geom.rowTop(rowDrag.gap) : geom.rowTop(rowDrag.gap) - bandH) - 1, height: 2 }}
      />
    );
  };

  /** Row-resize guide (Sheets look): a full-width 2px brand-blue line at
   *  the dragged boundary's LIVE position, rowTop(r) + the clamped drag
   *  height. Split across the freeze line like the drop indicator: a
   *  frozen row's boundary is pinned with the band, a body row's scrolls
   *  with the body. Scroll-space positioning makes it zoom-aware for free
   *  (the whole grid subtree scales together). z-30 for the same reason
   *  as the drop line: it must ride above sticky gutter (z-10) and frozen
   *  cells (z-[15]). */
  const renderRowResizeGuide = (band: boolean) => {
    if (!rowResize) return null;
    const rr = rowIndex.get(rowResize.rowId);
    if (rr == null || (rr < fr) !== band) return null;
    const y = geom.rowTop(rr) + rowResize.h;
    return (
      <div
        aria-hidden
        className="pointer-events-none absolute left-0 right-0 z-30 bg-[#0073EA]"
        style={{ top: (band ? y : y - bandH) - 1, height: 2 }}
      />
    );
  };

  /** Column-resize guide: the vertical twin, at the resizing column's LIVE
   *  right edge (the page's optimistic width updates arrive through the
   *  `columns` prop every mousemove, so colOffsets already track the
   *  pointer). One line spanning the grid's full height, absolutely
   *  positioned in scroll space; a frozen column's edge rides scrollLeft
   *  the same way the frozen overlays do. z-40: unlike the row overlays it
   *  must also cross the sticky header (z-20). */
  const colGuideIndex = colResizeGuideId != null ? columns.findIndex((c) => c.id === colResizeGuideId) : -1;
  const colResizeGuide = colGuideIndex >= 0 ? (
    <div
      aria-hidden
      className="pointer-events-none absolute z-40 bg-[#0073EA]"
      style={{
        top: 0,
        bottom: 0,
        left: (colOffsets[colGuideIndex + 1] ?? GUTTER_W) - 1 + (colGuideIndex < fc ? viewport.left : 0),
        width: 2,
      }}
    />
  ) : null;

  /* Background of a frozen cell. Sticky cells slide over scrolling ones, so
   * they must be opaque: the page's own fill wins (it already beats the
   * selection tint via inline style), else the selection tint flattened
   * onto white (#0073EA at 8% over #fff), else white. The active cell is
   * white by the same rule that drops its page background. */
  const frozenBg = (isActive: boolean, selected: boolean, pageBg: React.CSSProperties["backgroundColor"]) =>
    isActive ? "#fff" : (pageBg ?? (selected ? "#ebf4fd" : "#fff"));

  /** One display row. `top` is the row's offset inside whichever box holds
   *  it: r * ROW_H in the frozen band, (r - fr) * ROW_H in the body box.
   *  Everything else — gutter, cells, selection, editor — is identical in
   *  both, which is the whole point: a frozen row is an ordinary row that
   *  happens to be parented by a sticky element. */
  const renderRow = (rowId: string, r: number, top: number) => (
    <div
      key={rowId}
      role="row"
      aria-rowindex={r + 1}
      className="absolute left-0 right-0 flex border-b border-zinc-200"
      style={{ top, height: geom.rowHeight(r) }}
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
          // Mutual exclusion with the cell selection drag: a stale one
          // (release missed) must not keep driving the selection from here.
          if (cellDragRef.current) endCellDrag();
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
        {/* Row-resize boundary zone (Sheets: the seam between two row
          * numbers). A ROW_RESIZE_ZONE_PX strip along the number's BOTTOM
          * edge, fully INSIDE this gutter cell — so it is disjoint from
          * the drag-to-move surface by construction: move arms from the
          * gutter cell's own pointerdown, and this child's pointerdown
          * stops propagation, so a press in the strip can never arm a
          * move and a press outside it never starts a resize. z above the
          * number, cursor row-resize, no live height change while
          * dragging (the guide line previews; release applies). */}
        {onRowResize && (
          <div
            aria-hidden
            title={onRowAutofit ? "Drag to resize row · double-click to fit" : "Drag to resize row · double-click to reset"}
            className="absolute inset-x-0 bottom-0"
            style={{ height: ROW_RESIZE_ZONE_PX, cursor: "row-resize", touchAction: "none" }}
            onPointerDown={(e) => {
              if (e.button !== 0) return; // right-click stays the context menu
              e.preventDefault();
              e.stopPropagation(); // never reach the gutter's move-arm handler
              // Same as the gutter/cell pointerdown: stealing focus from an
              // open editor blurs it, and blur is how editors commit.
              gridRef.current?.focus();
              // Same stale-capture self-heal as the row drag: a scroll can
              // unmount a captured zone and strand the ref.
              if (rowResizeRef.current) endRowResize(false);
              if (cellDragRef.current) endCellDrag(); // never two live gestures
              const el = scrollRef.current;
              const st = {
                rowId, pointerId: e.pointerId,
                startY: e.clientY,
                startH: geom.rowHeight(r), h: geom.rowHeight(r),
                zoom: el ? cssZoomOf(el) : 1,
              };
              rowResizeRef.current = st;
              setRowResize(st);
              (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
            }}
            onPointerMove={(e) => {
              const st = rowResizeRef.current;
              if (!st || st.pointerId !== e.pointerId) return;
              // Button already up: we missed the pointerup (failed capture,
              // release outside). Abandon, same rule as the row drag.
              if (e.buttons === 0) { endRowResize(false); return; }
              const h = clampRowHeight(st.startH + (e.clientY - st.startY) / st.zoom);
              if (h === st.h) return;
              const next = { ...st, h };
              rowResizeRef.current = next;
              setRowResize(next);
            }}
            onPointerUp={(e) => { releasePointer(e); endRowResize(true); }}
            onPointerCancel={(e) => { releasePointer(e); endRowResize(false); }}
            onLostPointerCapture={() => endRowResize(true)}
            onDoubleClick={(e) => {
              // Sheets: double-click the boundary FITS the row to its
              // content — the page owns that measurement (onRowAutofit);
              // without it the legacy reset-to-default stands. The two
              // clicks' own down/up pairs each committed nothing (height
              // unchanged), so this is the only write of the gesture.
              e.stopPropagation();
              if (onRowAutofit) onRowAutofit(rowId);
              else onRowResize(rowId, SHEET_ROW_H);
            }}
          />
        )}
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
            className={`flex border-r border-zinc-200 px-2 text-[13px] leading-tight ${
              // Editing: the cell un-clips and rises above frozen cells
              // (z-15/16) so a multi-line editor can grow past the row
              // height, Sheets' expanding-editor look. Display cells keep
              // the old clipped, centered layout to the letter.
              isEditing ? "items-start overflow-visible z-30" : "items-center overflow-hidden"
            } ${
              isActive ? "outline outline-2 -outline-offset-1 outline-[#0073EA] bg-white" : selected ? "bg-[#0073EA]/8" : ""
            }`}
            // Page-owned cell style (text styles + fill +
            // conditional-formatting background). The ACTIVE
            // cell keeps its text styles but drops the
            // background: its white ground keeps the editor and
            // outline legible (inline style would beat the
            // bg-white class).
            style={c < fc ? (() => {
              // Frozen column: same page style, then pinned. Sticky keeps
              // the cell's flow slot so its neighbours don't shift; z-[15]
              // sits above scrolling cells and the z-10 fill preview, below
              // the z-20 header/band and the z-30 drop line. The last frozen
              // column draws the vertical freeze line as its right border.
              const page = isActive ? withoutBackground(cellStyle?.(rowId, col.id)) : cellStyle?.(rowId, col.id);
              return {
                width: col.width ?? COL_W,
                minWidth: col.width ?? COL_W,
                ...page,
                position: "sticky" as const,
                left: colOffsets[c],
                zIndex: 15,
                backgroundColor: frozenBg(isActive, selected, page?.backgroundColor),
                ...(c === fc - 1 ? { borderRightColor: "#d4d4d8" } : null),
                ...(isEditing ? { height: "auto", minHeight: "100%", alignSelf: "flex-start", background: "white", zIndex: 30 } : null),
              };
            })() : {
              width: col.width ?? COL_W,
              minWidth: col.width ?? COL_W,
              ...(isActive ? withoutBackground(cellStyle?.(rowId, col.id)) : cellStyle?.(rowId, col.id)),
              // Editing: the cell itself grows with the editor content (the
              // outline wraps the grown box — Sheets' expanding editor).
              // alignSelf breaks the flex stretch so height:auto can win;
              // the white ground covers the rows it overlaps.
              ...(isEditing ? { height: "auto", minHeight: "100%", alignSelf: "flex-start", background: "white" } : null),
            }}
            onPointerDown={(e) => {
              /* Sheets' click-hold-pull: ARM the selection drag. The
               * selection itself is set by onMouseDown below exactly as
               * before (arming touches no state), so a press-and-release
               * is byte-identical to the pre-drag kernel. Never arms from
               * a non-left press (right-click stays the context menu),
               * this cell's own open editor, or any editable the page
               * rendered into the cell. The gutter, header, resize strip
               * and fill handle never reach here — disjoint DOM zones
               * (the handle also stops propagation). */
              if (e.button !== 0 || isEditing) return;
              if ((e.target as HTMLElement | null)?.closest?.(EDITABLE_SEL)) return;
              armCellDrag(e, { rowId, c }, r, c);
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
                {renderEditor(rowId, col.id, { seed: editing.seed, commit: commitEdit, move: commitEditAndMove })}
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
  );

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
            {/* Corner above the gutter: Sheets' select-all. Click performs
              * EXACTLY the Cmd/Ctrl+A selection — the same guard and the
              * same one setAnchor + one setActive pair, so the rAF-deduped
              * onSelectionChange emission is shared, not duplicated. The
              * grid is refocused first (clicking a non-focusable div would
              * otherwise drop focus to body, killing follow-up keyboard
              * shortcuts — and the focus steal is what commits any open
              * editor, same as every other grid pointerdown). */}
            <div
              role="button"
              aria-label="Select all"
              className="sticky left-0 z-10 cursor-pointer border-r border-zinc-200 bg-zinc-50 hover:bg-zinc-100"
              style={{ width: GUTTER_W, minWidth: GUTTER_W }}
              onClick={() => {
                gridRef.current?.focus();
                if (rowCount > 0 && colCount > 0) { setAnchor({ rowId: rowIds[0], c: 0 }); setActive({ rowId: rowIds[rowCount - 1], c: colCount - 1 }); }
              }}
            />
            {columns.map((col, c) => (
              <div
                key={col.id}
                role="columnheader"
                className="flex items-center border-r border-zinc-200 px-1"
                // Frozen column headers stick like their cells. Opaque
                // zinc-50 (the header's own ground is 95% + blur, which
                // would let scrolled letters ghost through); the last one
                // carries the vertical freeze line.
                style={c < fc ? {
                  width: col.width ?? COL_W, minWidth: col.width ?? COL_W,
                  position: "sticky", left: colOffsets[c], zIndex: 10, backgroundColor: "#fafafa",
                  ...(c === fc - 1 ? { borderRightColor: "#d4d4d8" } : null),
                } : { width: col.width ?? COL_W, minWidth: col.width ?? COL_W }}
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

          {/* Frozen band (fr > 0 only): rows 0..fr-1, pinned directly
            * under the header by sticky top = header height, so its screen
            * position is header-bottom whatever scrollTop is. Opaque and
            * z-20 (the header's z) so the body rows scrolling under it
            * never show through; its own frozen cells/gutter stack inside
            * it. The 1px zinc-300 line at its bottom is the horizontal
            * freeze line — an absolute sibling after the rows rather than
            * a border, because the last row's own border-b would paint
            * over a band border. */}
          {fr > 0 && (
            <div className="sticky z-20 bg-white" style={{ top: SHEET_ROW_H, height: bandH }}>
              {rowIds.slice(0, fr).map((rowId, r) => renderRow(rowId, r, geom.rowTop(r)))}
              <div aria-hidden className="pointer-events-none absolute inset-x-0 bottom-0 z-30 h-px bg-zinc-300" />
              {renderDropIndicator(true)}
              {renderRowResizeGuide(true)}
              {renderFillPreview(true)}
              {renderFillHandle(true)}
            </div>
          )}

          {/* Virtualized body: rows fr..rowCount-1. Its height shrinks by
            * the band's rows, since they are laid out in the band, not
            * here; body row r sits at rowTop(r) - bandH (uniform:
            * (r - fr) * ROW_H, exactly the pre-variable-heights layout). */}
          <div style={{ height: geom.totalHeight - bandH, position: "relative" }}>
            {rowCount === 0 ? (
              <div className="flex h-24 items-center justify-center text-[13px] text-zinc-400">No rows yet. Add one below.</div>
            ) : (
              mounted.map(({ rowId, r }) => renderRow(rowId, r, geom.rowTop(r) - bandH))
            )}

            {renderDropIndicator(false)}
            {renderRowResizeGuide(false)}
            {renderFillPreview(false)}
            {renderFillHandle(false)}
          </div>

          {/* Column-resize guide spans header + band + body, so it lives
            * on the grid div itself, above all three. */}
          {colResizeGuide}
        </div>
      </div>
      {footer}
    </div>
  );
}
