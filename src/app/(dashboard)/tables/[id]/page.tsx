"use client";

/* Tables · sheet editor — a Google-Sheets-style spreadsheet.
 *
 * Chrome, top to bottom (the Sheets layout the user asked for verbatim):
 * an inline-editable title row, ONE dense toolbar (undo/redo, print, zoom,
 * currency/percent/decimals, the "123" number-format menu, filter toggle,
 * Σ, and a right-aligned File menu carrying CSV import/export), the fx
 * bar, the grid filling the rest of the viewport, and a bottom bar of
 * sheet tabs with a promptless "+". Every toolbar control is real — no
 * dead buttons (per-cell bold/italic/color does not exist yet, so those
 * controls are deliberately absent).
 *
 * Columns are anonymous letters (A, B, C…) with an optional small label;
 * "+" appends a generic text column instantly; format/highlight live in
 * the per-column "…" menu, whose "123" section shares its kind mapping
 * with the toolbar via lib/sheet-format-actions. The sheet kernel
 * (SheetGrid) renders the grid; this page owns data semantics, the
 * formula engine host, undo and CSV import/export.
 */

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Table as TableIcon, ArrowLeft, Plus, Trash2, Loader2,
  Link as LinkIcon, ChevronRight, Upload, Download, Search, Filter,
  Globe, Lock, Sigma, Star, Link2, Check, MoreHorizontal,
  Undo2, Redo2, Printer, DollarSign, Percent, ChevronDown,
} from "lucide-react";
import { useOsToast } from "@/components/layout/os/toast";
import { useConfirm, usePrompt } from "@/components/ui/dialog-provider";
import { MenuList, MenuItem } from "@/components/ui/menu";
import { MorePortal } from "@/components/layout/os/more-portal";
import { createTableEngine, columnLetter, type StructureResult } from "@/lib/sheet-engine-host";
import { isFormulaCell, FORMULA_KEY } from "@/lib/sheet-engine";
import { createUndoStack, type UndoCommand } from "@/lib/sheet-undo";
import { formatCellValue, isNegativeStyled, matchRule, type ColumnFormat, type ConditionalRule } from "@/lib/sheet-format";
import { adjustDecimals, formatPatchFor, kindForColType, NUMBER_FORMAT_CHOICES, type NumberFormatKind } from "@/lib/sheet-format-actions";
import { createUntitledSheet, NEW_SHEET_COLUMNS, NEW_SHEET_ROWS, UNTITLED_SHEET_NAME } from "@/lib/sheet-new";
import { notifyTablesChanged, onSidebarRefresh } from "@/components/layout/os/sidebar-refresh";
import { useOsShell } from "@/components/layout/os/shell-context";
import { RelationConfigModal } from "@/components/tables/relation-config-modal";
import { ColumnFormatMenu } from "@/components/tables/column-format-menu";
import { SheetGrid, type SheetSort } from "@/components/tables/sheet-grid";
import { FormulaBar, FormulaTextInput, type FormulaBarCell } from "@/components/tables/formula-bar";
import { TableFavoriteButton } from "@/components/board-view/table-favorite-button";

// The zoom steps the screenshot's Sheets zoom select offers. CSS `zoom`
// (not transform scale) so the layout REFLOWS: the kernel's virtualizer
// keeps computing against real layout px and its math stays consistent.
const ZOOM_LEVELS = [75, 90, 100, 125, 150];

type ColType = "short_text" | "long_text" | "number" | "currency" | "percent" | "rating" | "select" | "multi_select" | "date" | "checkbox" | "url" | "email" | "formula" | "link" | "lookup" | "rollup" | "attachment" | "person";

type RollupFn = "SUM" | "COUNT" | "AVG" | "MIN" | "MAX" | "CONCAT";

type Column = {
  id: string; type: ColType; label: string; options?: string[]; formula?: string; width?: number;
  // Relational (Stackby-style)
  linkTableId?: string;   // link → target DataTable
  linkColumnId?: string;  // lookup/rollup → which link column on THIS table to follow
  lookupColumnId?: string;// lookup → which column in the target table to pull
  rollupColumnId?: string;// rollup → which target column to aggregate
  rollupFn?: RollupFn;    // rollup aggregate
  // Display-only (Tables Phase 4): both ride the existing columns Json.
  // Raw cell values NEVER change shape — sort/formulas/clipboard read raw.
  format?: ColumnFormat;      // column-level number/date formatting
  rules?: ConditionalRule[];  // conditional formatting v1 (value → cell bg)
};

type LinkedTable = { id: string; name: string; columns: Column[]; titleColId: string; rows: ApiRow[] };
type ViewType = "grid" | "kanban" | "calendar" | "gallery";
type SavedView = { id: string; name: string; type: ViewType; config?: { kanbanCol?: string; calCol?: string; sort?: { colId: string; dir: "asc" | "desc" } } };
type ApiTable = { id: string; name: string; description?: string | null; columns: Column[]; views?: SavedView[]; rowCount: number; isPublic?: boolean };
type ApiRow = { id: string; values: Record<string, unknown>; position: number };

type OrgUser = { id: string; firstName?: string | null; lastName?: string | null; avatar?: string | null };
function userName(u: OrgUser | undefined): string {
  if (!u) return "—";
  return `${u.firstName ?? ""} ${u.lastName ?? ""}`.trim() || "Unnamed";
}
function userInitials(u: OrgUser | undefined): string {
  if (!u) return "?";
  return `${(u.firstName ?? "")[0] ?? ""}${(u.lastName ?? "")[0] ?? ""}`.toUpperCase() || "?";
}

/** The display/title column of a table — first short_text, else first column. */
function titleColumnId(columns: Column[]): string {
  return (columns.find((c) => c.type === "short_text") ?? columns[0])?.id ?? "";
}

/** Pull a single linked row's display title. */
function rowTitle(row: ApiRow | undefined, titleColId: string): string {
  if (!row) return "—";
  const v = row.values[titleColId];
  // A per-cell formula in another table can't be computed here (its engine
  // would need that table's rows) — show its source rather than
  // "[object Object]".
  if (isFormulaCell(v)) return `=${v[FORMULA_KEY]}`;
  return v == null || v === "" ? "Untitled" : String(v);
}

function newId() { return Math.random().toString(36).slice(2, 10); }

// The batch route 400s a whole request above MAX_OPS ops of one kind
// (api/tables/[id]/rows/batch), and select-all happily spans thousands of
// rows — so bulk work ships in slices this size.
const BATCH_MAX_OPS = 500;

// Column types the format menu (and formatCellValue routing) applies to.
// Rating keeps its stars, text stays text — formatting is opt-in per the
// Phase 4 scope (column-level only; per-cell formats deferred).
const FORMATTABLE_TYPES = new Set<ColType>(["number", "currency", "percent", "date"]);

// The red the grid already uses for formula errors — reused for
// negative-styled numbers so "red negatives" match the existing token.
const NEGATIVE_RED: React.CSSProperties = { color: "#dc2626" };

/** Fold the engine host's column-formula rewrites into a columns array —
 *  a structure change can retarget a COLUMN formula too ("=SUM(B1:B5)" after
 *  B moves), and losing that rewrite silently repoints the whole column. */
function applyColumnRewrites(cols: Column[], rewrites: { colId: string; formula: string }[]): Column[] {
  if (rewrites.length === 0) return cols;
  const byId = new Map(rewrites.map((c) => [c.colId, c.formula]));
  return cols.map((c) => (byId.has(c.id) ? { ...c, formula: byId.get(c.id)! } : c));
}

/** Cell rewrites grouped per row, as a values patch. */
function groupRewrites(cells: { colId: string; rowId: string; stored: unknown }[]): Map<string, Record<string, unknown>> {
  const byRow = new Map<string, Record<string, unknown>>();
  for (const rw of cells) {
    const m = byRow.get(rw.rowId) ?? {};
    m[rw.colId] = rw.stored;
    byRow.set(rw.rowId, m);
  }
  return byRow;
}

/** Rewrite list → the batch route's updates array (undo/redo replay shape). */
function rewritesToUpdates(cells: { colId: string; rowId: string; stored: unknown }[]): { id: string; values: Record<string, unknown> }[] {
  return [...groupRewrites(cells)].map(([id, values]) => ({ id, values }));
}

// Columns that sort as magnitudes. The column type has to decide this:
// parseFloat stops at the dash, so guessing from the string reads
// "2026-01-15" as 2026 and every same-year date compares equal.
const NUMERIC_SORT_TYPES = new Set<ColType>(["number", "currency", "percent", "rating"]);

/** Compare two cell values for the given column type. Dates are left to the
 *  collator on purpose: the date editor writes ISO "YYYY-MM-DD", which is
 *  fixed-width and so already chronological as text, and numeric collation
 *  also orders the un-padded dates a CSV import can leave behind — both
 *  without Date()'s timezone shifts and NaN cliffs. */
function compareCells(type: ColType, va: unknown, vb: unknown): number {
  // formula/rollup are typed by their result, not by the column.
  if (NUMERIC_SORT_TYPES.has(type) || (typeof va === "number" && typeof vb === "number")) {
    const na = typeof va === "number" ? va : parseFloat(String(va));
    const nb = typeof vb === "number" ? vb : parseFloat(String(vb));
    if (Number.isFinite(na) && Number.isFinite(nb)) return na - nb;
  }
  return String(va ?? "").localeCompare(String(vb ?? ""), undefined, { numeric: true, sensitivity: "base" });
}

/* ── Clipboard + fill coercion (Tables Phase 2) ──────────────────
 * The grid owns geometry; this file owns what a cell VALUE means. Text
 * arriving from Excel/Sheets has to become the stored shape each column
 * type expects, and a paste must never invent data it cannot justify. */

// What a checkbox copies OUT as, plus everything paste takes back in.
// TRUE/FALSE is what Excel and Sheets themselves write, so a round trip
// through either application survives.
const CHECKBOX_TRUE = new Set(["true", "t", "yes", "y", "1", "x", "✓", "☑"]);
const CHECKBOX_FALSE = new Set(["false", "f", "no", "n", "0"]);

/** A cell holding nothing. Lets a real skip be told apart from a
 *  blank-onto-blank no-op, which isn't worth reporting to the user. */
function isEmptyCell(v: unknown): boolean {
  return v == null || v === "" || v === false || (Array.isArray(v) && v.length === 0);
}

/** Excel and Sheets copy numbers with their formatting attached:
 *  "$1,234.50", "45%", "(120)" for a negative. Undo exactly those, and
 *  only where the grouping shape is unambiguous — "1,5" stays unparseable
 *  rather than silently becoming fifteen for a user who meant 1.5. */
function parseNumericCell(text: string): number | null {
  let s = text.replace(/[\s\u00a0]/g, "");
  let neg = false;
  if (/^\(.+\)$/.test(s)) { neg = true; s = s.slice(1, -1); } // (120) = -120
  s = s.replace(/^([-+]?)[$€£¥₹]/, "$1");
  const sm = /^[-+]/.exec(s);
  const sign = sm ? sm[0] : "";
  if (sm) s = s.slice(1);
  s = s.replace(/%$/, "");
  if (/^\d{1,3}(,\d{3})+(\.\d*)?$/.test(s)) s = s.replace(/,/g, "");
  if (!/^(\d+(\.\d*)?|\.\d+)([eE][-+]?\d+)?$/.test(s)) return null;
  const n = Number(sign + s);
  if (!Number.isFinite(n)) return null;
  return neg ? -Math.abs(n) : n;
}

/** Date columns store ISO "YYYY-MM-DD" — what the date editor writes and
 *  what compareCells sorts on. An ISO datetime is truncated to its day.
 *  Nothing else is guessed: "01/02/2026" is January 2nd to half the world
 *  and February 1st to the other half. */
function normalizeIsoDate(text: string): string | null {
  const m = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T\s]|$)/.exec(text);
  if (!m) return null;
  const mo = Number(m[2]);
  const d = Number(m[3]);
  if (mo < 1 || mo > 12 || d < 1) return null;
  // Reject impossible days, not merely d > 31: storing 2026-02-30 makes a
  // later fill-down on the column silently degrade from a date series to
  // copy-down, because the clipboard lib's stricter parser rejects it.
  const y = Number(m[1]);
  const daysInMonth = new Date(Date.UTC(y, mo, 0)).getUTCDate();
  if (d > daysInMonth) return null;
  return `${m[1]}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

/** One clipboard string → what to store in one cell.
 *  - write: store this (null clears the cell — pasting a blank over a
 *           value clears it, same as Sheets).
 *  - empty: the text has no reading in this column, so the cell is
 *           CLEARED and the count surfaced. The user aimed at this cell;
 *           leaving the old number sitting under the paste is the worse
 *           lie. Dates are the exception (see below).
 *  - skip:  leave the cell exactly as it was, and count it. */
type PasteCoercion = { kind: "write"; value: unknown } | { kind: "skip" };

function coercePaste(col: Column, raw: string): PasteCoercion {
  const text = raw.trim();
  switch (col.type) {
    // Computed. readOnlyCols already tells the grid these can't be edited;
    // a paste over one is dropped rather than written and immediately
    // recomputed away.
    case "formula": case "lookup": case "rollup":
      return { kind: "skip" };
    // A row id, a user id and an uploaded file have no text encoding a
    // paste could safely invent — "Acme Corp" is a title, not an id, and
    // resolving it by guess would point the link at the wrong record.
    case "link": case "person": case "attachment":
      return { kind: "skip" };
    case "checkbox": {
      if (text === "") return { kind: "write", value: null };
      const t = text.toLowerCase();
      if (CHECKBOX_TRUE.has(t)) return { kind: "write", value: true };
      if (CHECKBOX_FALSE.has(t)) return { kind: "write", value: false };
      return { kind: "skip" };
    }
    case "number": case "currency": case "percent": case "rating": {
      if (text === "") return { kind: "write", value: null };
      const n = parseNumericCell(text);
      if (n === null) return { kind: "skip" };
      if (col.type === "rating") {
        const r = Math.min(5, Math.max(0, Math.round(n)));
        return { kind: "write", value: r === 0 ? null : r };
      }
      return { kind: "write", value: n };
    }
    case "date": {
      if (text === "") return { kind: "write", value: null };
      // Skip, never clear. An unreadable value is a gap in our parser, not
      // a value the user asked to erase — "N/A" or a European "1.234,50" in
      // one row of a pasted report must not delete the good number already
      // in the cell. Only an explicitly empty source cell clears.
      const iso = normalizeIsoDate(text);
      return iso ? { kind: "write", value: iso } : { kind: "skip" };
    }
    case "select": {
      if (text === "") return { kind: "write", value: null };
      const hit = (col.options ?? []).find((o) => o.toLowerCase() === text.toLowerCase());
      return hit ? { kind: "write", value: hit } : { kind: "skip" };
    }
    case "multi_select": {
      if (text === "") return { kind: "write", value: null };
      const opts = col.options ?? [];
      const chosen: string[] = [];
      for (const part of text.split(",").map((p) => p.trim()).filter(Boolean)) {
        const hit = opts.find((o) => o.toLowerCase() === part.toLowerCase());
        if (!hit) return { kind: "skip" }; // one unknown choice leaves the whole cell alone
        if (!chosen.includes(hit)) chosen.push(hit);
      }
      return { kind: "write", value: chosen.length ? chosen : null };
    }
    default: // short_text, long_text, url, email
      return { kind: "write", value: text === "" ? null : raw };
  }
}

/* Escape must cancel, never save. Blur is what commits every text-ish editor
 * in this file, and Escape has to blur to close the editor — so the host
 * raises this flag first and each blur handler reads it synchronously (a ref,
 * not state: blur fires in the same tick). Null outside the sheet kernel,
 * where editors commit on blur exactly as before. */
const CellEditCancel = createContext<{ current: boolean } | null>(null);

export default function TableEditorPage({ params }: { params: Promise<{ id: string }> }) {
  const router = useRouter();
  const { toast } = useOsToast();
  const confirm = useConfirm();
  const promptDialog = usePrompt();
  const [tableId, setTableId] = useState<string | null>(null);
  const [table, setTable] = useState<ApiTable | null>(null);
  const [rows, setRows] = useState<ApiRow[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [savingCols, setSavingCols] = useState(false);
  const [search, setSearch] = useState("");
  const [sortState, setSortState] = useState<SheetSort>(null);
  // Saved-view JSON still lives in DataTable.views server-side, but the
  // only thing this surface reads or writes there is the first view's sort
  // — the view-switching UI is gone (Excel-ify decision 1).
  const viewsRef = useRef<SavedView[]>([]);
  const [filterCol, setFilterCol] = useState<string>("");
  const [filterValue, setFilterValue] = useState<string>("");
  const [activeRowId, setActiveRowId] = useState<string | null>(null);
  // Relational: rows of every table this one links to (for pickers + lookup/rollup).
  const [linkedTables, setLinkedTables] = useState<Record<string, LinkedTable>>({});
  // All org tables (for the link-target picker in the relation config modal).
  const [allTables, setAllTables] = useState<{ id: string; name: string }[]>([]);
  // Column currently being configured in the relation modal (link/lookup/rollup).
  const [configColId, setConfigColId] = useState<string | null>(null);
  // Column whose format/rules popover is open (number/currency/percent/date).
  const [formatMenuColId, setFormatMenuColId] = useState<string | null>(null);
  // Toolbar filter toggle: the search/filter row hides behind the funnel
  // icon (Sheets keeps its toolbar dense; the row appears on demand).
  const [filterOpen, setFilterOpen] = useState(false);
  // The toolbar's details dropdowns (123, File) close on outside click —
  // with two menus side by side, leaving both open reads as broken.
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      document.querySelectorAll("details.shx__dd[open]").forEach((d) => {
        if (!d.contains(e.target as Node)) d.removeAttribute("open");
      });
    };
    window.addEventListener("mousedown", onDown);
    return () => window.removeEventListener("mousedown", onDown);
  }, []);
  // Zoom (75..150), persisted per table in localStorage so a sheet reopens
  // at the zoom it was left at. Applied as CSS `zoom` on the grid wrapper.
  const [zoom, setZoom] = useState(100);
  useEffect(() => {
    if (!tableId) return;
    try {
      const v = Number(window.localStorage.getItem(`workwrk:sheet-zoom:${tableId}`));
      setZoom(ZOOM_LEVELS.includes(v) ? v : 100);
    } catch { /* storage unavailable: stay at 100 */ }
  }, [tableId]);
  const changeZoom = (v: number) => {
    setZoom(v);
    if (!tableId) return;
    try { window.localStorage.setItem(`workwrk:sheet-zoom:${tableId}`, String(v)); } catch { /* best effort */ }
  };
  // The toolbar Σ upgrade: while set, the very next "=" seed the kernel
  // opens an editor with becomes this string. See insertSumSeed below.
  const sigmaSeedRef = useRef<string | null>(null);
  // The Σ upgrade snapshotted for the WHOLE editing session (keyed by cell):
  // the host re-seeds its input whenever the seed prop CHANGES, and the
  // kernel re-renders the editor on every scroll — so a seed that flapped
  // back to "=" after the one-tick sigmaSeedRef clear would wipe the draft
  // mid-edit. Cleared when the session commits/cancels.
  const sigmaSessionRef = useRef<{ rowId: string; colId: string; seed: string } | null>(null);
  // Name at title-focus time, so an edit-free blur skips the PATCH.
  const titleBeforeEditRef = useRef<string | null>(null);
  // Org users (for Person columns), lazy-loaded when one exists.
  const [orgUsers, setOrgUsers] = useState<OrgUser[]>([]);
  // Column drag-reorder + resize.
  const [dragColId, setDragColId] = useState<string | null>(null);
  const resizeRef = useRef<{ colId: string; startX: number; startW: number } | null>(null);
  // Row right-click menu — the same action set as the row's hover icons
  // (open / delete), opened at the cursor via the shared MorePortal.
  const [rowMenu, setRowMenu] = useState<{ rowId: string; x: number; y: number } | null>(null);
  const rowMenuAnchorRef = useRef<HTMLElement | null>(null); // unused in point mode
  const rowMenuPanelRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!rowMenu) return;
    const onDown = (e: MouseEvent) => {
      if (rowMenuPanelRef.current?.contains(e.target as Node)) return;
      setRowMenu(null);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setRowMenu(null); };
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [rowMenu]);

  useEffect(() => { void params.then((p) => setTableId(p.id)); }, [params]);

  const load = useCallback(async () => {
    if (!tableId) return;
    try {
      const [tRes, rRes] = await Promise.all([
        fetch(`/api/tables/${tableId}`),
        fetch(`/api/tables/${tableId}/rows`),
      ]);
      if (!tRes.ok) throw new Error(`HTTP ${tRes.status}`);
      const td = await tRes.json();
      const rd = await rRes.json();
      const t: ApiTable = td.data ?? td;
      t.columns = Array.isArray(t.columns) ? t.columns : [];
      setTable(t);
      setRows(rd.data ?? (Array.isArray(rd) ? rd : []));
      const savedViews: SavedView[] = Array.isArray(t.views) && t.views.length ? t.views : [{ id: "default", name: "Grid", type: "grid" }];
      viewsRef.current = savedViews;
      setSortState(savedViews[0]?.config?.sort ?? null);
      savedColumnsRef.current = t.columns;
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "load failed");
    }
  }, [tableId]);
  useEffect(() => { void load(); }, [load]);

  /* ── Undo/redo (Tables Phase 4) ──────────────────────────────────
   * One command stack per table: useMemo re-creates it when the table id
   * changes, so history can never replay into a different table. Every
   * mutating path below pushes a command AFTER its optimistic action
   * succeeded; the command's undo/redo run through the STRICT helpers,
   * which throw on failure — a failed undo must never pretend it worked
   * (the stack re-pushes it, we toast + reload). */
  // eslint-disable-next-line react-hooks/exhaustive-deps -- tableId is the RESET trigger, not a read: a new table must start with empty history
  const undoStack = useMemo(() => createUndoStack(), [tableId]);
  // The stack is imperative; this tick makes canUndo/canRedo render truth.
  const [, setUndoTick] = useState(0);
  const refreshUndoUi = useCallback(() => setUndoTick((t) => t + 1), []);
  const pushUndo = useCallback((cmd: UndoCommand) => { undoStack.push(cmd); refreshUndoUi(); }, [undoStack, refreshUndoUi]);
  const runUndo = useCallback(async () => {
    const op = undoStack.undo();
    refreshUndoUi(); // busy()/canUndo changed the moment the op started
    try {
      await op;
    } catch {
      // The stack already re-pushed the command (state unknown → retryable);
      // the reload reconciles whatever the half-run left behind.
      toast(`Couldn't undo ${undoStack.peekUndoLabel() ?? "the last action"} — reloading`);
      void load();
    } finally { refreshUndoUi(); }
  }, [undoStack, toast, load, refreshUndoUi]);
  const runRedo = useCallback(async () => {
    const op = undoStack.redo();
    refreshUndoUi();
    try {
      await op;
    } catch {
      toast(`Couldn't redo ${undoStack.peekRedoLabel() ?? "the last action"} — reloading`);
      void load();
    } finally { refreshUndoUi(); }
  }, [undoStack, toast, load, refreshUndoUi]);

  /* Commands outlive the render that created them, so they must read the
   * world through refs, never through render-time closures. */
  const tableRef = useRef<ApiTable | null>(null);
  useEffect(() => { tableRef.current = table; });
  /** Last columns array the SERVER confirmed. The header rename input is
   *  controlled and mutates column state per keystroke, so by blur time the
   *  pre-edit label only survives here. */
  const savedColumnsRef = useRef<Column[] | null>(null);

  /** Batch cell writes with optimistic local apply. THROWS on any refused
   *  chunk — used by undo/redo bodies where honesty is the contract, and by
   *  callers that wrap their own catch. */
  const writeValuesBatchStrict = useCallback(async (updates: { id: string; values: Record<string, unknown> }[]) => {
    if (!tableId || updates.length === 0) return;
    const byRow = new Map(updates.map((u) => [u.id, u.values]));
    // Rows deleted since the command was captured are simply absent from
    // state and skipped by the server merge — the documented v1 semantic:
    // such a command may no-op, but it never corrupts.
    setRows((prev) => prev ? prev.map((r) => byRow.has(r.id) ? { ...r, values: { ...r.values, ...byRow.get(r.id)! } } : r) : prev);
    for (let i = 0; i < updates.length; i += BATCH_MAX_OPS) {
      const res = await fetch(`/api/tables/${tableId}/rows/batch`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ updates: updates.slice(i, i + BATCH_MAX_OPS) }),
      });
      if (!res.ok) throw new Error(`batch update HTTP ${res.status}`);
    }
  }, [tableId]);

  /** Batch row deletes (chunked), optimistic. Throws on a refused chunk;
   *  stale ids are tolerated by the route, which makes retries idempotent. */
  const deleteRowsBatchStrict = useCallback(async (ids: string[]) => {
    if (!tableId || ids.length === 0) return;
    const doomed = new Set(ids);
    setRows((prev) => prev ? prev.filter((r) => !doomed.has(r.id)) : prev);
    for (let i = 0; i < ids.length; i += BATCH_MAX_OPS) {
      const res = await fetch(`/api/tables/${tableId}/rows/batch`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ deletes: ids.slice(i, i + BATCH_MAX_OPS) }),
      });
      if (!res.ok) throw new Error(`batch delete HTTP ${res.status}`);
    }
  }, [tableId]);

  /** Batch row inserts (chunked). Appends each chunk's server-created rows
   *  locally and reports their ids via onChunk BEFORE moving on, so a
   *  restore that dies mid-way leaves a trail its retry can clean up.
   *  Returns every created row; throws on the first refused chunk. */
  const insertRowsBatchStrict = useCallback(async (
    payloads: { values: Record<string, unknown> }[],
    onChunk?: (createdIds: string[]) => void,
  ): Promise<ApiRow[]> => {
    if (!tableId || payloads.length === 0) return [];
    const all: ApiRow[] = [];
    for (let i = 0; i < payloads.length; i += BATCH_MAX_OPS) {
      const res = await fetch(`/api/tables/${tableId}/rows/batch`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ inserts: payloads.slice(i, i + BATCH_MAX_OPS) }),
      });
      if (!res.ok) throw new Error(`batch insert HTTP ${res.status}`);
      const d = await res.json();
      const payload = d?.data ?? d;
      const created: ApiRow[] = (Array.isArray(payload?.inserted) ? payload.inserted : [])
        .map((r: { id: string; values: unknown; position: number }) => ({
          id: r.id,
          values: (r.values ?? {}) as Record<string, unknown>,
          position: r.position,
        }));
      all.push(...created);
      onChunk?.(created.map((r) => r.id));
      if (created.length > 0) setRows((prev) => prev ? [...prev, ...created] : prev);
    }
    return all;
  }, [tableId]);

  /** Persist a full columns array, optimistic, throwing on failure — the
   *  strict sibling of persistColumns for undo/redo bodies. */
  const saveColumnsStrict = useCallback(async (cols: Column[]) => {
    if (!tableId) throw new Error("no table");
    setTable((prev) => prev ? { ...prev, columns: cols } : prev);
    const res = await fetch(`/api/tables/${tableId}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ columns: cols }),
    });
    if (!res.ok) throw new Error(`columns PATCH HTTP ${res.status}`);
    savedColumnsRef.current = cols;
  }, [tableId]);

  // Resolve which other tables this one references (link columns directly;
  // lookup/rollup indirectly via their link column) and fetch their rows so
  // pickers, lookups and rollups can render/compute client-side.
  const referencedTableIds = useMemo(() => {
    const cols = table?.columns ?? [];
    const ids = new Set<string>();
    const byId = new Map(cols.map((c) => [c.id, c]));
    for (const c of cols) {
      if (c.type === "link" && c.linkTableId) ids.add(c.linkTableId);
      if ((c.type === "lookup" || c.type === "rollup") && c.linkColumnId) {
        const link = byId.get(c.linkColumnId);
        if (link?.type === "link" && link.linkTableId) ids.add(link.linkTableId);
      }
    }
    return [...ids];
  }, [table?.columns]);

  useEffect(() => {
    let active = true;
    const missing = referencedTableIds.filter((id) => !linkedTables[id]);
    if (missing.length === 0) return;
    void Promise.all(missing.map(async (id) => {
      try {
        const [tRes, rRes] = await Promise.all([fetch(`/api/tables/${id}`), fetch(`/api/tables/${id}/rows`)]);
        if (!tRes.ok) return null;
        const td = await tRes.json();
        const rd = await rRes.json();
        const t = td.data ?? td;
        const columns: Column[] = Array.isArray(t.columns) ? t.columns : [];
        const rs: ApiRow[] = rd.data ?? (Array.isArray(rd) ? rd : []);
        return { id, name: t.name as string, columns, titleColId: titleColumnId(columns), rows: rs } as LinkedTable;
      } catch { return null; }
    })).then((results) => {
      if (!active) return;
      const next: Record<string, LinkedTable> = {};
      for (const r of results) if (r) next[r.id] = r;
      if (Object.keys(next).length) setLinkedTables((prev) => ({ ...prev, ...next }));
    });
    return () => { active = false; };
  }, [referencedTableIds, linkedTables]);

  // Lazy-load org users once a Person column exists.
  const hasPersonCol = (table?.columns ?? []).some((c) => c.type === "person");
  useEffect(() => {
    if (!hasPersonCol || orgUsers.length > 0) return;
    void fetch("/api/users?scope=all&limit=200").then((r) => (r.ok ? r.json() : { data: [] }))
      .then((d) => setOrgUsers(Array.isArray(d?.data) ? d.data : []))
      .catch(() => {});
  }, [hasPersonCol, orgUsers.length]);

  // Lazy-load the org table list the first time the relation config opens.
  useEffect(() => {
    if (!configColId || allTables.length > 0) return;
    void fetch("/api/tables").then((r) => (r.ok ? r.json() : [])).then((d) => {
      const list = Array.isArray(d) ? d : (d.data ?? []);
      setAllTables(list.map((t: { id: string; name: string }) => ({ id: t.id, name: t.name })));
    }).catch(() => {});
  }, [configColId, allTables.length]);

  /** True when the server accepted the patch — the undo push sites need to
   *  know an action actually landed before recording how to reverse it. */
  async function patchTable(patch: Partial<ApiTable>): Promise<boolean> {
    if (!tableId) return false;
    try {
      const res = await fetch(`/api/tables/${tableId}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      return res.ok;
    } catch { return false; }
  }

  async function persistColumns(cols: Column[]): Promise<boolean> {
    setSavingCols(true);
    const ok = await patchTable({ columns: cols });
    if (ok) savedColumnsRef.current = cols;
    setSavingCols(false);
    return ok;
  }

  /* ── Undoable column-op bodies (Tables Phase 4) ─────────────────
   * The inverse of a structural op is computed against the LIVE host (via
   * engineHostRef), not replayed from capture: undoing a rename re-rewrites
   * [New]→[Old] header refs exactly as the forward path rewrote [Old]→[New],
   * even if other edits landed in between. All of these THROW on persist
   * failure — the undo stack needs the truth. */

  async function performRenameStrict(colId: string, label: string) {
    const cur = tableRef.current;
    if (!cur) throw new Error("table gone");
    if (!cur.columns.some((c) => c.id === colId)) return; // column deleted since — no-op, never corrupt
    // An empty label is legal on this surface (anonymous Excel columns) but
    // the engine can't rewrite refs INTO it — "[]" doesn't tokenize — so a
    // clear skips the rewrite pass: [Old] refs stay and surface #NAME?,
    // which an undo (or re-labeling) cleanly repairs.
    let res: StructureResult | null = null;
    if (label !== "") { try { res = engineHostRef.current.columnRenamed(colId, label); } catch { res = null; } }
    const cols = applyColumnRewrites(
      cur.columns.map((c) => c.id === colId ? { ...c, label } : c),
      res?.rewritten.columns ?? [],
    );
    await saveColumnsStrict(cols);
    if (res && res.rewritten.cells.length > 0) await writeValuesBatchStrict(rewritesToUpdates(res.rewritten.cells));
  }

  async function performMoveStrict(colId: string, toIndex: number) {
    const cur = tableRef.current;
    if (!cur) throw new Error("table gone");
    const cols = [...cur.columns];
    const from = cols.findIndex((c) => c.id === colId);
    const to = Math.max(0, Math.min(cols.length - 1, toIndex));
    if (from < 0 || from === to) return;
    let res: StructureResult | null = null;
    try { res = engineHostRef.current.columnMoved(from, to); } catch { res = null; }
    const [moved] = cols.splice(from, 1);
    cols.splice(to, 0, moved);
    const next = applyColumnRewrites(cols, res?.rewritten.columns ?? []);
    await saveColumnsStrict(next);
    if (res && res.rewritten.cells.length > 0) await writeValuesBatchStrict(rewritesToUpdates(res.rewritten.cells));
  }

  /** One column's fields changed (format, rules, formula, relation config):
   *  a surgical patch against whatever columns exist at undo time, so the
   *  command composes with structural commands instead of snapshotting the
   *  whole array and clobbering later edits. */
  function pushColumnPatch(label: string, colId: string, before: Partial<Column>, after: Partial<Column>) {
    const apply = async (patch: Partial<Column>) => {
      const cur = tableRef.current;
      if (!cur) throw new Error("table gone");
      if (!cur.columns.some((c) => c.id === colId)) return; // column deleted since — no-op
      await saveColumnsStrict(cur.columns.map((c) => (c.id === colId ? { ...c, ...patch } : c)));
    };
    pushUndo({ label, undo: () => apply(before), redo: () => apply(after) });
  }

  /** Column format / highlight rules (Phase 4). Display-only settings, but
   *  they persist through the SAME columns path as everything else and are
   *  therefore undoable like everything else. */
  function setColumnFormat(colId: string, format: ColumnFormat | undefined) {
    if (!table) return;
    const col = table.columns.find((c) => c.id === colId);
    if (!col) return;
    const before = col.format;
    const cols = table.columns.map((c) => (c.id === colId ? { ...c, format } : c));
    setTable({ ...table, columns: cols });
    void persistColumns(cols).then((ok) => {
      if (ok) pushColumnPatch(`format "${col.label}"`, colId, { format: before }, { format });
    });
  }

  function setColumnRules(colId: string, rules: ConditionalRule[] | undefined) {
    if (!table) return;
    const col = table.columns.find((c) => c.id === colId);
    if (!col) return;
    const before = col.rules;
    const cols = table.columns.map((c) => (c.id === colId ? { ...c, rules } : c));
    setTable({ ...table, columns: cols });
    void persistColumns(cols).then((ok) => {
      if (ok) pushColumnPatch(`highlight rules on "${col.label}"`, colId, { rules: before }, { rules });
    });
  }

  /** Apply per-column before/after patches as ONE optimistic columns write
   *  and ONE undo command — the multi-column sibling of pushColumnPatch, for
   *  toolbar buttons that act on every column the selection intersects. The
   *  undo/redo bodies re-read live columns through tableRef (a column
   *  deleted since is skipped, never corrupted), and tableRef is bumped
   *  eagerly so rapid toolbar clicks compose like addColumn's do. */
  function applyColumnPatches(patches: { colId: string; before: Partial<Column>; after: Partial<Column> }[], label: string) {
    if (patches.length === 0) return;
    const cur = tableRef.current ?? table;
    if (!cur) return;
    const byId = new Map(patches.map((p) => [p.colId, p]));
    const cols = cur.columns.map((c) => (byId.has(c.id) ? { ...c, ...byId.get(c.id)!.after } : c));
    tableRef.current = { ...cur, columns: cols };
    setTable((prev) => (prev ? { ...prev, columns: cols } : prev));
    void persistColumns(cols).then((ok) => {
      if (!ok) return;
      const apply = async (pick: "before" | "after") => {
        const live = tableRef.current;
        if (!live) throw new Error("table gone");
        await saveColumnsStrict(live.columns.map((c) => (byId.has(c.id) ? { ...c, ...byId.get(c.id)![pick] } : c)));
      };
      pushUndo({ label, undo: () => apply("before"), redo: () => apply("after") });
    });
  }

  /** The "123" menu's one action (Sheets' Format → Number → Currency mental
   *  model, replacing the rejected Type submenu): a kind sets col.type AND a
   *  starter col.format together, in a single write so a single undo
   *  restores both. The kind→patch mapping is shared with the column "…"
   *  popover via lib/sheet-format-actions, so the two menus cannot drift.
   *  Legacy/relational columns are skipped — the popover shows them a
   *  read-only line instead. */
  function applyNumberFormat(colIds: string[], kind: NumberFormatKind) {
    const cur = tableRef.current ?? table;
    if (!cur) return;
    const patch = formatPatchFor(kind);
    applyColumnPatches(
      colIds
        .map((id) => cur.columns.find((c) => c.id === id))
        .filter((c): c is Column => !!c && kindForColType(c.type) !== undefined)
        .map((c) => ({
          colId: c.id,
          before: { type: c.type, format: c.format },
          after: { type: patch.type as ColType, format: patch.format },
        })),
      `format as ${kind}`,
    );
  }

  /** Sort rides in the SAME DataTable.views JSON the old saved-view UI
   *  wrote (first view's config.sort), so nothing changes server-side and
   *  a legacy table's other views pass through untouched — they just never
   *  render again on this surface. */
  const persistSort = (sn: SheetSort) => {
    setSortState(sn);
    const cur: SavedView[] = viewsRef.current.length ? viewsRef.current : [{ id: "default", name: "Grid", type: "grid" }];
    const next = cur.map((v, i) => (i === 0 ? { ...v, config: { ...v.config, sort: sn ?? undefined } } : v));
    viewsRef.current = next;
    void patchTable({ views: next });
  };

  /** "+" appends a generic text column INSTANTLY — no dialog, no type
   *  picker (Excel-ify decision 3). A column's type/format lives in its
   *  "…" menu now. tableRef is bumped eagerly so rapid clicks compose
   *  (each sees the column the previous click just appended). */
  async function addColumn() {
    const cur = tableRef.current ?? table;
    if (!cur) return;
    const def: Column = { id: newId(), type: "short_text", label: "" };
    const cols = [...cur.columns, def];
    tableRef.current = { ...cur, columns: cols };
    setTable((prev) => (prev ? { ...prev, columns: [...prev.columns, def] } : prev));
    const ok = await persistColumns(cols);
    if (ok) {
      const at = cols.length - 1;
      pushUndo({
        label: `add column ${columnLetter(at)}`,
        undo: async () => {
          // Inverse of an append: delete it, letting the live host produce
          // whatever rewrites refs into/past it now need.
          const curT = tableRef.current;
          if (!curT) throw new Error("table gone");
          if (!curT.columns.some((c) => c.id === def.id)) return;
          let res: StructureResult | null = null;
          try { res = engineHostRef.current.columnDeleted(def.id); } catch { res = null; }
          const next = applyColumnRewrites(curT.columns.filter((c) => c.id !== def.id), res?.rewritten.columns ?? []);
          await saveColumnsStrict(next);
          if (res && res.rewritten.cells.length > 0) await writeValuesBatchStrict(rewritesToUpdates(res.rewritten.cells));
        },
        redo: async () => {
          const curT = tableRef.current;
          if (!curT) throw new Error("table gone");
          if (curT.columns.some((c) => c.id === def.id)) return;
          const next = [...curT.columns];
          next.splice(Math.min(at, next.length), 0, { ...def });
          await saveColumnsStrict(next);
        },
      });
    }
  }

  /** The blank-sheet seed for a table that has zero columns (legacy, or a
   *  creation whose seeding failed): the SAME 26-column (A..Z) × 100-row
   *  shape lib/sheet-new seeds at creation time, so every sheet opens as
   *  the sea of empty cells the user asked for. Not undoable on purpose —
   *  it IS the blank sheet. */
  async function startSheet() {
    const cur = tableRef.current ?? table;
    if (!cur || cur.columns.length > 0) return;
    const cols: Column[] = Array.from({ length: NEW_SHEET_COLUMNS }, () => ({ id: newId(), type: "short_text", label: "" }));
    // Eager tableRef bump, same as addColumn: the guard above must see the
    // new columns immediately, or a double-click faster than the sync
    // effect fires the 100-row seed twice (200 blank rows).
    if (tableRef.current) tableRef.current = { ...tableRef.current, columns: cols };
    setTable((prev) => (prev ? { ...prev, columns: cols } : prev));
    const ok = await persistColumns(cols);
    if (!ok) { toast("Couldn't start the sheet"); void load(); return; }
    try {
      await insertRowsBatchStrict(Array.from({ length: NEW_SHEET_ROWS }, () => ({ values: {} })));
    } catch { toast("Couldn't add the starter rows"); }
  }

  function saveColumnConfig(colId: string, patch: Partial<Column>) {
    if (!table) return;
    const col = table.columns.find((c) => c.id === colId);
    // Before = the same keys the patch touches, read from the pre-patch
    // column, so undo restores only what this action changed.
    const before = col
      ? (Object.fromEntries(Object.keys(patch).map((k) => [k, (col as unknown as Record<string, unknown>)[k]])) as Partial<Column>)
      : null;
    const cols = table.columns.map((c) => c.id === colId ? { ...c, ...patch } : c);
    setTable({ ...table, columns: cols });
    void persistColumns(cols).then((ok) => {
      if (ok && before) pushColumnPatch(`configure "${col!.label}"`, colId, before, patch);
    });
    setConfigColId(null);
  }

  async function editFormula(colId: string) {
    if (!table) return;
    const col = table.columns.find((c) => c.id === colId);
    if (!col) return;
    const f = await promptDialog({ title: "Edit formula:", defaultValue: col.formula ?? "=" });
    if (f == null) return;
    const prev = col.formula;
    const next = f.trim();
    if (next === (prev ?? "")) return;
    const cols = table.columns.map((c) => c.id === colId ? { ...c, formula: next } : c);
    setTable({ ...table, columns: cols });
    const ok = await persistColumns(cols);
    if (ok) pushColumnPatch(`edit formula of "${col.label}"`, colId, { formula: prev }, { formula: next });
  }

  function renameColumn(colId: string, label: string) {
    if (!table) return;
    // The header input is controlled and mutates column state per keystroke,
    // so by blur time the pre-edit label survives only in the last
    // SERVER-CONFIRMED columns — that is the honest "before" for undo.
    const prevLabel = savedColumnsRef.current?.find((c) => c.id === colId)?.label;
    // Rewrites come from the PRE-rename host, same as deleteColumn: [Header]
    // refs must follow the rename, and without persisting the rewritten
    // sources a rename to a label another column already carries would
    // silently repoint refs via the leftmost-wins rule.
    // Empty labels never go through the engine: "[]" doesn't tokenize, so
    // rewriting [Old] refs to it would corrupt stored formulas. They keep
    // [Old] and show #NAME? instead — honest and undoable.
    let res: StructureResult | null = null;
    if (label !== "") { try { res = engineHost.columnRenamed(colId, label); } catch { /* a rewrite failure must never block the rename */ } }
    const cols = applyColumnRewrites(
      table.columns.map((c) => c.id === colId ? { ...c, label } : c),
      res?.rewritten.columns ?? [],
    );
    setTable({ ...table, columns: cols });
    void (async () => {
      const ok = await persistColumns(cols);
      // Awaited so an immediate undo can't race the rewrite POST (it never throws).
      await persistCellRewrites(res?.rewritten.cells ?? []);
      if (ok && prevLabel !== undefined && prevLabel !== label) {
        pushUndo({
          label: `rename column to "${label}"`,
          // Inverse rename through the live host, so [New]→[Old] header
          // refs are rewritten back exactly as the forward path did.
          undo: () => performRenameStrict(colId, prevLabel),
          redo: () => performRenameStrict(colId, label),
        });
      }
    })();
  }

  async function deleteColumn(colId: string) {
    if (!table) return;
    if (!(await confirm({ title: "Delete column", description: "Delete this column? Existing cell values for it will be lost.", destructive: true, confirmLabel: "Delete" }))) return;
    // Undo capture BEFORE anything mutates: the column def and its index,
    // every row's stored value for it (stored formula objects included), and
    // — once the host reports its rewrites — the PRE-delete sources those
    // rewrites replaced, so an undo restores "=B1", never the "#REF!" the
    // delete wrote.
    const colIndex = table.columns.findIndex((c) => c.id === colId);
    const colDef = table.columns[colIndex];
    if (!colDef) return;
    const colSnapshot: Column = { ...colDef };
    const cellValues = (rows ?? [])
      .filter((r) => r.values[colId] !== undefined)
      .map((r) => ({ id: r.id, v: r.values[colId] }));
    // Rewrites come from the PRE-delete host: refs right of the column shift
    // left, refs into it become #REF! — without persisting these, every
    // stored formula silently repoints (the bug this wave closes). The host
    // itself skips the dying column's own cells.
    let res: StructureResult | null = null;
    try { res = engineHost.columnDeleted(colId); } catch { /* a rewrite failure must never block the delete */ }
    const rewCells = res?.rewritten.cells ?? [];
    const rewCols = res?.rewritten.columns ?? [];
    // Pre-delete stored sources of everything the delete rewrote — read
    // from React state, which the host's own mutation never touches.
    const priorCellSources = rewCells.map((rw) => ({
      colId: rw.colId, rowId: rw.rowId, stored: rowById.get(rw.rowId)?.values[rw.colId] ?? null,
    }));
    const priorColFormulas = new Map(rewCols.map((cw) => [cw.colId, table.columns.find((c) => c.id === cw.colId)?.formula]));
    const cols = applyColumnRewrites(table.columns.filter((c) => c.id !== colId), rewCols);
    setTable({ ...table, columns: cols });
    const ok = await persistColumns(cols);
    // AWAITED (unlike the pre-Phase-4 fire-and-forget): an immediate Cmd+Z
    // must not have its restored sources overtaken by a still-in-flight
    // rewrite POST landing after them. persistCellRewrites never throws.
    await persistCellRewrites(rewCells);
    if (!ok) return; // the delete never landed on the server — nothing to undo
    pushUndo({
      label: `delete column "${colSnapshot.label}"`,
      undo: async () => {
        const cur = tableRef.current;
        if (!cur) throw new Error("table gone");
        if (cur.columns.some((c) => c.id === colSnapshot.id)) return; // already restored
        const next = [...cur.columns];
        next.splice(Math.min(colIndex, next.length), 0, { ...colSnapshot });
        // Column formulas that were rewritten by the delete go back to
        // their pre-delete sources (the snapshot itself carries its own).
        const restored = next.map((c) =>
          c.id !== colSnapshot.id && priorColFormulas.has(c.id) ? { ...c, formula: priorColFormulas.get(c.id) } : c);
        await saveColumnsStrict(restored);
        // Values + pre-delete cell sources, merged per row, chunked.
        const byRow = new Map<string, Record<string, unknown>>();
        for (const cv of cellValues) {
          const m = byRow.get(cv.id) ?? {};
          m[colSnapshot.id] = cv.v;
          byRow.set(cv.id, m);
        }
        for (const ps of priorCellSources) {
          const m = byRow.get(ps.rowId) ?? {};
          m[ps.colId] = ps.stored;
          byRow.set(ps.rowId, m);
        }
        await writeValuesBatchStrict([...byRow].map(([id, values]) => ({ id, values })));
      },
      redo: async () => {
        const cur = tableRef.current;
        if (!cur) throw new Error("table gone");
        // Repeat the delete with the CAPTURED rewrites — after an undo the
        // layout matches the original pre-delete state, so they still apply.
        const next = applyColumnRewrites(cur.columns.filter((c) => c.id !== colSnapshot.id), rewCols);
        await saveColumnsStrict(next);
        if (rewCells.length > 0) await writeValuesBatchStrict(rewritesToUpdates(rewCells));
      },
    });
  }

  // Drag-to-reorder columns (handle = the column-type icon).
  function moveColumn(fromId: string, toId: string) {
    if (!table || fromId === toId) return;
    const cols = [...table.columns];
    const from = cols.findIndex((c) => c.id === fromId);
    const to = cols.findIndex((c) => c.id === toId);
    if (from < 0 || to < 0) return;
    // Same discipline as deleteColumn: stored sources follow the move so
    // "=B1" keeps meaning the same cell after B becomes C. The host takes
    // the same (from, to) indices the splice below uses.
    let res: StructureResult | null = null;
    try { res = engineHost.columnMoved(from, to); } catch { /* never block the move */ }
    const [moved] = cols.splice(from, 1);
    cols.splice(to, 0, moved);
    const next = applyColumnRewrites(cols, res?.rewritten.columns ?? []);
    setTable({ ...table, columns: next });
    void (async () => {
      const ok = await persistColumns(next);
      // Awaited so an immediate undo can't race the rewrite POST (it never throws).
      await persistCellRewrites(res?.rewritten.cells ?? []);
      if (ok) {
        pushUndo({
          label: `move column "${moved.label}"`,
          // Inverse move via the live host: sources follow the column back.
          undo: () => performMoveStrict(fromId, from),
          redo: () => performMoveStrict(fromId, to),
        });
      }
    })();
  }

  // Column resize — width persisted on the column (optimistic update while
  // dragging; persist once on release).
  function setColumnWidthLocal(colId: string, width: number) {
    setTable((prev) => prev ? { ...prev, columns: prev.columns.map((c) => c.id === colId ? { ...c, width } : c) } : prev);
  }
  function startResize(e: React.MouseEvent, colId: string) {
    e.preventDefault();
    const col = table?.columns.find((c) => c.id === colId);
    // clientX deltas are visual px, scaled by the grid's CSS zoom; column
    // widths are unscaled layout px. Normalize by the zoom in effect when
    // the drag started (it cannot change mid-drag).
    const z = zoom / 100 || 1;
    resizeRef.current = { colId, startX: e.clientX, startW: col?.width ?? 160 };
    const onMove = (ev: MouseEvent) => {
      const st = resizeRef.current;
      if (!st) return;
      setColumnWidthLocal(st.colId, Math.max(80, Math.round(st.startW + (ev.clientX - st.startX) / z)));
    };
    const onUp = () => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
      resizeRef.current = null;
      setTable((prev) => { if (prev) void persistColumns(prev.columns); return prev; });
    };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  }

  /** One creation path for every row insert on this page, so each created
   *  row is undoable the same way. */
  async function createRow(values: Record<string, unknown>): Promise<ApiRow | null> {
    if (!tableId) return null;
    try {
      const res = await fetch(`/api/tables/${tableId}/rows`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ values }),
      });
      if (!res.ok) throw new Error(`POST ${res.status}`);
      const d = await res.json();
      const row: ApiRow = d.data ?? d;
      setRows((prev) => [...(prev ?? []), row]);
      // An end-append can't shift any existing ref, so this yields no
      // rewrites today — called so the contract is exercised where the page
      // inserts rows, ready for mid-table inserts later.
      try {
        const hostRes = engineHost.rowInserted({ id: row.id, values: row.values ?? {} }, (rows ?? []).length);
        void persistCellRewrites(hostRes.rewritten.cells);
      } catch { /* never block the insert */ }
      // Undo deletes the created row; redo re-inserts its values. The server
      // returns a NEW id on redo, so the command re-captures it — otherwise
      // a second undo would aim at an id that no longer exists.
      let curId = row.id;
      const snapValues = { ...(row.values ?? {}) };
      pushUndo({
        label: "add row",
        undo: () => deleteRowsBatchStrict([curId]),
        redo: async () => {
          const created = await insertRowsBatchStrict([{ values: snapValues }]);
          if (created[0]) curId = created[0].id;
        },
      });
      return row;
    } catch { toast("Couldn't add row"); return null; }
  }

  async function addRow() { await createRow({}); }

  /** Optimistic single-row PATCH, undoable. Before-values are captured from
   *  local state ahead of the optimistic write; the formula path passes
   *  `opts.before` instead — engine setCell's { previous } return, which is
   *  the authoritative overwritten value (built for exactly this wave). */
  async function patchRow(rowId: string, values: Record<string, unknown>, opts?: { before?: Record<string, unknown>; label?: string }) {
    if (!tableId) return;
    const prevRow = (rows ?? []).find((r) => r.id === rowId);
    const before: Record<string, unknown> = {};
    for (const k of Object.keys(values)) {
      // An absent key restores as null: indistinguishable to every reader
      // (both are the empty cell) and Json cannot hold undefined anyway.
      before[k] = (opts?.before && k in opts.before ? opts.before[k] : prevRow?.values[k]) ?? null;
    }
    setRows((prev) => prev ? prev.map((r) => r.id === rowId ? { ...r, values: { ...r.values, ...values } } : r) : prev);
    try {
      const res = await fetch(`/api/tables/${tableId}/rows`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: rowId, values }),
      });
      if (!res.ok) throw new Error(`PATCH ${res.status}`);
      if (prevRow) {
        pushUndo({
          label: opts?.label ?? "cell edit",
          undo: () => writeValuesBatchStrict([{ id: rowId, values: before }]),
          redo: () => writeValuesBatchStrict([{ id: rowId, values }]),
        });
      }
    } catch { toast("Cell didn't save"); }
  }

  /** Persist the engine host's per-cell rewrites after a structure change.
   *  The stored value is the { "=": source } object the host built — the
   *  same shape a formula edit stores — through the same batch path as every
   *  other bulk write. Computed values are derived and are never persisted. */
  async function persistCellRewrites(cells: { colId: string; rowId: string; stored: unknown }[]) {
    if (!tableId || cells.length === 0) return;
    const byRow = groupRewrites(cells);
    setRows((prev) => prev ? prev.map((r) => byRow.has(r.id) ? { ...r, values: { ...r.values, ...byRow.get(r.id)! } } : r) : prev);
    const updates = [...byRow].map(([id, values]) => ({ id, values }));
    try {
      for (let i = 0; i < updates.length; i += BATCH_MAX_OPS) {
        const res = await fetch(`/api/tables/${tableId}/rows/batch`, {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ updates: updates.slice(i, i + BATCH_MAX_OPS) }),
        });
        if (!res.ok) throw new Error();
      }
    } catch { toast("Couldn't rewrite formulas for the new layout"); void load(); }
  }

  async function clearCells(cells: { rowId: string; colId: string }[]) {
    if (!tableId || cells.length === 0) return;
    const byRow = new Map<string, Record<string, unknown>>();
    // Before-values captured from pre-clear state, per cell actually cleared
    // — an undo puts back EXACTLY what was there, stored formulas included.
    const befores = new Map<string, Record<string, unknown>>();
    for (const c of cells) {
      const m = byRow.get(c.rowId) ?? {};
      m[c.colId] = null;
      byRow.set(c.rowId, m);
      const b = befores.get(c.rowId) ?? {};
      b[c.colId] = rowById.get(c.rowId)?.values[c.colId] ?? null;
      befores.set(c.rowId, b);
    }
    setRows((prev) => prev ? prev.map((r) => byRow.has(r.id) ? { ...r, values: { ...r.values, ...byRow.get(r.id)! } } : r) : prev);
    const updates = [...byRow].map(([id, values]) => ({ id, values }));
    try {
      // Sequential slices: a failure part-way stops the rest, and the reload
      // in the catch reconciles whatever did land — the UI never keeps an
      // optimistic clear the server rejected.
      for (let i = 0; i < updates.length; i += BATCH_MAX_OPS) {
        const res = await fetch(`/api/tables/${tableId}/rows/batch`, {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ updates: updates.slice(i, i + BATCH_MAX_OPS) }),
        });
        if (!res.ok) throw new Error();
      }
      const beforeUpdates = [...befores].map(([id, values]) => ({ id, values }));
      pushUndo({
        label: `clear ${cells.length} cell${cells.length === 1 ? "" : "s"}`,
        undo: () => writeValuesBatchStrict(beforeUpdates),
        redo: () => writeValuesBatchStrict(updates),
      });
    } catch { toast("Couldn't clear cells"); void load(); }
  }

  async function bulkDeleteRows(ids: string[]) {
    if (!tableId || ids.length === 0) return;
    if (!(await confirm({
      title: `Delete ${ids.length} row${ids.length === 1 ? "" : "s"}`,
      description: "Deleted rows can't be recovered.",
      destructive: true, confirmLabel: "Delete",
    }))) return;
    const doomed = new Set(ids);
    // Rewrites for the SURVIVORS, computed before local state loses the rows:
    // refs below a deleted row shift up, refs into it become #REF!. Each
    // hook call mutates the host's model, so later calls see the shape the
    // earlier ones left — the merged map (last write wins) is cumulative.
    const cellRewrites = new Map<string, { colId: string; rowId: string; stored: unknown }>();
    const colRewrites = new Map<string, string>();
    try {
      for (const id of ids) {
        const res = engineHost.rowDeleted(id);
        for (const rw of res.rewritten.cells) {
          if (doomed.has(rw.rowId)) continue;
          cellRewrites.set(`${rw.rowId}:${rw.colId}`, rw);
        }
        for (const cw of res.rewritten.columns) colRewrites.set(cw.colId, cw.formula);
      }
    } catch { /* never block the delete */ }
    // Full snapshots BEFORE the optimistic removal — plan 3a names undo as
    // the REQUIRED mitigation for this unrecoverable deleteMany. Positions
    // ride along and are sent as EXPLICIT insert positions on undo, so
    // restored rows land exactly where they were, not at the end.
    const snapshots = (rows ?? [])
      .filter((r) => doomed.has(r.id))
      .map((r) => ({ values: { ...r.values }, position: r.position }));
    // Survivors' PRE-rewrite stored values, captured before the optimistic
    // apply: with exact-position restore below, an undo puts every ref back
    // on the row it originally named, so the #REF! rewrites can be honestly
    // reverted instead of left behind.
    const rowById = new Map((rows ?? []).map((r) => [r.id, r]));
    const survivorBefores = [...cellRewrites.values()].map((rw) => ({
      rowId: rw.rowId,
      colId: rw.colId,
      before: rowById.get(rw.rowId)?.values?.[rw.colId] ?? null,
      after: rw.stored,
    }));
    // Same one-frame discipline as deleteRow: removals + survivor rewrites
    // apply together locally; persistence still waits for the deletes.
    const rwByRow = groupRewrites([...cellRewrites.values()]);
    setRows((prev) => prev
      ? prev.filter((r) => !doomed.has(r.id)).map((r) => rwByRow.has(r.id) ? { ...r, values: { ...r.values, ...rwByRow.get(r.id)! } } : r)
      : prev);
    try {
      for (let i = 0; i < ids.length; i += BATCH_MAX_OPS) {
        const res = await fetch(`/api/tables/${tableId}/rows/batch`, {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ deletes: ids.slice(i, i + BATCH_MAX_OPS) }),
        });
        if (!res.ok) throw new Error();
      }
      // The server hands restored rows NEW ids, so the command re-captures
      // them: a second undo/redo cycle acts on rows that actually exist.
      // Restored rows keep their ORIGINAL positions, so survivors' #REF!
      // rewrites are reverted too — the refs point at the same rows again
      // and the table comes back byte-identical.
      let currentIds = ids.slice();
      let restoredIds: string[] = [];
      pushUndo({
        label: `delete ${ids.length} row${ids.length === 1 ? "" : "s"}`,
        undo: async () => {
          if (restoredIds.length > 0) {
            // A previous undo attempt died mid-chunk: remove its partial
            // restore first, or the retry would duplicate those rows.
            await deleteRowsBatchStrict(restoredIds);
            restoredIds = [];
          }
          const created = await insertRowsBatchStrict(
            [...snapshots].sort((a, b) => a.position - b.position)
              .map((s) => ({ values: s.values, position: s.position })),
            (chunkIds) => restoredIds.push(...chunkIds),
          );
          currentIds = created.map((r) => r.id);
          if (survivorBefores.length > 0) {
            const groupSurvivor = (pick: (b: typeof survivorBefores[number]) => unknown) => {
            const byRow = new Map<string, Record<string, unknown>>();
            for (const b of survivorBefores) {
              const patch = byRow.get(b.rowId) ?? {};
              patch[b.colId] = pick(b);
              byRow.set(b.rowId, patch);
            }
            return [...byRow].map(([id, values]) => ({ id, values }));
          };
          await writeValuesBatchStrict(groupSurvivor((b) => b.before));
          }
        },
        redo: async () => {
          await deleteRowsBatchStrict(currentIds);
          restoredIds = [];
          // The undo reverted the survivors' #REF! rewrites; deleting again
          // makes them true again, so re-apply them.
          if (survivorBefores.length > 0) {
            const groupSurvivor = (pick: (b: typeof survivorBefores[number]) => unknown) => {
            const byRow = new Map<string, Record<string, unknown>>();
            for (const b of survivorBefores) {
              const patch = byRow.get(b.rowId) ?? {};
              patch[b.colId] = pick(b);
              byRow.set(b.rowId, patch);
            }
            return [...byRow].map(([id, values]) => ({ id, values }));
          };
          await writeValuesBatchStrict(groupSurvivor((b) => b.after));
          }
        },
      });
      void persistCellRewrites([...cellRewrites.values()]);
      if (colRewrites.size > 0 && table) {
        // Row ranges inside COLUMN formulas shrink too ("=SUM(A1:A5)").
        const cols = applyColumnRewrites(table.columns, [...colRewrites].map(([colId, formula]) => ({ colId, formula })));
        setTable((prev) => (prev ? { ...prev, columns: cols } : prev));
        void persistColumns(cols);
      }
    } catch { toast("Couldn't delete rows"); void load(); }
  }

  async function deleteRow(rowId: string) {
    if (!tableId) return;
    if (!(await confirm({ title: "Delete row", description: "Delete this row?", destructive: true, confirmLabel: "Delete" }))) return;
    // Snapshot before anything mutates — undo restores these exact values.
    const snapshot = (rows ?? []).find((r) => r.id === rowId);
    const snapValues = snapshot ? { ...snapshot.values } : null;
    let res: StructureResult | null = null;
    try { res = engineHost.rowDeleted(rowId); } catch { /* never block the delete */ }
    // Removal and the survivors' ref rewrites land in ONE local update, so no
    // frame renders shifted rows against un-shifted refs. The server write of
    // the rewrites still waits for the delete to succeed: if the delete
    // fails, nothing rewritten was persisted and the reload restores truth.
    const rwByRow = groupRewrites(res?.rewritten.cells ?? []);
    setRows((prev) => prev
      ? prev.filter((r) => r.id !== rowId).map((r) => rwByRow.has(r.id) ? { ...r, values: { ...r.values, ...rwByRow.get(r.id)! } } : r)
      : prev);
    try {
      const delRes = await fetch(`/api/tables/${tableId}/rows`, {
        method: "DELETE", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: rowId }),
      });
      if (!delRes.ok) throw new Error(`DELETE ${delRes.status}`);
      if (snapValues) {
        // Same shape as bulk delete: the restore appends with a NEW id, the
        // command re-captures it, and survivor rewrites stay as-is (v1).
        let curId = rowId;
        pushUndo({
          label: "delete row",
          undo: async () => {
            const created = await insertRowsBatchStrict([{ values: snapValues }]);
            if (created[0]) curId = created[0].id;
          },
          redo: () => deleteRowsBatchStrict([curId]),
        });
      }
      void persistCellRewrites(res?.rewritten.cells ?? []);
      const colRewrites = res?.rewritten.columns ?? [];
      if (colRewrites.length > 0 && table) {
        const cols = applyColumnRewrites(table.columns, colRewrites);
        setTable((prev) => (prev ? { ...prev, columns: cols } : prev));
        void persistColumns(cols);
      }
    } catch { toast("Couldn't delete row"); void load(); }
  }

  async function importCsv(file: File) {
    if (!tableId) return;
    try {
      const csv = await file.text();
      const res = await fetch(`/api/tables/${tableId}/import`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ csv }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
        toast(`Import failed: ${err.error}`);
        return;
      }
      const d = await res.json();
      const r = d.data ?? d;
      toast(`Imported ${r.rowsCreated} row${r.rowsCreated === 1 ? "" : "s"}${r.columnsAdded ? `, added ${r.columnsAdded} column${r.columnsAdded === 1 ? "" : "s"}` : ""}`);
      void load();
    } catch { toast("Couldn't import CSV"); }
  }

  /** CSV export. `formatted` runs display values through formatCellValue
   *  (what the user sees, honestly); false is the pre-Phase-4 raw export,
   *  byte-for-byte. Sort/formulas always read raw either way. */
  function exportCsv(formatted: boolean) {
    if (!table || rows === null) return;
    // Anonymous columns export under their letter, like Excel would —
    // an empty header cell would make the file unreadable elsewhere.
    const headers = table.columns.map((c, i) => csvEscape(c.label || columnLetter(i))).join(",");
    const bodyRows = rows.map((r) =>
      table.columns.map((c) => {
        const v = r.values[c.id];
        // Computed cells export what the user sees, never "[object Object]"
        // or a source string another program would misread as its own ref.
        const str = (() => {
          if (c.type === "formula" || isFormulaCell(v)) {
            const disp = String(engineHost.display(c.id, r.id) ?? "");
            if (!formatted || disp.startsWith("#") || !FORMATTABLE_TYPES.has(c.type)) return disp;
            const computed = engineHost.value(c.id, r.id);
            if (typeof computed === "number") return formatCellValue(computed, c.type, c.format);
            if (c.type === "date" && typeof computed === "string") return formatCellValue(computed, "date", c.format);
            return disp;
          }
          if (v === undefined || v === null) return "";
          if (formatted && FORMATTABLE_TYPES.has(c.type) && !Array.isArray(v)) return formatCellValue(v, c.type, c.format);
          return Array.isArray(v) ? v.join("; ") : String(v);
        })();
        return csvEscape(str);
      }).join(","),
    );
    const csv = [headers, ...bodyRows].join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${table.name.replace(/[^a-z0-9_-]+/gi, "_").toLowerCase() || "table"}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  // The formula engine host (Tables Phase 3): dependency-graph recalc over
  // the UNSORTED `rows` order — display sort must never change what a ref
  // resolves to, so the host is never handed sorted rows. Rebuilt whenever
  // rows/columns change; every edit flows through setRows, so a fresh host
  // always computes against exactly what the grid renders.
  const engineHost = useMemo(
    () => createTableEngine({ columns: table?.columns ?? [], rows: rows ?? [] }),
    [table?.columns, rows],
  );
  // Undo/redo commands run long after the render that pushed them, so they
  // reach the CURRENT host (rebuilt by the memo above on every state change)
  // through a ref — a closed-over host would rewrite against a dead layout.
  const engineHostRef = useRef(engineHost);
  useEffect(() => { engineHostRef.current = engineHost; });

  // Lookup/rollup compute: follow the column's link → gather linked rows →
  // pull a field (lookup) or aggregate it (rollup). Returns a display value.
  const relationalValue = useCallback((col: Column, row: ApiRow): string | number => {
    const cols = table?.columns ?? [];
    const linkCol = cols.find((c) => c.id === col.linkColumnId);
    if (!linkCol || linkCol.type !== "link" || !linkCol.linkTableId) return "";
    const lt = linkedTables[linkCol.linkTableId];
    if (!lt) return "…";
    const ids = Array.isArray(row.values[linkCol.id]) ? (row.values[linkCol.id] as string[]) : [];
    const linkedRows = ids.map((id) => lt.rows.find((r) => r.id === id)).filter((r): r is ApiRow => !!r);
    const fmt = (v: unknown) => (v == null || v === "" ? "" : String(v));
    if (col.type === "lookup") {
      if (!col.lookupColumnId) return "";
      return linkedRows.map((r) => fmt(r.values[col.lookupColumnId!])).filter(Boolean).join(", ");
    }
    // rollup
    if (col.rollupFn === "COUNT") return linkedRows.length;
    const targetVals = linkedRows.map((r) => r.values[col.rollupColumnId ?? ""]);
    if (col.rollupFn === "CONCAT") return targetVals.map(fmt).filter(Boolean).join(", ");
    const nums = targetVals.map((v) => (typeof v === "number" ? v : parseFloat(String(v)))).filter((n) => Number.isFinite(n));
    switch (col.rollupFn) {
      case "SUM": return nums.reduce((a, b) => a + b, 0);
      case "AVG": return nums.length ? Math.round((nums.reduce((a, b) => a + b, 0) / nums.length) * 1e6) / 1e6 : 0;
      case "MIN": return nums.length ? Math.min(...nums) : 0;
      case "MAX": return nums.length ? Math.max(...nums) : 0;
      default: return linkedRows.length;
    }
  }, [table?.columns, linkedTables]);

  // target-table-id → its columns (for the relation config modal's field pickers).
  const columnsByTable = useMemo(() => {
    const out: Record<string, { id: string; label: string; type: string }[]> = {};
    for (const [id, lt] of Object.entries(linkedTables)) out[id] = lt.columns.map((c) => ({ id: c.id, label: c.label, type: c.type }));
    return out;
  }, [linkedTables]);

  const configColumn = configColId ? (table?.columns ?? []).find((c) => c.id === configColId) ?? null : null;

  // ── Sheet kernel derived state ──────────────────────────────────
  // Hooks, so they can sit above the early returns AND feed the active-cell
  // refs the formula bar's DOM observer reads between renders.
  const rowById = useMemo(() => new Map((rows ?? []).map((r) => [r.id, r] as const)), [rows]);

  const filteredRows = useMemo(() => {
    const cols = table?.columns ?? [];
    let list = rows ?? [];
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      list = list.filter((r) =>
        cols.some((c) => {
          const v = r.values[c.id];
          if (v === undefined || v === null) return false;
          // Search matches what the user SEES in a formula cell, not its
          // stored object.
          const text = isFormulaCell(v)
            ? String(engineHost.display(c.id, r.id) ?? "")
            : String(Array.isArray(v) ? v.join(" ") : v);
          return text.toLowerCase().includes(q);
        }),
      );
    }
    if (filterCol && filterValue) {
      list = list.filter((r) => {
        const v = r.values[filterCol];
        if (Array.isArray(v)) return v.includes(filterValue);
        return String(v ?? "") === filterValue;
      });
    }
    return list;
  }, [rows, table?.columns, search, filterCol, filterValue, engineHost]);

  const sortedRows = useMemo(() => {
    if (!sortState) return filteredRows;
    const cols = table?.columns ?? [];
    const col = cols.find((c) => c.id === sortState.colId);
    if (!col) return filteredRows;
    // Sorting reads COMPUTED values but reorders only the display list —
    // formulas keep evaluating against the unsorted `rows` order (the
    // Phase 1 row-anchoring rule).
    const sortValue = (r: ApiRow): unknown => {
      if (col.type === "formula" || isFormulaCell(r.values[col.id])) {
        // Computed value; the host flattens errors to their code strings,
        // which sort as text.
        return engineHost.value(col.id, r.id);
      }
      if (col.type === "lookup" || col.type === "rollup") return relationalValue(col, r);
      return r.values[col.id];
    };
    return [...filteredRows].sort((a, b) => {
      const va = sortValue(a);
      const vb = sortValue(b);
      const ea = va == null || va === "";
      const eb = vb == null || vb === "";
      if (ea !== eb) return ea ? 1 : -1; // empties always last
      const out = compareCells(col.type, va, vb);
      return sortState.dir === "asc" ? out : -out;
    });
  }, [filteredRows, sortState, table?.columns, engineHost, relationalValue]);

  // ── Active-cell tracking for the formula bar ────────────────────
  // The sheet kernel owns selection internally (and this wave does not touch
  // it), so the bar reads the active cell from the DOM the kernel renders:
  // exactly one gridcell carries the active-outline class. A MutationObserver
  // follows it through clicks, keys, and post-paste selection moves. When the
  // active row scrolls out of the virtual window its node unmounts and the
  // last known cell is kept — scrolling away is not deselection.
  const [activeCell, setActiveCell] = useState<{ rowId: string; colId: string } | null>(null);
  const displayRowIdsRef = useRef<string[]>([]);
  const colIdsRef = useRef<string[]>([]);
  useEffect(() => {
    displayRowIdsRef.current = sortedRows.map((r) => r.id);
    colIdsRef.current = (table?.columns ?? []).map((c) => c.id);
  });
  const gridWrapElRef = useRef<HTMLDivElement | null>(null);
  const gridObserverRef = useRef<MutationObserver | null>(null);
  const attachGridWrap = useCallback((el: HTMLDivElement | null) => {
    gridObserverRef.current?.disconnect();
    gridObserverRef.current = null;
    gridWrapElRef.current = el;
    if (!el) return;
    const read = () => {
      const cellEl = el.querySelector('[role="gridcell"][class*="outline"]');
      if (!cellEl) return; // active cell unmounted (scrolled away) — keep the last one
      const r = Number(cellEl.closest('[role="row"]')?.getAttribute("aria-rowindex")) - 1;
      const c = Number(cellEl.getAttribute("aria-colindex")) - 1;
      const rowId = displayRowIdsRef.current[r];
      const colId = colIdsRef.current[c];
      if (!rowId || !colId) return;
      setActiveCell((prev) => (prev && prev.rowId === rowId && prev.colId === colId ? prev : { rowId, colId }));
    };
    const mo = new MutationObserver(read);
    mo.observe(el, { subtree: true, childList: true, attributes: true, attributeFilter: ["class"] });
    gridObserverRef.current = mo;
    read();
  }, []);

  if (loadError) return <div className="frmb__error">Couldn&apos;t load table: {loadError}</div>;
  if (!table || rows === null) return <div className="frmb__loading"><Loader2 className="frmb__spin" /> Loading…</div>;

  const filterColDef = table.columns.find((c) => c.id === filterCol);
  const activeRow = activeRowId ? rows.find((r) => r.id === activeRowId) : null;

  // ── Toolbar plumbing (Sheets chrome) ────────────────────────────

  /** Column ids the kernel's current selection intersects, read from the
   *  DOM the kernel renders (aria-selected on gridcells) — selection state
   *  belongs to the kernel and this page deliberately doesn't mirror it.
   *  Falls back to the active cell's column. Virtualization caveat: only
   *  MOUNTED rows carry aria-selected, but every selection includes the
   *  active row, which is on screen while the user reaches for the toolbar. */
  const selectionColumnIds = (): string[] => {
    const ids = new Set<string>();
    gridWrapElRef.current?.querySelectorAll('[role="gridcell"][aria-selected="true"]').forEach((el) => {
      const c = Number(el.getAttribute("aria-colindex")) - 1;
      const id = table.columns[c]?.id;
      if (id) ids.add(id);
    });
    if (ids.size === 0 && activeCell) ids.add(activeCell.colId);
    return [...ids];
  };

  /** Toolbar currency/percent/123 choices: apply the kind to every column
   *  the selection touches. Formatting is COLUMN-level in v1 (ColumnFormat
   *  rides the columns Json); per-cell format is the known next step. */
  const applyKindToSelection = (kind: NumberFormatKind) => {
    const eligible = selectionColumnIds().filter((id) => {
      const c = table.columns.find((x) => x.id === id);
      return !!c && kindForColType(c.type) !== undefined;
    });
    if (eligible.length === 0) { toast("Select a cell first"); return; }
    applyNumberFormat(eligible, kind);
  };

  /** Toolbar decimal steppers (same column-level v1 scope): only columns
   *  that RENDER numerically can meaningfully step decimals. */
  const stepColumnDecimals = (delta: 1 | -1) => {
    const targets = selectionColumnIds()
      .map((id) => table.columns.find((c) => c.id === id))
      .filter((c): c is Column =>
        !!c && (c.type === "number" || c.type === "currency" || c.type === "percent" || c.format?.style !== undefined));
    if (targets.length === 0) { toast("Select cells in a numeric column first"); return; }
    applyColumnPatches(
      targets.map((c) => ({ colId: c.id, before: { format: c.format }, after: { format: adjustDecimals(c.format, c.type, delta) } })),
      delta > 0 ? "increase decimals" : "decrease decimals",
    );
  };

  /** Σ button: open the active cell's editor seeded with "=SUM(" through
   *  the kernel's own type-to-replace path — a real "=" keydown dispatched
   *  at the grid (the exact mechanism typing uses; React's root listener
   *  routes dispatched events like trusted ones), with sigmaSeedRef
   *  upgrading that one-char seed to "=SUM(" in kernelEditor. The formula
   *  editor opens seeded, caret at the end, autocomplete taking over. */
  const insertSumSeed = () => {
    const gridEl = gridWrapElRef.current?.querySelector<HTMLElement>('[role="grid"]');
    if (!gridEl || !activeCell) { toast("Select a cell first"); return; }
    const col = table.columns.find((c) => c.id === activeCell.colId);
    if (!col || col.type === "formula" || col.type === "lookup" || col.type === "rollup") {
      toast("This cell is computed by its column — pick another cell");
      return;
    }
    sigmaSeedRef.current = "=SUM(";
    gridEl.focus();
    gridEl.dispatchEvent(new KeyboardEvent("keydown", { key: "=", bubbles: true, cancelable: true }));
    // The kernel consumed the seed synchronously (the dispatch re-rendered
    // the editor); anything later must never see a stale Σ seed.
    window.setTimeout(() => { sigmaSeedRef.current = null; }, 0);
  };

  /** Close the nearest details dropdown after a menu item click. */
  const closeDetails = (e: React.MouseEvent<HTMLElement>) => {
    e.currentTarget.closest("details")?.removeAttribute("open");
  };

  // ── Sheet kernel plumbing (Tables Phase 1) ──────────────────────

  const displayCell = (rowId: string, colId: string): React.ReactNode => {
    const r = rowById.get(rowId);
    const c = table.columns.find((x) => x.id === colId);
    if (!r || !c) return null;
    const v = r.values[c.id];
    // Computed first: a formula column, or a per-cell formula stored in ANY
    // column, renders the engine host's display value (a cycle renders its
    // #CYCLE! error here rather than hanging a recalc).
    if (c.type === "formula" || isFormulaCell(v)) {
      const fv = String(engineHost.display(c.id, r.id) ?? "");
      if (fv.startsWith("#")) return <span style={NEGATIVE_RED}>{fv}</span>;
      // A formula cell formats by its COLUMN's format (Phase 4): numbers
      // through formatCellValue, date-typed strings through the date
      // formats. Everything else keeps engine display verbatim — its
      // float-noise trim and TRUE/FALSE are the shipped Phase 3 behaviour.
      if (FORMATTABLE_TYPES.has(c.type)) {
        const computed = engineHost.value(c.id, r.id);
        if (typeof computed === "number") {
          return <span style={isNegativeStyled(computed, c.format) ? NEGATIVE_RED : undefined}>{formatCellValue(computed, c.type, c.format)}</span>;
        }
        if (c.type === "date" && typeof computed === "string") {
          return formatCellValue(computed, "date", c.format);
        }
      }
      return <span>{fv}</span>;
    }
    switch (c.type) {
      case "lookup": case "rollup": { const rv = relationalValue(c, r); return rv == null ? null : String(rv); }
      case "checkbox": return v ? <Check style={{ width: 14, height: 14, color: "#0073EA" }} /> : null;
      case "rating": { const n = typeof v === "number" ? v : 0; return n ? "★".repeat(n) : null; }
      case "number": case "currency": case "percent": {
        if (v == null || v === "") return null;
        const n = typeof v === "number" ? v : Number(String(v).trim());
        const numeric = typeof v === "number" || (String(v).trim() !== "" && Number.isFinite(n));
        // Strings reroute through the formatter only when a format is
        // actually configured: with none, the pre-Phase-4 output stays
        // byte-for-byte ("$abc" and a CSV-imported "$012" included).
        if (!numeric || (typeof v !== "number" && !c.format)) {
          if (c.type === "currency") return `$${v}`;
          if (c.type === "percent") return `${v}%`;
          return String(v);
        }
        return <span style={isNegativeStyled(n, c.format) ? NEGATIVE_RED : undefined}>{formatCellValue(n, c.type, c.format)}</span>;
      }
      case "date": return v == null || v === "" ? null : formatCellValue(v, "date", c.format);
      case "multi_select": return Array.isArray(v) ? (v as string[]).join(", ") : null;
      case "person": {
        const arr = Array.isArray(v) ? (v as string[]) : [];
        return arr.length ? arr.map((id) => userName(orgUsers.find((u) => u.id === id))).join(", ") : null;
      }
      case "link": {
        const lt = c.linkTableId ? linkedTables[c.linkTableId] : undefined;
        const arr = Array.isArray(v) ? (v as string[]) : [];
        return arr.length ? arr.map((id) => rowTitle(lt?.rows.find((x) => x.id === id), lt?.titleColId ?? "")).join(", ") : null;
      }
      case "attachment": { const arr = Array.isArray(v) ? v : []; return arr.length ? `📎 ${arr.length}` : null; }
      default: return v == null || v === "" ? null : String(v);
    }
  };

  /** Conditional-formatting background (Phase 4). Rules read the RAW value
   *  (computed for formula cells) — formatting never feeds back into rules.
   *  The winning colour paints at ~18% alpha (hex "2E"), the same tint depth
   *  as the dept-chip pattern, so black text stays readable on any swatch. */
  const cellBg = (rowId: string, colId: string): React.CSSProperties | undefined => {
    const c = table.columns.find((x) => x.id === colId);
    if (!c?.rules || c.rules.length === 0) return undefined;
    const r = rowById.get(rowId);
    if (!r) return undefined;
    const v = r.values[c.id];
    const raw = c.type === "formula" || isFormulaCell(v) ? engineHost.value(c.id, r.id) : v;
    const bg = matchRule(raw, c.rules);
    if (!bg) return undefined;
    return { background: /^#[0-9a-fA-F]{6}$/.test(bg) ? `${bg}2E` : bg };
  };

  /* ── Clipboard + fill data half (Tables Phase 2) ──────────────
   * The grid supplies geometry (which rowIds, which column indexes); this
   * file supplies and stores the values. */

  /** A cell as clipboard text. Deliberately NOT displayCell: that one
   *  renders "$12" / "20%" / "★★★" for humans and none of those survive a
   *  round trip back through paste. This is the stored value spelled the
   *  way the editors read and write it — bare numbers, ISO dates, and
   *  TRUE/FALSE for a checkbox (the token coercePaste takes back). */
  const cellText = (col: Column, r: ApiRow): string => {
    const v = r.values[col.id];
    // A computed cell copies its DISPLAY value. Copying the SOURCE would be
    // the in-grid ideal, but "=A1+B2" pasted into Excel would resolve against
    // EXCEL's A1 — cross-app source transfer is a later feature, and the
    // display value at least round-trips as the literal the user saw.
    if (col.type === "formula" || isFormulaCell(v)) {
      return String(engineHost.display(col.id, r.id) ?? "");
    }
    switch (col.type) {
      case "lookup": case "rollup": {
        const rv = relationalValue(col, r);
        return rv == null ? "" : String(rv);
      }
      case "checkbox": return v ? "TRUE" : "FALSE";
      case "multi_select": return Array.isArray(v) ? (v as string[]).join(", ") : "";
      case "person": {
        const arr = Array.isArray(v) ? (v as string[]) : [];
        return arr.map((id) => userName(orgUsers.find((u) => u.id === id))).join(", ");
      }
      case "link": {
        const lt = col.linkTableId ? linkedTables[col.linkTableId] : undefined;
        const arr = Array.isArray(v) ? (v as string[]) : [];
        return arr.map((id) => rowTitle(lt?.rows.find((x) => x.id === id), lt?.titleColId ?? "")).join(", ");
      }
      case "attachment": {
        const arr = Array.isArray(v) ? (v as Attachment[]) : [];
        return arr.map((f) => f?.name ?? "").filter(Boolean).join(", ");
      }
      default: return v == null ? "" : Array.isArray(v) ? (v as unknown[]).join(", ") : String(v);
    }
  };

  /** Read a rectangular block for copy/cut/fill. A rowId that no longer
   *  resolves contributes "" so the matrix stays rectangular. */
  const getRangeValues = (cells: { rowId: string; c: number }[][]): string[][] =>
    cells.map((line) => line.map(({ rowId, c }) => {
      const r = rowById.get(rowId);
      const col = table.columns[c];
      return r && col ? cellText(col, r) : "";
    }));

  /** Write a matrix anchored at topLeft, walking DOWN the current display
   *  order (sortedRows) — the grid may be sorted or filtered, and Phase 1
   *  keys everything by rowId for exactly this reason.
   *
   *  Column mapping: matrix column k targets display column topLeft.c + k
   *  INCLUDING read-only ones, so the pasted block keeps its shape; the
   *  read-only ones simply emit no write. Columns past the last one are
   *  clipped — a paste never creates columns. Rows past the last one are
   *  appended, which is what Sheets does.
   *
   *  Optimistic in-place for existing rows; appended rows are added only
   *  from what the server actually created, never from guessed ids. Any
   *  failed chunk stops the run, tells the user, and reloads, so the grid
   *  can't keep showing a write that didn't land. */
  const applyMatrix = async (topLeft: { rowId: string; c: number }, matrix: string[][]) => {
    if (!tableId || matrix.length === 0) return;
    const cols = table.columns;
    const anchorIdx = sortedRows.findIndex((r) => r.id === topLeft.rowId);
    if (anchorIdx < 0) return; // anchor fell out of the filtered set mid-gesture

    const updatesByRow = new Map<string, Record<string, unknown>>();
    const inserts: { values: Record<string, unknown> }[] = [];
    let skipped = 0;    // left untouched: read-only, unmatched choice, unreadable value

    for (let j = 0; j < matrix.length; j++) {
      const line = matrix[j];
      const target = sortedRows[anchorIdx + j] as ApiRow | undefined; // undefined ⇒ past the last row
      const values: Record<string, unknown> = {};
      for (let k = 0; k < line.length; k++) {
        const c = topLeft.c + k;
        if (c < 0) continue;         // defensive: the geometry comes from the grid
        if (c >= cols.length) break; // clipped
        const col = cols[c];
        const raw = line[k] ?? "";
        const res = coercePaste(col, raw);
        if (res.kind === "skip") {
          // Blank onto blank changed nothing, so it isn't worth reporting.
          if (raw.trim() !== "" || !isEmptyCell(target?.values[col.id])) skipped++;
          continue;
        }
        values[col.id] = res.value;
      }
      if (target) {
        if (Object.keys(values).length > 0) {
          updatesByRow.set(target.id, { ...(updatesByRow.get(target.id) ?? {}), ...values });
        }
      } else {
        // A brand-new row has nothing to clear, so nulls are dropped.
        inserts.push({ values: Object.fromEntries(Object.entries(values).filter(([, v]) => v !== null)) });
      }
    }

    const updates = [...updatesByRow].map(([id, values]) => ({ id, values }));
    const realInserts = inserts.some((i) => Object.keys(i.values).length > 0) ? inserts : [];
    const written =
      updates.reduce((n, u) => n + Object.keys(u.values).length, 0) +
      realInserts.reduce((n, i) => n + Object.keys(i.values).length, 0);

    // Everything landed on read-only or unmatched cells: say so, write nothing,
    // and don't append blank rows to carry a paste that has no payload.
    if (updates.length === 0 && realInserts.length === 0) {
      if (skipped > 0) toast(`Nothing pasted · ${skipped} cell${skipped === 1 ? "" : "s"} skipped (read-only or unmatched value)`);
      return;
    }

    // Undo capture, BEFORE the optimistic update: the exact values every
    // targeted cell held (paste-overwrite is plan 3a's other named
    // unrecoverable, alongside bulk delete).
    const befores = updates.map((u) => ({
      id: u.id,
      values: Object.fromEntries(Object.keys(u.values).map((k) => [k, rowById.get(u.id)?.values[k] ?? null])),
    }));
    const createdRows: ApiRow[] = [];

    if (updates.length > 0) {
      setRows((prev) => prev ? prev.map((r) => {
        const patch = updatesByRow.get(r.id);
        return patch ? { ...r, values: { ...r.values, ...patch } } : r;
      }) : prev);
    }

    try {
      // Sequential slices at the server's per-kind cap, exactly like
      // clearCells/bulkDeleteRows: a failure part-way stops the rest and the
      // reload below reconciles whatever did commit.
      // The route commits updates + inserts in ONE transaction, so when the
      // whole paste fits in a single call, send both keys together and keep
      // that guarantee. Only an oversized paste has to be split, and then
      // the reload below reconciles whatever committed.
      const oneShot = updates.length <= BATCH_MAX_OPS && realInserts.length <= BATCH_MAX_OPS;
      for (let i = 0; !oneShot && i < updates.length; i += BATCH_MAX_OPS) {
        const res = await fetch(`/api/tables/${tableId}/rows/batch`, {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ updates: updates.slice(i, i + BATCH_MAX_OPS) }),
        });
        if (!res.ok) throw new Error();
      }
      if (oneShot && (updates.length > 0 || realInserts.length > 0)) {
        const res = await fetch(`/api/tables/${tableId}/rows/batch`, {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            ...(updates.length > 0 ? { updates } : {}),
            ...(realInserts.length > 0 ? { inserts: realInserts } : {}),
          }),
        });
        if (!res.ok) throw new Error();
        const d = await res.json();
        const payload = d?.data ?? d;
        const created: ApiRow[] = (Array.isArray(payload?.inserted) ? payload.inserted : [])
          .map((r: { id: string; values: unknown; position: number }) => ({
            id: r.id,
            values: (r.values ?? {}) as Record<string, unknown>,
            position: r.position,
          }));
        createdRows.push(...created);
        if (created.length > 0) setRows((prev) => prev ? [...prev, ...created] : prev);
      }
      for (let i = 0; !oneShot && i < realInserts.length; i += BATCH_MAX_OPS) {
        const res = await fetch(`/api/tables/${tableId}/rows/batch`, {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ inserts: realInserts.slice(i, i + BATCH_MAX_OPS) }),
        });
        if (!res.ok) throw new Error();
        // The route returns the rows it created, in payload order. Take the
        // ids from there — a guessed id would break every rowId-keyed thing
        // in the kernel the moment the real row arrived.
        const d = await res.json();
        const payload = d?.data ?? d;
        const created: ApiRow[] = (Array.isArray(payload?.inserted) ? payload.inserted : [])
          .map((r: { id: string; values: unknown; position: number }) => ({
            id: r.id,
            values: (r.values ?? {}) as Record<string, unknown>,
            position: r.position,
          }));
        createdRows.push(...created);
        if (created.length > 0) setRows((prev) => prev ? [...prev, ...created] : prev);
      }
    } catch {
      toast("Couldn't paste — reloading the table");
      void load();
      // Rethrow: the grid's runApply catches this and returns false, so it
      // won't move the selection as though the write had landed.
      throw new Error("batch write failed");
    }

    // Reached only when every chunk landed (the catch above rethrows), so
    // the command records an action that fully happened. Undo restores the
    // exact befores AND removes appended rows; redo replays the afters and
    // re-appends (accepting the new server ids it gets back).
    {
      const afters = updates;
      const insertPayloads = realInserts;
      let createdIds = createdRows.map((r) => r.id);
      let redoCreated: string[] = [];
      pushUndo({
        label: `paste/fill (${written} cell${written === 1 ? "" : "s"})`,
        undo: async () => {
          // Delete-then-restore order: if this dies between the two, a
          // retry's deletes are idempotent (the route tolerates stale ids).
          if (createdIds.length > 0) await deleteRowsBatchStrict(createdIds);
          if (befores.length > 0) await writeValuesBatchStrict(befores);
        },
        redo: async () => {
          if (afters.length > 0) await writeValuesBatchStrict(afters);
          if (insertPayloads.length > 0) {
            if (redoCreated.length > 0) {
              // A previous redo attempt died mid-insert: clear its partial
              // append before re-inserting, or rows would duplicate.
              await deleteRowsBatchStrict(redoCreated);
              redoCreated = [];
            }
            const created = await insertRowsBatchStrict(insertPayloads, (ids) => redoCreated.push(...ids));
            createdIds = created.map((r) => r.id);
          }
        },
      });
    }

    const notes: string[] = [];
    if (skipped > 0) notes.push(`${skipped} skipped (read-only or unmatched value)`);
    if (notes.length > 0) toast(`Pasted ${written} cell${written === 1 ? "" : "s"} · ${notes.join(" · ")}`);
  };

  /** Excel-style header (Excel-ify decision 2): the column LETTER is the
   *  primary text and the drag-reorder handle; the optional label renders
   *  as a small second line whose input doubles as the rename affordance.
   *  Being an <input>, it keeps the kernel's EDITABLE_SEL protection —
   *  keystrokes in it never reach the grid's shortcuts. */
  const kernelHeader = (colId: string) => {
    const c = table.columns.find((x) => x.id === colId);
    if (!c) return null;
    const colIndex = table.columns.findIndex((x) => x.id === colId);
    return (
      <div
        className="dtbl__col-head"
        style={{ position: "relative", flexDirection: "column", alignItems: "stretch", justifyContent: "center", gap: 0, padding: "1px 2px", opacity: dragColId === c.id ? 0.5 : 1 }}
        onDragOver={(e) => { if (dragColId) e.preventDefault(); }}
        onDrop={(e) => { e.preventDefault(); if (dragColId) moveColumn(dragColId, c.id); setDragColId(null); }}
      >
        <span
          title={`Column ${columnLetter(colIndex)} · drag to reorder`}
          draggable
          onDragStart={() => setDragColId(c.id)}
          onDragEnd={() => setDragColId(null)}
          style={{ cursor: "grab", textAlign: "center", fontWeight: 600, fontSize: 12.5, lineHeight: "14px", color: "#3f3f46" }}
        >{columnLetter(colIndex)}</span>
        <input
          type="text"
          value={c.label}
          aria-label={`Label for column ${columnLetter(colIndex)}`}
          onChange={(e) => setTable({ ...table, columns: table.columns.map((x) => x.id === c.id ? { ...x, label: e.target.value } : x) })}
          // Empty is a legal label — columns are anonymous like Excel's.
          onBlur={(e) => renameColumn(c.id, e.target.value.trim())}
          style={{ flex: "none", width: "100%", height: 13, padding: 0, textAlign: "center", fontSize: 10.5, lineHeight: "13px", fontWeight: 400, color: "#71717a" }}
        />
        <span
          // Visible on header hover only (the kernel's columnheader is the
          // group/head Tailwind group); the light backdrop keeps the icons
          // legible over the centered label text they overlap.
          className="opacity-0 group-hover/head:opacity-100"
          style={{ position: "absolute", right: 0, top: "50%", transform: "translateY(-50%)", display: "inline-flex", alignItems: "center", background: "rgba(250,250,250,0.92)", borderRadius: 4 }}
        >
          {c.type === "formula" ? (
            <button type="button" className="dtbl__col-del" style={{ opacity: 1 }} onClick={() => editFormula(c.id)} title={`Edit formula (${c.formula || "none"})`}><Sigma /></button>
          ) : null}
          {c.type === "link" || c.type === "lookup" || c.type === "rollup" ? (
            <button type="button" className="dtbl__col-del" style={{ opacity: 1 }} onClick={() => setConfigColId(c.id)} title="Configure relation"><Link2 /></button>
          ) : null}
          <button
            type="button"
            className="dtbl__col-del"
            style={{ opacity: 1 }}
            // Stop the mousedown reaching the menu's outside-click closer,
            // or "toggle closed" would close-then-reopen in one click.
            onMouseDown={(e) => e.stopPropagation()}
            onClick={() => setFormatMenuColId((cur) => (cur === c.id ? null : c.id))}
            title="Column type, format & highlight rules"
          ><MoreHorizontal /></button>
          <button type="button" className="dtbl__col-del" style={{ opacity: 1 }} onClick={() => deleteColumn(c.id)} title="Delete column"><Trash2 /></button>
        </span>
        {formatMenuColId === c.id ? (
          // Absolute inside this position:relative header cell — the sticky
          // header is a transformed/sticky container, so fixed would drift.
          <ColumnFormatMenu
            colType={c.type}
            format={c.format}
            rules={c.rules}
            // ONE call per 123 choice: type + starter format land in a
            // single write, so a single undo restores both (the menu's
            // deprecated onTypeChange fallback is not used here).
            onNumberFormat={(kind) => applyNumberFormat([c.id], kind)}
            onFormatChange={(f) => setColumnFormat(c.id, f)}
            onRulesChange={(r) => setColumnRules(c.id, r)}
            onClose={() => setFormatMenuColId(null)}
          />
        ) : null}
        <span
          onMouseDown={(e) => startResize(e, c.id)}
          title="Drag to resize"
          style={{ position: "absolute", right: -6, top: 0, bottom: 0, width: 8, cursor: "col-resize", zIndex: 1 }}
        />
      </div>
    );
  };

  /** One text-commit path for the formula bar, the in-cell formula editor
   *  and any "=" typed into a plain text editor. A formula persists as the
   *  { "=": source } object through the SAME patchRow path as a literal;
   *  the computed value is derived and never persisted. */
  const commitCellText = (rowId: string, colId: string, raw: string) => {
    const col = table.columns.find((c) => c.id === colId);
    if (!col || !rowById.has(rowId)) return;
    if (col.type === "formula" || col.type === "lookup" || col.type === "rollup") {
      // Column-governed cells stay that way this wave: a per-cell formula
      // over a column formula would silently fork the column's meaning.
      toast("This cell is computed by its column — edit the column instead");
      return;
    }
    const trimmed = raw.trim();
    if (trimmed.startsWith("=")) {
      if (trimmed === "=") return; // a lone "=" is an abandoned edit, not a formula
      try {
        // Trimmed, because the host classifies by FIRST character — " =A1"
        // would slip through as a literal.
        const res = engineHost.setCell(colId, rowId, trimmed);
        // res.affected drives re-render only: patchRow's setRows rebuilds the
        // host, which recomputes every dependent. Computed values are never
        // sent to the server. res.previous — the engine's authoritative
        // overwritten value — seeds the undo command (built for this wave).
        void patchRow(rowId, { [colId]: res.stored }, { before: { [colId]: res.previous }, label: "formula edit" });
      } catch {
        toast("Couldn't save formula");
      }
      return;
    }
    // A literal replacing a formula (or typed in the bar) is coerced with the
    // same rules as paste, so the stored shape matches the column type.
    const res = coercePaste(col, raw);
    if (res.kind === "skip") {
      toast("That value doesn't fit this column — nothing saved");
      return;
    }
    void patchRow(rowId, { [colId]: res.value });
  };

  /** Text editors commit through here so "=…" becomes a stored formula even
   *  when the editor was opened plain (F2 first, "=" typed after) — the
   *  seed path below only catches type-to-replace. */
  const commitEditorValue = (rowId: string, colId: string, v: unknown) => {
    if (typeof v === "string" && v.trimStart().startsWith("=")) {
      commitCellText(rowId, colId, v);
      return;
    }
    void patchRow(rowId, { [colId]: v });
  };

  const kernelEditor = (rowId: string, colId: string, opts: { seed: string | null; commit: () => void }) => {
    const r = rowById.get(rowId);
    const c = table.columns.find((x) => x.id === colId);
    if (!r || !c) return null;
    // A formula cell always edits as its SOURCE (never the computed value —
    // the user must see what their edit replaces), and a "=" seed opens the
    // formula editor in ANY editable cell: number/date/choice editors cannot
    // even type "=", so the formula editor takes over for them.
    const hasFormula = engineHost.isFormulaCell(colId, rowId);
    const formulaSeed = opts.seed != null && opts.seed.trimStart().startsWith("=");
    if (hasFormula || formulaSeed) {
      // cellSource returns "=SRC" (with the "=") for any computed cell. ANY
      // seed wins over the source — type-to-replace on a formula cell starts
      // from what was typed, exactly like the plain editors — while the
      // commit baseline stays the ORIGINAL source, so a seeded value that is
      // left as-is still commits (and Escape still cancels via the ref).
      const src = hasFormula ? String(engineHost.cellSource(colId, rowId) ?? "=") : "";
      // The toolbar's Σ rides the kernel's own type-to-replace: it
      // dispatched the "=" keydown that opened this editor, and the ref
      // upgrades that one-char seed to "=SUM(". The upgrade is snapshotted
      // per cell so every re-render of this session passes the SAME seed —
      // see sigmaSessionRef for why it must never flap back to "=".
      if (formulaSeed && sigmaSeedRef.current) sigmaSessionRef.current = { rowId, colId, seed: sigmaSeedRef.current };
      const sigma = sigmaSessionRef.current;
      const seed = formulaSeed && sigma && sigma.rowId === rowId && sigma.colId === colId ? sigma.seed : opts.seed;
      return (
        <SheetEditorHost seed={seed} commit={() => { sigmaSessionRef.current = null; opts.commit(); }}>
          <SheetFormulaEditor
            initial={seed ?? src}
            baseline={src}
            onCommit={(raw) => commitCellText(rowId, colId, raw)}
          />
        </SheetEditorHost>
      );
    }
    const inner = c.type === "link" ? (
      <LinkCell value={r.values[c.id]} linked={c.linkTableId ? linkedTables[c.linkTableId] : undefined} onChange={(v) => void patchRow(r.id, { [c.id]: v })} />
    ) : c.type === "attachment" ? (
      <AttachmentCell value={r.values[c.id]} onChange={(v) => void patchRow(r.id, { [c.id]: v })} />
    ) : c.type === "person" ? (
      <PersonCell value={r.values[c.id]} users={orgUsers} onChange={(v) => void patchRow(r.id, { [c.id]: v })} />
    ) : (
      <CellEditor column={c} value={r.values[c.id]} onChange={(v) => commitEditorValue(r.id, c.id, v)} />
    );
    return <SheetEditorHost seed={opts.seed} commit={opts.commit}>{inner}</SheetEditorHost>;
  };

  // ── Formula bar plumbing (Tables Phase 3) ───────────────────────
  const activeColDef = activeCell ? table.columns.find((c) => c.id === activeCell.colId) : undefined;
  const activeCellRow = activeCell ? rowById.get(activeCell.rowId) : undefined;
  let barCell: FormulaBarCell | null = null;
  if (activeCell && activeColDef && activeCellRow) {
    const colIndex = table.columns.findIndex((c) => c.id === activeCell.colId);
    // The address row number is the UNSORTED index — the row an A1 ref in a
    // formula would actually resolve to — not the display-sorted position.
    const rowNumber = rows.findIndex((r) => r.id === activeCell.rowId) + 1;
    if (colIndex >= 0 && rowNumber > 0) {
      const computedCol = activeColDef.type === "lookup" || activeColDef.type === "rollup";
      const pickerCol = activeColDef.type === "link" || activeColDef.type === "person" || activeColDef.type === "attachment";
      // cellSource returns "=SRC" for any computed cell (a column-formula
      // fill included, which is what the bar shows read-only for a formula
      // column); for literals the bar edits the text the editors write.
      const src = engineHost.isFormulaCell(activeCell.colId, activeCell.rowId)
        ? String(engineHost.cellSource(activeCell.colId, activeCell.rowId) ?? "=")
        : null;
      barCell = {
        address: `${columnLetter(colIndex)}${rowNumber}`,
        source: src ?? cellText(activeColDef, activeCellRow),
        readOnly: activeColDef.type === "formula" || computedCol || pickerCol,
        readOnlyReason: activeColDef.type === "formula"
          ? "This column computes its formula — edit it from the column header (Σ)"
          : computedCol
            ? "Computed column — configure it from the column header"
            : "This column edits through its picker in the grid",
      };
    }
  }

  return (
    <div className="dtbl">
      {/* ── Title row: small inline-editable name, Sheets-style ── */}
      <header className="shx__titlebar">
        <button type="button" className="frmb__back shx__np" onClick={() => router.push("/tables")} aria-label="Back"><ArrowLeft /></button>
        <TableIcon className="shx__title-icon" aria-hidden />
        <input
          className="shx__title-input"
          type="text"
          value={table.name}
          onChange={(e) => setTable({ ...table, name: e.target.value })}
          onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
          onFocus={(e) => { titleBeforeEditRef.current = e.target.value; }}
          onBlur={(e) => {
            const name = e.target.value.trim() || UNTITLED_SHEET_NAME;
            if (name !== e.target.value) setTable((prev) => (prev ? { ...prev, name } : prev));
            // An untouched focus/blur must cost nothing: no PATCH, and no
            // global notify (each fires a refetch in every mounted sidebar
            // and the tab bar).
            if (name === titleBeforeEditRef.current) return;
            // Sidebar + the bottom sheet tabs both list this name — tell them.
            void patchTable({ name }).then((ok) => { if (ok) notifyTablesChanged(); });
          }}
          placeholder={UNTITLED_SHEET_NAME}
          aria-label="Spreadsheet name"
        />
        {savingCols && <em className="shx__saving">saving…</em>}
        <span className="shx__title-actions shx__np">
          {tableId ? <TableFavoriteButton tableId={tableId} /> : null}
          <button
            type="button"
            className={`dtbl__head-btn ${table.isPublic ? "is-on" : ""}`}
            onClick={() => { const next = !table.isPublic; setTable({ ...table, isPublic: next }); void patchTable({ isPublic: next }); }}
            title={table.isPublic ? "Public — anyone with the link can view" : "Private — toggle to share publicly"}
          >
            {table.isPublic ? <Globe /> : <Lock />}
          </button>
          {table.isPublic && (
            <button
              type="button"
              className="dtbl__head-btn"
              onClick={() => {
                const url = `${window.location.origin}/embed/tables/${tableId}`;
                const snippet = `<iframe src="${url}" width="100%" height="500" frameborder="0" style="border:1px solid #e5e7eb;border-radius:8px"></iframe>`;
                navigator.clipboard.writeText(snippet).then(() => toast("Embed snippet copied"));
              }}
              title="Copy public embed snippet"
            >
              <LinkIcon />
            </button>
          )}
        </span>
      </header>

      {/* ── The one dense toolbar. Honesty rule: every control here works
          today — no font/bold/color buttons, because per-cell styling
          does not exist yet on this surface. ── */}
      <div className="shx__toolbar shx__np" role="toolbar" aria-label="Sheet toolbar">
        <button
          type="button"
          className="shx__tb-btn"
          onClick={() => void runUndo()}
          disabled={!undoStack.canUndo() || undoStack.busy()}
          title={undoStack.canUndo() ? `Undo ${undoStack.peekUndoLabel()}` : "Nothing to undo"}
          aria-label="Undo"
        ><Undo2 /></button>
        <button
          type="button"
          className="shx__tb-btn"
          onClick={() => void runRedo()}
          disabled={!undoStack.canRedo() || undoStack.busy()}
          title={undoStack.canRedo() ? `Redo ${undoStack.peekRedoLabel()}` : "Nothing to redo"}
          aria-label="Redo"
        ><Redo2 /></button>
        <button type="button" className="shx__tb-btn" onClick={() => window.print()} title="Print" aria-label="Print"><Printer /></button>
        <select
          className="shx__tb-zoom"
          value={zoom}
          onChange={(e) => changeZoom(Number(e.target.value))}
          title="Zoom"
          aria-label="Zoom"
        >
          {ZOOM_LEVELS.map((z) => <option key={z} value={z}>{z}%</option>)}
        </select>
        <span className="shx__tb-sep" aria-hidden />
        <button type="button" className="shx__tb-btn" onClick={() => applyKindToSelection("currency")} title="Format as currency" aria-label="Format as currency"><DollarSign /></button>
        <button type="button" className="shx__tb-btn" onClick={() => applyKindToSelection("percent")} title="Format as percent" aria-label="Format as percent"><Percent /></button>
        <button type="button" className="shx__tb-btn shx__tb-text" onClick={() => stepColumnDecimals(-1)} title="Decrease decimal places" aria-label="Decrease decimal places">.0</button>
        <button type="button" className="shx__tb-btn shx__tb-text" onClick={() => stepColumnDecimals(1)} title="Increase decimal places" aria-label="Increase decimal places">.00</button>
        <details className="shx__dd">
          <summary className="shx__tb-btn shx__tb-text" title="Number format" aria-label="Number format">123<ChevronDown /></summary>
          <div className="shx__dd-menu">
            {NUMBER_FORMAT_CHOICES.map((t) => (
              <button key={t.kind} type="button" onClick={(e) => { applyKindToSelection(t.kind); closeDetails(e); }}>
                {t.label}
              </button>
            ))}
          </div>
        </details>
        <span className="shx__tb-sep" aria-hidden />
        <button
          type="button"
          className={`shx__tb-btn ${filterOpen || search || filterValue ? "is-on" : ""}`}
          onClick={() => setFilterOpen((o) => !o)}
          title="Search and filter rows"
          aria-label="Toggle search and filter"
        ><Filter /></button>
        <button type="button" className="shx__tb-btn" onClick={insertSumSeed} title="Insert SUM in the active cell" aria-label="Functions"><Sigma /></button>
        <span className="shx__tb-flex" aria-hidden />
        <details className="shx__dd shx__dd--right">
          <summary className="shx__tb-btn shx__tb-text" title="File">File<ChevronDown /></summary>
          <div className="shx__dd-menu">
            <label className="shx__dd-item">
              <Upload /> Import CSV
              <input
                type="file"
                accept=".csv,text/csv"
                style={{ display: "none" }}
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) void importCsv(f);
                  e.target.value = "";
                  e.currentTarget.closest("details")?.removeAttribute("open");
                }}
              />
            </label>
            {/* Export offers formatted vs raw (plan Phase 4: "honest CSV of
                formatted values + a raw-values option"). */}
            <button type="button" onClick={(e) => { exportCsv(true); closeDetails(e); }}><Download /> Export CSV (formatted)</button>
            <button type="button" onClick={(e) => { exportCsv(false); closeDetails(e); }}><Download /> Export CSV (raw values)</button>
          </div>
        </details>
      </div>

      {/* Search + filter row, shown on demand from the toolbar's funnel. */}
      {filterOpen && (
        <nav className="dtbl__viewtabs shx__np">
          <div className="dtbl__filterbar">
            <div className="dtbl__searchwrap">
              <Search />
              <input type="search" placeholder="Search rows…" value={search} onChange={(e) => setSearch(e.target.value)} />
            </div>
            <div className="dtbl__filterwrap">
              <Filter />
              <select value={filterCol} onChange={(e) => { setFilterCol(e.target.value); setFilterValue(""); }}>
                <option value="">No filter</option>
                {table.columns.filter((c) => c.type === "select" || c.type === "multi_select").map((c) => (
                  <option key={c.id} value={c.id}>{c.label}</option>
                ))}
              </select>
              {filterColDef && (
                <select value={filterValue} onChange={(e) => setFilterValue(e.target.value)}>
                  <option value="">Any value</option>
                  {(filterColDef.options ?? []).map((o) => <option key={o} value={o}>{o}</option>)}
                </select>
              )}
            </div>
            {(search || filterValue) && (
              <span className="dtbl__filterhint">{filteredRows.length} of {rows.length}</span>
            )}
          </div>
        </nav>
      )}

      {table.columns.length === 0 ? (
        /* A columnless table must still open as a spreadsheet, never a
           card: one click applies the standard 26×100 blank-sheet seed. */
        <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center" }}>
          <button type="button" className="dtbl__addrow" onClick={() => void startSheet()}><Plus /> Start sheet</button>
        </div>
      ) : (
        <div className="shx__sheet">
          {/* fx bar: address box, fx glyph, formula input (formula-bar.tsx). */}
          <div className="shx__fx shx__np">
          <FormulaBar
            cell={barCell}
            onCommit={(raw) => {
              if (!activeCell) return;
              commitCellText(activeCell.rowId, activeCell.colId, raw);
              // Hand the keyboard back to the grid, so Enter-commit flows
              // straight into navigation like an in-cell commit does.
              gridWrapElRef.current?.querySelector<HTMLElement>('[role="grid"]')?.focus();
            }}
            onReadOnlyEdit={(reason) => toast(reason)}
          />
          </div>
          {/* CSS zoom, not transform: zoom reflows layout, so the kernel's
              virtualizer math (row offsets, viewport height) stays true. */}
          <div ref={attachGridWrap} className="shx__grid" style={{ zoom: zoom / 100 }}>
          <SheetGrid
            columns={table.columns.map((c) => ({ id: c.id, label: c.label, width: c.width }))}
            rowIds={sortedRows.map((r) => r.id)}
            renderDisplay={displayCell}
            renderEditor={kernelEditor}
            onClearCells={(cells) => void clearCells(cells)}
            getRangeValues={getRangeValues}
            applyMatrix={applyMatrix}
            onUndo={() => void runUndo()}
            onRedo={() => void runRedo()}
            cellStyle={cellBg}
            onDeleteRows={(ids) => void bulkDeleteRows(ids)}
            onOpenRow={(id) => setActiveRowId(id)}
            onRowContextMenu={(rowId, x, y) => setRowMenu({ rowId, x, y })}
            sort={sortState}
            onSortChange={(sn) => persistSort(sn)}
            renderHeader={kernelHeader}
            headerTrailing={
              <button
                type="button"
                onClick={() => void addColumn()}
                title="Add column"
                className="inline-flex h-6 w-6 items-center justify-center rounded text-zinc-400 hover:bg-zinc-100 hover:text-zinc-600"
              >
                <Plus style={{ width: 15, height: 15 }} />
              </button>
            }
            footer={<button type="button" className="dtbl__addrow" onClick={addRow}><Plus /> New row</button>}
            readOnlyCols={new Set(table.columns.filter((c) => c.type === "formula" || c.type === "lookup" || c.type === "rollup").map((c) => c.id))}
          />
          </div>
        </div>
      )}

      <SheetTabsBar
        currentId={tableId}
        currentName={table.name}
        meta={`${rows.length} row${rows.length === 1 ? "" : "s"} · ${table.columns.length} col${table.columns.length === 1 ? "" : "s"}`}
      />

      {rowMenu ? (
        <MorePortal
          anchorRef={rowMenuAnchorRef}
          panelRef={rowMenuPanelRef}
          width={180}
          open
          placement="below"
          point={{ x: rowMenu.x, y: rowMenu.y }}
        >
          <MenuList className="min-w-[180px]">
            <MenuItem
              icon={ChevronRight}
              label="Open row"
              onClick={() => { setActiveRowId(rowMenu.rowId); setRowMenu(null); }}
            />
            <MenuItem
              icon={Trash2}
              label="Delete row"
              destructive
              onClick={() => { setRowMenu(null); void deleteRow(rowMenu.rowId); }}
            />
          </MenuList>
        </MorePortal>
      ) : null}

      {activeRow && (
        <RowDetailModal
          table={table}
          row={activeRow}
          onClose={() => setActiveRowId(null)}
          onChange={(values) => {
            // "=…" typed into a modal field becomes a stored formula through
            // the same path as the grid; everything else stays a literal.
            const literals: Record<string, unknown> = {};
            for (const [k, v] of Object.entries(values)) {
              if (typeof v === "string" && v.trimStart().startsWith("=")) commitCellText(activeRow.id, k, v);
              else literals[k] = v;
            }
            if (Object.keys(literals).length > 0) void patchRow(activeRow.id, literals);
          }}
          formulaDisplay={(colId) => String(engineHost.display(colId, activeRow.id) ?? "")}
          onDelete={() => { void deleteRow(activeRow.id); setActiveRowId(null); }}
        />
      )}

      {configColumn && (
        <RelationConfigModal
          column={configColumn}
          tableColumns={table.columns}
          allTables={allTables.filter((t) => t.id !== tableId)}
          columnsByTable={columnsByTable}
          onSave={(patch) => saveColumnConfig(configColumn.id, patch as Partial<Column>)}
          onClose={() => setConfigColId(null)}
        />
      )}
    </div>
  );
}

/** Sheets-style bottom tab bar: every sheet in the org as a tab — the same
 *  GET /api/tables the worksheet sidebar reads, kept fresh through the same
 *  tables-changed and sidebar-refresh events — with the current sheet
 *  highlighted and a promptless "+" that creates an Untitled spreadsheet
 *  (auto-suffixed against the fetched names) and navigates straight into
 *  it. Horizontal scroll on overflow; the row/column meta that used to sit
 *  in the old header lives at the bar's right end. */
function SheetTabsBar({ currentId, currentName, meta }: { currentId: string | null; currentName: string; meta: string }) {
  const router = useRouter();
  const { toast } = useOsToast();
  const { bumpRowVersion } = useOsShell();
  const [sheets, setSheets] = useState<{ id: string; name: string }[] | null>(null);
  const [creating, setCreating] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/tables", { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const d = await res.json();
      // jsonSuccess historically wrapped in {data}; accept both shapes like
      // the sidebar and list page do.
      const list = (d.data ?? (Array.isArray(d) ? d : [])) as { id: string; name: string }[];
      setSheets(list.map((t) => ({ id: t.id, name: t.name })));
    } catch {
      // Keep whatever tabs are already showing; an empty bar helps nobody.
      setSheets((prev) => prev ?? []);
    }
  }, []);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    const onChange = () => { void load(); };
    window.addEventListener("workwrk:tables-changed", onChange);
    const offRefresh = onSidebarRefresh(onChange);
    return () => {
      window.removeEventListener("workwrk:tables-changed", onChange);
      offRefresh();
    };
  }, [load]);

  // The current sheet always shows, and with the freshest LOCAL name — a
  // rename mid-edit must not wait for the refetch, and a just-created sheet
  // must not be missing from its own tab bar.
  const tabs = useMemo(() => {
    const list = (sheets ?? []).map((s) => (s.id === currentId ? { ...s, name: currentName } : s));
    if (currentId && !list.some((s) => s.id === currentId)) list.unshift({ id: currentId, name: currentName });
    return list;
  }, [sheets, currentId, currentName]);

  const addSheet = async () => {
    if (creating) return; // double-click guard: one "+" press, one sheet
    setCreating(true);
    try {
      const t = await createUntitledSheet((sheets ?? []).map((s) => s.name || ""));
      notifyTablesChanged();
      bumpRowVersion("tables");
      router.push(`/tables/${t.id}`);
    } catch {
      toast("Couldn't create sheet");
    } finally {
      setCreating(false);
    }
  };

  return (
    <footer className="shx__tabbar shx__np">
      <button type="button" className="shx__tab-add" onClick={() => void addSheet()} disabled={creating} title="New sheet" aria-label="New sheet">
        {creating ? <Loader2 className="frmb__spin" /> : <Plus />}
      </button>
      <div className="shx__tabs">
        {tabs.map((s) => (
          <button
            key={s.id}
            type="button"
            className={`shx__tab ${s.id === currentId ? "is-active" : ""}`}
            onClick={() => { if (s.id !== currentId) router.push(`/tables/${s.id}`); }}
            title={s.name || UNTITLED_SHEET_NAME}
          >
            {s.name || UNTITLED_SHEET_NAME}
          </button>
        ))}
      </div>
      <span className="shx__tabbar-meta">{meta}</span>
    </footer>
  );
}

function RowDetailModal({ table, row, onClose, onChange, formulaDisplay, onDelete }: {
  table: ApiTable; row: ApiRow;
  onClose: () => void;
  onChange: (values: Record<string, unknown>) => void;
  /** Computed display for a per-cell formula (the modal has no engine). */
  formulaDisplay?: (colId: string) => string;
  onDelete: () => void;
}) {
  const titleCol = table.columns.find((c) => c.type === "short_text") ?? table.columns[0];
  const title = titleCol
    ? (isFormulaCell(row.values[titleCol.id]) ? (formulaDisplay?.(titleCol.id) || rowTitle(row, titleCol.id)) : String(row.values[titleCol.id] ?? "Untitled"))
    : "Untitled";

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="dtbl__modal-back" onClick={onClose}>
      <aside className="dtbl__modal" onClick={(e) => e.stopPropagation()}>
        <header>
          <h2>{title}</h2>
          <div>
            <button type="button" onClick={onDelete} className="dtbl__modal-del" title="Delete row"><Trash2 /></button>
            <button type="button" onClick={onClose}>×</button>
          </div>
        </header>
        <div className="dtbl__modal-body">
          {table.columns.map((c, ci) => (
            <div key={c.id} className="dtbl__modal-field">
              <label>{c.label || columnLetter(ci)}</label>
              {isFormulaCell(row.values[c.id]) ? (
                // The literal editor would show "[object Object]" and a blur
                // would overwrite the formula with it — display-only here;
                // the formula edits in the grid or the formula bar.
                <FormulaCell value={formulaDisplay?.(c.id) ?? ""} />
              ) : (
                <CellEditor column={c} value={row.values[c.id]} onChange={(v) => onChange({ [c.id]: v })} />
              )}
            </div>
          ))}
        </div>
      </aside>
    </div>
  );
}

function LinkCell({ value, linked, onChange }: { value: unknown; linked: LinkedTable | undefined; onChange: (v: string[]) => void }) {
  const ids = Array.isArray(value) ? (value as string[]) : [];
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  if (!linked) {
    return <span className="dtbl__input" style={{ display: "inline-block", opacity: 0.5 }}>{ids.length ? `${ids.length} linked` : "Set target →"}</span>;
  }
  const chosen = ids.map((id) => linked.rows.find((r) => r.id === id)).filter((r): r is ApiRow => !!r);
  const candidates = q.trim()
    ? linked.rows.filter((r) => rowTitle(r, linked.titleColId).toLowerCase().includes(q.trim().toLowerCase()))
    : linked.rows;
  const toggle = (id: string) => onChange(ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]);
  return (
    <span style={{ position: "relative", display: "inline-flex", flexWrap: "wrap", gap: 4, alignItems: "center" }}>
      {chosen.map((r) => (
        <span key={r.id} style={{ display: "inline-flex", alignItems: "center", gap: 3, background: "#E6F1FB", color: "#0073EA", borderRadius: 4, padding: "1px 6px", fontSize: 11, fontWeight: 500 }}>
          {rowTitle(r, linked.titleColId)}
          <button type="button" onClick={() => toggle(r.id)} style={{ background: "none", border: 0, cursor: "pointer", color: "#0073EA", lineHeight: 0, padding: 0 }}>×</button>
        </span>
      ))}
      <button type="button" onClick={() => setOpen((o) => !o)} style={{ background: "none", border: "1px dashed #A8CDF5", borderRadius: 4, color: "#0073EA", cursor: "pointer", fontSize: 11, padding: "1px 6px" }}>+ link</button>
      {open ? (
        <div style={{ position: "absolute", top: "100%", left: 0, marginTop: 4, zIndex: 20, minWidth: 240, maxHeight: 280, overflowY: "auto", background: "white", border: "1px solid #e4e4e7", borderRadius: 8, boxShadow: "0 8px 24px rgba(0,0,0,0.12)", padding: 4 }} onMouseLeave={() => setOpen(false)}>
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={`Search ${linked.name}…`} autoFocus style={{ width: "100%", height: 28, padding: "0 8px", border: "1px solid #e4e4e7", borderRadius: 6, fontSize: 12, marginBottom: 4 }} />
          {candidates.length === 0 ? <div style={{ padding: 8, fontSize: 12, color: "#a1a1aa" }}>No records.</div> : candidates.slice(0, 100).map((r) => (
            <button key={r.id} type="button" onClick={() => toggle(r.id)} style={{ display: "flex", alignItems: "center", gap: 8, width: "100%", textAlign: "left", padding: "6px 8px", border: 0, background: "none", cursor: "pointer", fontSize: 13, borderRadius: 6 }} onMouseEnter={(e) => (e.currentTarget.style.background = "#f4f4f5")} onMouseLeave={(e) => (e.currentTarget.style.background = "none")}>
              <span style={{ flex: 1 }}>{rowTitle(r, linked.titleColId)}</span>
              {ids.includes(r.id) ? <Check style={{ width: 14, height: 14, color: "#0073EA" }} /> : null}
            </button>
          ))}
        </div>
      ) : null}
    </span>
  );
}

type Attachment = { name: string; url: string; mimeType?: string };
function AttachmentCell({ value, onChange }: { value: unknown; onChange: (v: Attachment[]) => void }) {
  const files: Attachment[] = Array.isArray(value) ? (value as Attachment[]).filter((f) => f && typeof f.url === "string") : [];
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [busy, setBusy] = useState(false);
  const upload = async (list: FileList | null) => {
    if (!list || list.length === 0) return;
    setBusy(true);
    const added: Attachment[] = [];
    await Promise.all(Array.from(list).map(async (file) => {
      try {
        const fd = new FormData(); fd.append("file", file);
        const up = await fetch("/api/upload", { method: "POST", body: fd }).then((r) => r.json());
        if (up?.url) added.push({ name: up.name ?? file.name, url: up.url, mimeType: file.type || "application/octet-stream" });
      } catch { /* skip */ }
    }));
    if (added.length) onChange([...files, ...added]);
    setBusy(false);
  };
  return (
    <span style={{ display: "inline-flex", flexWrap: "wrap", gap: 4, alignItems: "center" }}>
      <input ref={inputRef} type="file" multiple style={{ display: "none" }} onChange={(e) => { void upload(e.target.files); e.target.value = ""; }} />
      {files.map((f, i) => (
        <span key={i} style={{ display: "inline-flex", alignItems: "center", gap: 3, background: "#f4f4f5", borderRadius: 4, padding: "1px 6px", fontSize: 11 }}>
          <a href={f.url} target="_blank" rel="noopener noreferrer" style={{ color: "#3f3f46", textDecoration: "none", maxWidth: 120, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{f.name}</a>
          <button type="button" onClick={() => onChange(files.filter((_, n) => n !== i))} style={{ background: "none", border: 0, cursor: "pointer", color: "#a1a1aa", lineHeight: 0, padding: 0 }}>×</button>
        </span>
      ))}
      <button type="button" onClick={() => inputRef.current?.click()} disabled={busy} style={{ background: "none", border: "1px dashed #d4d4d8", borderRadius: 4, color: "#71717a", cursor: "pointer", fontSize: 11, padding: "1px 6px" }}>{busy ? "…" : "+ file"}</button>
    </span>
  );
}

function PersonCell({ value, users, onChange }: { value: unknown; users: OrgUser[]; onChange: (v: string[]) => void }) {
  const ids = Array.isArray(value) ? (value as string[]) : [];
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const chosen = ids.map((id) => users.find((u) => u.id === id)).filter((u): u is OrgUser => !!u);
  const candidates = q.trim() ? users.filter((u) => userName(u).toLowerCase().includes(q.trim().toLowerCase())) : users;
  const toggle = (id: string) => onChange(ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]);
  return (
    <span style={{ position: "relative", display: "inline-flex", flexWrap: "wrap", gap: 4, alignItems: "center" }}>
      {chosen.map((u) => (
        <span key={u.id} style={{ display: "inline-flex", alignItems: "center", gap: 4, background: "#f4f4f5", borderRadius: 999, padding: "1px 8px 1px 2px", fontSize: 11 }}>
          <span style={{ width: 16, height: 16, borderRadius: 999, background: "#e4e4e7", color: "#52525b", fontSize: 8, fontWeight: 600, display: "inline-flex", alignItems: "center", justifyContent: "center", overflow: "hidden" }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            {u.avatar ? <img src={u.avatar} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} /> : userInitials(u)}
          </span>
          {userName(u)}
          <button type="button" onClick={() => toggle(u.id)} style={{ background: "none", border: 0, cursor: "pointer", color: "#a1a1aa", lineHeight: 0, padding: 0 }}>×</button>
        </span>
      ))}
      <button type="button" onClick={() => setOpen((o) => !o)} style={{ background: "none", border: "1px dashed #d4d4d8", borderRadius: 999, color: "#71717a", cursor: "pointer", fontSize: 11, padding: "1px 8px" }}>+ person</button>
      {open ? (
        <div style={{ position: "absolute", top: "100%", left: 0, marginTop: 4, zIndex: 20, minWidth: 220, maxHeight: 260, overflowY: "auto", background: "white", border: "1px solid #e4e4e7", borderRadius: 8, boxShadow: "0 8px 24px rgba(0,0,0,0.12)", padding: 4 }} onMouseLeave={() => setOpen(false)}>
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search people…" autoFocus style={{ width: "100%", height: 28, padding: "0 8px", border: "1px solid #e4e4e7", borderRadius: 6, fontSize: 12, marginBottom: 4 }} />
          {candidates.length === 0 ? <div style={{ padding: 8, fontSize: 12, color: "#a1a1aa" }}>No people.</div> : candidates.slice(0, 100).map((u) => (
            <button key={u.id} type="button" onClick={() => toggle(u.id)} style={{ display: "flex", alignItems: "center", gap: 8, width: "100%", textAlign: "left", padding: "6px 8px", border: 0, background: "none", cursor: "pointer", fontSize: 13, borderRadius: 6 }}>
              <span style={{ flex: 1 }}>{userName(u)}</span>
              {ids.includes(u.id) ? <Check style={{ width: 14, height: 14, color: "#0073EA" }} /> : null}
            </button>
          ))}
        </div>
      ) : null}
    </span>
  );
}

function FormulaCell({ value }: { value: number | string }) {
  const isErr = typeof value === "string" && value.startsWith("#");
  return (
    <span className="dtbl__input" style={{ display: "inline-block", color: isErr ? "#dc2626" : "#3f3f46", opacity: value === "" ? 0.4 : 1 }} title="Computed (read-only)">
      {value === "" ? "—" : String(value)}
    </span>
  );
}

/** Hosts an existing cell editor inside the sheet kernel: autofocuses
 *  the first input, applies the type-to-replace seed, and commits back
 *  to the kernel when focus leaves the editor subtree. Existing editors
 *  save on blur, so commit-on-focus-exit preserves their semantics — and
 *  Escape has to suppress that save (see CellEditCancel) rather than just
 *  close, or cancelling would write the in-progress value. */
function SheetEditorHost({ children, seed, commit }: { children: React.ReactNode; seed: string | null; commit: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const cancelRef = useRef(false);
  useEffect(() => {
    cancelRef.current = false; // a freshly opened editor is always committable
    const el = ref.current?.querySelector<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>("input, textarea, select");
    if (!el) return;
    el.focus();
    const textish = (el instanceof HTMLInputElement && ["text", "number", "email", "url"].includes(el.type)) || el instanceof HTMLTextAreaElement;
    if (seed && textish) {
      el.value = seed;
      try { (el as HTMLInputElement).setSelectionRange?.(seed.length, seed.length); } catch { /* number inputs */ }
    } else if (textish && el instanceof HTMLInputElement && el.type !== "number") {
      el.select();
    }
  }, [seed]);
  return (
    <div
      ref={ref}
      onBlurCapture={(e) => {
        const next = e.relatedTarget as Node | null;
        if (!next || !ref.current?.contains(next)) commit();
      }}
      onKeyDown={(e) => {
        // Any other keystroke means the user is still editing — a stale cancel
        // must never swallow the commit that follows it.
        if (e.key !== "Escape") cancelRef.current = false;
        if (e.key === "Enter" && !(e.target instanceof HTMLTextAreaElement)) {
          e.stopPropagation();
          (e.target as HTMLElement).blur?.();
        }
        if (e.key === "Escape") {
          e.stopPropagation();
          cancelRef.current = true; // set before the blur the editors commit on
          (e.target as HTMLElement).blur?.();
          commit(); // close even if the focused node had nothing to blur
        }
      }}
    >
      <CellEditCancel.Provider value={cancelRef}>{children}</CellEditCancel.Provider>
    </div>
  );
}

/** In-cell formula editor: source text with ref highlighting, hosted inside
 *  SheetEditorHost like every other editor — the host's Enter blurs into the
 *  commit below, and its Escape raises the cancel ref BEFORE that blur, so a
 *  cancelled edit never overwrites the formula it was showing. Autocomplete
 *  stays off in-cell (the cell clips its own overflow, so a dropdown would
 *  be unreadable); the formula bar carries it. */
function SheetFormulaEditor({ initial, baseline, onCommit }: {
  /** What the editor opens showing (the seed, else the source). */
  initial: string;
  /** The cell's pre-edit source — commit fires only when the draft differs
   *  from THIS, so an untouched open cancels silently but an unedited SEED
   *  (type-to-replace) still commits. */
  baseline: string;
  onCommit: (raw: string) => void;
}) {
  const cancelled = useContext(CellEditCancel);
  const [draft, setDraft] = useState(initial);
  return (
    <FormulaTextInput
      value={draft}
      onValueChange={setDraft}
      className="h-[29px]"
      onBlur={() => {
        if (cancelled?.current) return;
        if (draft !== baseline) onCommit(draft);
      }}
    />
  );
}

function CellEditor({ column, value, onChange }: { column: Column; value: unknown; onChange: (v: unknown) => void }) {
  const t = column.type;
  // Escape cancels: the host raises this before blurring, so a blur that is
  // really a cancel must leave the stored value alone.
  const cancelled = useContext(CellEditCancel);
  if (t === "short_text" || t === "email" || t === "url") {
    return (
      <input
        type={t === "short_text" ? "text" : t}
        defaultValue={(value as string) ?? ""}
        onBlur={(e) => { if (cancelled?.current) return; if (e.target.value !== (value ?? "")) onChange(e.target.value); }}
        className="dtbl__input"
      />
    );
  }
  if (t === "long_text") {
    return (
      <textarea
        rows={1}
        defaultValue={(value as string) ?? ""}
        onBlur={(e) => { if (cancelled?.current) return; if (e.target.value !== (value ?? "")) onChange(e.target.value); }}
        className="dtbl__input dtbl__input--area"
      />
    );
  }
  if (t === "number") {
    return (
      <input
        type="number"
        defaultValue={(value as number | "") ?? ""}
        onBlur={(e) => { if (cancelled?.current) return; const n = e.target.value === "" ? null : Number(e.target.value); if (n !== (value ?? null)) onChange(n); }}
        className="dtbl__input"
      />
    );
  }
  if (t === "currency" || t === "percent") {
    return (
      <span style={{ display: "inline-flex", alignItems: "center", gap: 2 }}>
        {t === "currency" ? <span style={{ opacity: 0.5 }}>$</span> : null}
        <input
          type="number"
          step="any"
          defaultValue={(value as number | "") ?? ""}
          onBlur={(e) => { if (cancelled?.current) return; const n = e.target.value === "" ? null : Number(e.target.value); if (n !== (value ?? null)) onChange(n); }}
          className="dtbl__input"
        />
        {t === "percent" ? <span style={{ opacity: 0.5 }}>%</span> : null}
      </span>
    );
  }
  if (t === "rating") {
    const n = typeof value === "number" ? value : 0;
    return (
      <span style={{ display: "inline-flex", gap: 1 }}>
        {[1, 2, 3, 4, 5].map((i) => (
          <button key={i} type="button" onClick={() => onChange(i === n ? null : i)} style={{ background: "none", border: 0, cursor: "pointer", padding: 0, lineHeight: 0 }} aria-label={`Rate ${i}`}>
            <Star style={{ width: 15, height: 15, fill: i <= n ? "#f59e0b" : "none", color: i <= n ? "#f59e0b" : "#d4d4d8" }} />
          </button>
        ))}
      </span>
    );
  }
  if (t === "date") {
    return (
      <input
        type="date"
        defaultValue={(value as string) ?? ""}
        onBlur={(e) => { if (cancelled?.current) return; if (e.target.value !== (value ?? "")) onChange(e.target.value); }}
        className="dtbl__input"
      />
    );
  }
  if (t === "checkbox") {
    return (
      <input
        type="checkbox"
        checked={Boolean(value)}
        onChange={(e) => onChange(e.target.checked)}
      />
    );
  }
  if (t === "select") {
    return (
      <select value={(value as string) ?? ""} onChange={(e) => onChange(e.target.value || null)} className="dtbl__input">
        <option value="">—</option>
        {(column.options ?? []).map((o) => <option key={o} value={o}>{o}</option>)}
      </select>
    );
  }
  if (t === "multi_select") {
    const arr = Array.isArray(value) ? (value as string[]) : [];
    return (
      <div className="dtbl__multi">
        {(column.options ?? []).map((o) => (
          <label key={o}>
            <input
              type="checkbox"
              checked={arr.includes(o)}
              onChange={(e) => onChange(e.target.checked ? [...arr, o] : arr.filter((x) => x !== o))}
            /> {o}
          </label>
        ))}
      </div>
    );
  }
  if (t === "formula" || t === "lookup" || t === "rollup") {
    return <span className="dtbl__input" style={{ display: "inline-block", opacity: 0.5 }} title={column.formula}>computed (grid view)</span>;
  }
  if (t === "link" || t === "attachment" || t === "person") {
    const n = Array.isArray(value) ? value.length : 0;
    return <span className="dtbl__input" style={{ display: "inline-block", opacity: 0.5 }}>{n ? `${n} item${n === 1 ? "" : "s"} (edit in grid)` : "edit in grid"}</span>;
  }
  return null;
}

function csvEscape(v: string): string {
  if (v.includes(",") || v.includes('"') || v.includes("\n")) {
    return `"${v.replace(/"/g, '""')}"`;
  }
  return v;
}
