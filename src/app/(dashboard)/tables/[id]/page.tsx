"use client";

/* Tables · sheet editor — a Google-Sheets-style spreadsheet.
 *
 * Chrome, top to bottom (the Sheets layout the user asked for verbatim):
 * an inline-editable title row, ONE dense toolbar (undo/redo, print, zoom,
 * currency/percent/decimals, the "123" number-format menu, B/I/U/S, text
 * and fill colour, alignment, filter toggle, Σ, and a right-aligned File
 * menu carrying CSV import/export), the fx bar, the grid filling the rest
 * of the viewport, and a bottom bar of sheet tabs with a promptless "+".
 * Every toolbar control is real — no dead buttons.
 *
 * Per-cell formatting (bold/italic/underline/strike/colour/fill/align)
 * rides a RESERVED key on each row's values Json, values["$fmt"] (see
 * lib/sheet-cell-style): no schema change, invisible to every
 * column-driven reader, and deliberately never handed to the formula
 * engine host — styles don't recalc.
 *
 * Columns are anonymous letters (A, B, C…) — nothing else in the header,
 * like Excel. "+" appends a generic text column instantly; number format
 * lives ONLY in the toolbar's 123/$/%/decimals cluster (Sheets' surface),
 * and column operations (sort, delete, formula, relation) live in the
 * header's right-click menu. Rows carry a Sheets-style numbered gutter:
 * click selects the row, drag reorders it. The sheet kernel (SheetGrid)
 * renders the grid; this page owns data semantics, the formula engine
 * host, undo and CSV import/export.
 */

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Table as TableIcon, ArrowLeft, Plus, Trash2, Loader2,
  Link as LinkIcon, ChevronRight, Upload, Download, Search, Filter,
  Globe, Lock, Sigma, Star, Link2, Check,
  Undo2, Redo2, Printer, DollarSign, Percent, ChevronDown,
  ArrowDownAZ, ArrowUpZA, X, Pencil,
  Bold, Italic, Underline, Strikethrough, Baseline, PaintBucket,
  TextAlignStart, TextAlignCenter, TextAlignEnd,
  ArrowUpFromLine, ArrowDownToLine, ArrowLeftToLine, ArrowRightToLine, Eraser,
  Pin, PinOff,
} from "lucide-react";
import { useOsToast } from "@/components/layout/os/toast";
import { useConfirm, usePrompt } from "@/components/ui/dialog-provider";
import { MenuList, MenuItem } from "@/components/ui/menu";
import { MorePortal } from "@/components/layout/os/more-portal";
import { createTableEngine, columnLetter, type StructureResult, type TableEngine } from "@/lib/sheet-engine-host";
import { createSerialQueue } from "@/lib/sheet-serial-queue";
import { streamRows } from "@/lib/sheet-stream";
import { isFormulaCell, FORMULA_KEY } from "@/lib/sheet-engine";
import { createUndoStack, type UndoCommand } from "@/lib/sheet-undo";
import { formatCellValue, isNegativeStyled, matchRule, type ColumnFormat, type ConditionalRule } from "@/lib/sheet-format";
import { adjustDecimals, formatPatchFor, kindForColType, NUMBER_FORMAT_CHOICES, type NumberFormatKind } from "@/lib/sheet-format-actions";
import { CELL_STYLE_KEY, isReservedKey, readCellStyle, styleToCss, withCellStyle, type CellStyle } from "@/lib/sheet-cell-style";
import { createUntitledSheet, NEW_SHEET_COLUMNS, NEW_SHEET_ROWS, UNTITLED_SHEET_NAME } from "@/lib/sheet-new";
import { autoTypeEntry, isOpenColumnType } from "@/lib/sheet-entry";
import { notifyTablesChanged, onSidebarRefresh } from "@/components/layout/os/sidebar-refresh";
import { useOsShell } from "@/components/layout/os/shell-context";
import { RelationConfigModal } from "@/components/tables/relation-config-modal";
import { SheetGrid, type SheetSort } from "@/components/tables/sheet-grid";
import { selectionStats } from "@/lib/sheet-stats";
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
/** Freeze panes (Sheets' View → Freeze): display-index COUNTS of leading
 *  rows/columns pinned while the rest scrolls. Display-only — the engine
 *  never sees it, and it makes no undo entry (Sheets doesn't undo a freeze
 *  either; the menu's Unfreeze is the way back). */
type SheetFreeze = { rows?: number; cols?: number };
type SavedView = { id: string; name: string; type: ViewType; config?: { kanbanCol?: string; calCol?: string; sort?: { colId: string; dir: "asc" | "desc" }; filter?: { colId: string; value: string }; freeze?: SheetFreeze } };
type ApiTable = { id: string; name: string; description?: string | null; columns: Column[]; views?: SavedView[]; rowCount: number; isPublic?: boolean };

/** A freeze is only meaningful while at least ONE row and ONE column can
 *  still scroll — a sheet that is entirely frozen band is a sheet that
 *  cannot be scrolled at all. So the saved counts clamp to rowCount-1 /
 *  colCount-1 against whatever exists NOW (rows deleted since the freeze
 *  was saved, a filter hiding most rows, a legacy view JSON with junk in
 *  the slot). Drops to null when nothing survives, so callers can treat
 *  "no freeze" as one falsy shape. */
function clampFreeze(f: SheetFreeze | null | undefined, rowCount: number, colCount: number): SheetFreeze | null {
  if (!f || typeof f !== "object") return null;
  const clampOne = (n: unknown, max: number) =>
    typeof n === "number" && Number.isFinite(n) ? Math.min(Math.max(0, Math.floor(n)), Math.max(0, max)) : 0;
  const rows = clampOne(f.rows, rowCount - 1);
  const cols = clampOne(f.cols, colCount - 1);
  if (rows <= 0 && cols <= 0) return null;
  const out: SheetFreeze = {};
  if (rows > 0) out.rows = rows;
  if (cols > 0) out.cols = cols;
  return out;
}
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

/* Toolbar colour swatches (Sheets' compact grid, reduced to the brand
 * YBRG + neutrals). Hex literals on purpose: a persisted style must look
 * the same in every theme and every client, so it can never reference a
 * CSS variable. Text swatches are saturated (legible on white); fill
 * swatches are tints (black text stays readable on top of them). */
const TEXT_SWATCHES: { hex: string; name: string }[] = [
  { hex: "#000000", name: "Black" },
  { hex: "#5F6368", name: "Dark grey" },
  { hex: "#9AA0A6", name: "Grey" },
  { hex: "#FFFFFF", name: "White" },
  { hex: "#E2445C", name: "Red" },
  { hex: "#FF8A00", name: "Orange" },
  { hex: "#B58A00", name: "Dark yellow" },
  { hex: "#00A65B", name: "Green" },
  { hex: "#0073EA", name: "Blue" },
  { hex: "#0B3D91", name: "Navy" },
];
const FILL_SWATCHES: { hex: string; name: string }[] = [
  { hex: "#FFFFFF", name: "White" },
  { hex: "#F1F3F4", name: "Light grey" },
  { hex: "#D9DCE0", name: "Grey" },
  { hex: "#5F6368", name: "Dark grey" },
  { hex: "#FBD9DE", name: "Light red" },
  { hex: "#FFE4C2", name: "Light orange" },
  { hex: "#FFF2B3", name: "Light yellow" },
  { hex: "#CCF4E3", name: "Light green" },
  { hex: "#D6E8FF", name: "Light blue" },
  { hex: "#FFCB00", name: "Yellow" },
];

/** Labels for the toggleable text flags, shared by the toolbar pills, the
 *  kernel's Cmd/Ctrl+B/I/U shortcut and the undo-stack labels. */
const STYLE_FLAG_NAMES: Record<"b" | "i" | "u" | "s", string> = { b: "bold", i: "italic", u: "underline", s: "strikethrough" };

/** Two stored "$fmt" maps hold the same styles. Key order is stable (the
 *  sanitiser rebuilds entries in one fixed order), so a JSON compare is an
 *  honest equality — and a spurious mismatch only costs a no-op write. */
function sameStyleMap(a: unknown, b: unknown): boolean {
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
}

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
 *  without Date()'s timezone shifts and NaN cliffs.
 *
 *  Stored NUMBERS compare as numbers in ANY column: an open (short_text)
 *  column holds real numbers since entry-time typing (lib/sheet-entry),
 *  and formula/rollup cells are typed by their result, not their column.
 *  A number sorts before a string (Sheets' ascending order: numbers, then
 *  text); blanks keep the collator's placement so an empty cell lands
 *  where it always has. */
function compareCells(type: ColType, va: unknown, vb: unknown): number {
  const aNum = typeof va === "number";
  const bNum = typeof vb === "number";
  if (NUMERIC_SORT_TYPES.has(type) || (aNum && bNum)) {
    const na = aNum ? va : parseFloat(String(va));
    const nb = bNum ? vb : parseFloat(String(vb));
    if (Number.isFinite(na) && Number.isFinite(nb)) return na - nb;
  }
  // Mixed number/text in a non-numeric column: the number wins the top.
  // Only a non-empty STRING is "text" here; null/"" fall through to the
  // collator, which already sorts them first, exactly as before.
  if (aNum && typeof vb === "string" && vb !== "") return -1;
  if (bNum && typeof va === "string" && va !== "") return 1;
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
      if (text === "") return { kind: "write", value: null };
      // An OPEN column types on entry, Sheets' rule ("5" pasted from Excel
      // lands as the number 5 so SUM over it works); every other text type
      // stores the text verbatim. autoTypeEntry hands back the ORIGINAL
      // untrimmed string when it isn't a number, which is what this branch
      // has always stored. This one branch is the chokepoint for paste,
      // the fill handle (the grid sends its series here as text) and the
      // formula bar's literal commit (commitCellText).
      return { kind: "write", value: isOpenColumnType(col.type) ? autoTypeEntry(raw) : raw };
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
  const [rows, setRowsState] = useState<ApiRow[] | null>(null);
  /* Eagerly-updated mirror of `rows`. The persistent engine host (below) is
   * driven BEFORE each optimistic setState, and swap-rebuilds read the rows
   * of record synchronously — React state only commits at the next render,
   * so every rows write goes through commitRows, which updates the mirror
   * in call order and hands React the very same array. */
  const rowsRef = useRef<ApiRow[] | null>(null);
  const commitRows = useCallback((next: ApiRow[] | null | ((prev: ApiRow[] | null) => ApiRow[] | null)) => {
    const value = typeof next === "function" ? next(rowsRef.current) : next;
    rowsRef.current = value;
    setRowsState(value);
  }, []);

  /* ── The formula engine host (Tables Phase 3; persistent since the Phase 5
   * gating work) ─────────────────────────────────────────────────
   * ONE host per loaded table, held in a ref and driven INCREMENTALLY:
   * every value write flows through setCell/setCells and every row change
   * through rowInserted/rowDeleted BEFORE its optimistic setState, so the
   * dep-graph recalc replaces the old rebuild-per-edit (whose constructor
   * ran a full pass — 560ms at 2k rows, 11.8s at 10k). The host still
   * computes over the UNSORTED rows order: display sort never reaches it,
   * which is what keeps a sorted grid from changing any formula's value.
   *
   * A full SWAP (new instance) happens ONLY on bulk data arrival (initial
   * load, refetch, CSV import's reload) and on column structure/type
   * changes without an incremental host op (add, type change, column-op
   * undo/redo replays) — a column's TYPE changes engine semantics (numeric
   * text only counts in aggregates in numeric-typed columns), so the
   * rebuild is the CORRECT lever there, and cheap now that structure
   * changes are rare events rather than every keystroke.
   *
   * engineVersion bumps after every host mutation so memos and renders
   * re-read a host whose identity did not change. */
  const engineHostRef = useRef<TableEngine | null>(null);
  const [engineVersion, setEngineVersion] = useState(0);
  /** Re-render + re-derive after an in-place host mutation. */
  const bumpEngine = useCallback(() => setEngineVersion((v) => v + 1), []);
  /** Swap in a brand-new host built from canonical page state. */
  const rebuildEngine = useCallback((columns: readonly Column[], rowList: readonly ApiRow[]) => {
    engineHostRef.current = createTableEngine({ columns, rows: rowList });
    setEngineVersion((v) => v + 1);
  }, []);

  /* Row-VALUE persistence (single-cell PATCH + batch value writes) is
   * serialized through one per-table promise chain, so persistence order =
   * user action order — the recorded rapid-same-cell-edit race, where two
   * quick commits could land their PATCHes inverted (last-write-loses).
   * Reads, row creates and column ops deliberately do NOT queue, and the
   * optimistic state updates stay synchronous: only the fetches wait. */
  const writeQueueRef = useRef(createSerialQueue());
  useEffect(() => { writeQueueRef.current = createSerialQueue(); }, [tableId]);
  const [loadError, setLoadError] = useState<string | null>(null);
  /* ── Phase 5a streaming transport (docs/plans/tables.md, amended
   * decision): rows arrive in keyset chunks until the WHOLE table is
   * resident. loadGenRef guards every async effect of load() — a refetch
   * started during a slow stream must never interleave rows into the newer
   * load. streamProgress is non-null ONLY while a MULTI-chunk stream is in
   * flight; it is both the tab-bar progress line's data and the honesty
   * flag: while set, computed cells render a pending mark, because the
   * engine host still holds the pre-stream world and any value it produced
   * would come from a partial (or previous) row set. */
  const loadGenRef = useRef(0);
  const [streamProgress, setStreamProgress] = useState<{ loaded: number; total: number | null } | null>(null);
  const [savingCols, setSavingCols] = useState(false);
  const [search, setSearch] = useState("");
  const [sortState, setSortState] = useState<SheetSort>(null);
  // Saved-view JSON still lives in DataTable.views server-side, but the
  // only thing this surface reads or writes there is the first view's sort
  // — the view-switching UI is gone (Excel-ify decision 1).
  const viewsRef = useRef<SavedView[]>([]);
  const [filterCol, setFilterCol] = useState<string>("");
  const [filterValue, setFilterValue] = useState<string>("");
  // Freeze panes, as PERSISTED (the render-time clamp against the live
  // display is gridFreeze below). Null = nothing frozen.
  const [freeze, setFreeze] = useState<SheetFreeze | null>(null);
  /* Live selection from the kernel: ORDERED display rowIds plus the
   * inclusive column-index span (contract shape), null when selection
   * clears. Feeds the Sheets-style stats cluster in the bottom tab bar. */
  const [gridSelection, setGridSelection] = useState<{ rowIds: string[]; c1: number; c2: number } | null>(null);
  // Row ids are per-table: a payload from the previous sheet's kernel must
  // never feed stats over the next sheet's rows.
  useEffect(() => { setGridSelection(null); }, [tableId]);
  const [activeRowId, setActiveRowId] = useState<string | null>(null);
  // Relational: rows of every table this one links to (for pickers + lookup/rollup).
  const [linkedTables, setLinkedTables] = useState<Record<string, LinkedTable>>({});
  // All org tables (for the link-target picker in the relation config modal).
  const [allTables, setAllTables] = useState<{ id: string; name: string }[]>([]);
  // Column currently being configured in the relation modal (link/lookup/rollup).
  const [configColId, setConfigColId] = useState<string | null>(null);
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
  // Row right-click menu — open / delete (single or the whole selected
  // span), opened at the cursor via the shared MorePortal.
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
  // Header right-click menu — the Sheets model: column operations (sort /
  // delete / formula / relation) live here now that the hover icon cluster
  // and the per-column "…" popover are gone. Same MorePortal point-mode
  // pattern as the row menu above.
  const [headerMenu, setHeaderMenu] = useState<{ colId: string; x: number; y: number } | null>(null);
  const headerMenuAnchorRef = useRef<HTMLElement | null>(null); // unused in point mode
  const headerMenuPanelRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!headerMenu) return;
    const onDown = (e: MouseEvent) => {
      if (headerMenuPanelRef.current?.contains(e.target as Node)) return;
      setHeaderMenu(null);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setHeaderMenu(null); };
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [headerMenu]);

  useEffect(() => { void params.then((p) => setTableId(p.id)); }, [params]);

  const load = useCallback(async () => {
    if (!tableId) return;
    // Every load owns a generation. Chunk application and ALL completion
    // effects below check it and bail when superseded, so a refetch that
    // starts during a slow stream can never interleave rows or rebuild the
    // engine over the newer load's world.
    const gen = ++loadGenRef.current;
    try {
      // One page of the Phase 5a row stream. Tolerates the pre-stream
      // server shape (bare {data}, no nextCursor) as a single-chunk stream.
      const fetchRowPage = async (cursor: string | null) => {
        // A superseded stream stops fetching at its next page turn.
        if (gen !== loadGenRef.current) throw new Error("superseded");
        const url = cursor === null
          ? `/api/tables/${tableId}/rows`
          : `/api/tables/${tableId}/rows?cursor=${encodeURIComponent(cursor)}`;
        const rRes = await fetch(url);
        if (!rRes.ok) throw new Error(`HTTP ${rRes.status}`);
        const rd = await rRes.json();
        return {
          data: (Array.isArray(rd.data) ? rd.data : Array.isArray(rd) ? rd : []) as unknown[],
          nextCursor: typeof rd.nextCursor === "string" ? rd.nextCursor : null,
          total: typeof rd.total === "number" ? rd.total : undefined,
        };
      };
      // The table fetch and the FIRST row page run in parallel — the same
      // wire timing as the old Promise.all — and the stream helper then
      // consumes the pre-started page as page one.
      let firstPage: ReturnType<typeof fetchRowPage> | null = fetchRowPage(null);
      // If the table fetch throws first, the abandoned page must not
      // surface as an unhandled rejection; awaiting it later still throws.
      firstPage.catch(() => undefined);
      const tRes = await fetch(`/api/tables/${tableId}`);
      if (!tRes.ok) throw new Error(`HTTP ${tRes.status}`);
      const td = await tRes.json();
      const t: ApiTable = td.data ?? td;
      t.columns = Array.isArray(t.columns) ? t.columns : [];
      if (gen !== loadGenRef.current) return;

      /* THE HONESTY RULE: rows appear progressively, but the engine host is
       * rebuilt exactly ONCE, after the FINAL chunk — the formula engine is
       * client-side and a value computed over a partial row set would be
       * silently wrong (the one forbidden sin). A single-chunk stream —
       * every table within the old 5k ceiling — buffers its one chunk and
       * applies it below in the exact pre-stream order, so today's tables
       * render identically, with no pending state ever shown. */
      let firstChunk: ApiRow[] | null = null;
      let multi = false;
      const allRows = await streamRows(
        (cursor) => {
          if (firstPage !== null) { const p = firstPage; firstPage = null; return p; }
          return fetchRowPage(cursor);
        },
        (chunk, loaded, total) => {
          if (gen !== loadGenRef.current) return; // superseded: drop; fetchRowPage ends the loop
          const rowsChunk = chunk as ApiRow[];
          if (!multi && firstChunk === null && (total === null || loaded >= total)) {
            // First chunk and the count says this is the whole table: hold
            // it for the single-shot path after the stream resolves.
            firstChunk = rowsChunk;
            return;
          }
          if (!multi) {
            // The stream just proved itself multi-chunk: show the table
            // shell now and let the grid fill as chunks land. Computed
            // cells render pending (streamProgress gates them) until the
            // completion rebuild.
            multi = true;
            setTable(t);
            commitRows(firstChunk ? [...firstChunk, ...rowsChunk] : rowsChunk);
            firstChunk = null;
          } else {
            commitRows((prev) => [...(prev ?? []), ...rowsChunk]);
          }
          setStreamProgress({ loaded, total });
        },
      );
      if (gen !== loadGenRef.current) return; // a newer load owns every effect below
      if (!multi) {
        // Single chunk: the pre-stream sequence, byte-for-byte — table,
        // rows and engine land together. (The progress clear is a no-op
        // here unless this load superseded a mid-stream one.)
        setStreamProgress(null);
        const rowsArr = (firstChunk ?? allRows) as ApiRow[];
        setTable(t);
        commitRows(rowsArr);
        // Bulk data arrival (initial load, refetch, CSV import's reload) is a
        // swap trigger: rebuild the host once from server truth. This also
        // heals any host/state drift, which is why every failure path reloads.
        rebuildEngine(t.columns, rowsArr);
      } else {
        // Completion rebuild reads rowsRef, NOT allRows: value edits made
        // while streaming went through commitRows into the mirror, and
        // commitRows is synchronous — every chunk append of this generation
        // has already landed by the time the stream resolves.
        setStreamProgress(null);
        rebuildEngine(t.columns, rowsRef.current ?? []);
      }
      const savedViews: SavedView[] = Array.isArray(t.views) && t.views.length ? t.views : [{ id: "default", name: "Grid", type: "grid" }];
      viewsRef.current = savedViews;
      setSortState(savedViews[0]?.config?.sort ?? null);
      // Filter restores from the same first-view config sort does, but only
      // while its column still exists: applying a filter over a deleted
      // column would silently blank the whole sheet.
      const savedFilter = savedViews[0]?.config?.filter;
      // Restore only what the filter UI can SHOW: the column must still be a
      // select/multi_select and the saved value still among its options —
      // otherwise the filter would hide rows while both dropdowns render as
      // "No filter"/"Any value", an invisible filter with no way to clear it.
      const fcol = savedFilter ? t.columns.find((c) => c.id === savedFilter.colId) : undefined;
      const liveFilter = savedFilter && fcol
        && (fcol.type === "select" || fcol.type === "multi_select")
        && (!savedFilter.value || (fcol.options ?? []).includes(savedFilter.value))
        ? savedFilter : null;
      setFilterCol(liveFilter?.colId ?? "");
      setFilterValue(liveFilter?.value ?? "");
      // Freeze restores from the same first-view config, clamped against the
      // rows/columns that exist NOW (rowsRef is already the full table: both
      // stream paths above commit synchronously before this line) — a freeze
      // saved on a bigger sheet must not freeze everything that's left.
      setFreeze(clampFreeze(savedViews[0]?.config?.freeze, (rowsRef.current ?? []).length, t.columns.length));
      savedColumnsRef.current = t.columns;
    } catch (e) {
      // A stale stream that failed (or was deliberately aborted by the
      // generation check) must not touch the newer load's UI.
      if (gen !== loadGenRef.current) return;
      setStreamProgress(null);
      setLoadError(e instanceof Error ? e.message : "load failed");
    }
  }, [tableId, commitRows, rebuildEngine]);
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

  /** Push value writes into the persistent host as ONE setCells pass (one
   *  clock snapshot, one recalc — a 500-cell batch is one pass, not 500),
   *  ahead of the caller's optimistic setState. Writes to rows no longer in
   *  the mirror are dropped, matching the server merge's stale-id
   *  tolerance; unknown columns are dropped via the host's own column map.
   *  If the host still refuses an id — drift, which would mean a missed
   *  mutation site — the swap IS the recovery: rebuild from canonical
   *  state on the next microtask, i.e. AFTER the caller's synchronous
   *  commitRows, so the value the user just typed is in the mirror the
   *  rebuild reads. */
  function driveHostWrites(writes: { colId: string; rowId: string; raw: unknown }[]) {
    const host = engineHostRef.current;
    if (!host || writes.length === 0) return;
    const liveRows = new Set((rowsRef.current ?? []).map((r) => r.id));
    // The reserved "$fmt" styles key rides row.values but is NOT a column:
    // it must never reach the host (its column map would drop it anyway,
    // but a style-only batch must also not cost a recalc pass or a bump).
    const accepted = writes.filter((w) => !isReservedKey(w.colId) && liveRows.has(w.rowId) && host.columnLetterOf(w.colId) !== null);
    if (accepted.length === 0) return;
    try {
      host.setCells(accepted);
      bumpEngine();
    } catch {
      queueMicrotask(() => rebuildEngine(tableRef.current?.columns ?? [], rowsRef.current ?? []));
    }
  }

  /** Fold host-produced COLUMN formula rewrites into state + persistence.
   *  The host already applied them to its own model; this mirrors them to
   *  React state and the server (non-strict: persistColumns toasts nothing
   *  itself and the next reload reconciles a miss). */
  function applyEngineColumnRewrites(rewrites: { colId: string; formula: string }[]) {
    if (rewrites.length === 0) return;
    const cur = tableRef.current;
    if (!cur) return;
    const cols = applyColumnRewrites(cur.columns, rewrites);
    tableRef.current = { ...cur, columns: cols };
    setTable((prev) => (prev ? { ...prev, columns: cols } : prev));
    void persistColumns(cols);
  }

  /** Phase 5c: the batch route now NAMES the update ids it dropped because
   *  the row no longer exists (deleted by another client between our read
   *  and this write) — missingIds in the response — instead of only
   *  skipping them silently. Single-cell edits never ride the batch route
   *  (they PATCH /rows and get a 409 there instead), so the batch update
   *  paths below are the only places the client can learn a target row
   *  vanished. Deletes are deliberately NOT reported this way: deleting an
   *  already-deleted row is idempotent success, not a conflict. */
  function missingIdsOf(payload: unknown): string[] {
    const ids = (payload as { missingIds?: unknown } | null)?.missingIds;
    return Array.isArray(ids) ? ids.filter((x): x is string => typeof x === "string") : [];
  }
  /** missingIds out of an UNREAD batch Response. Callers that already
   *  parsed the body (the paste one-shot needs `inserted` from the same
   *  response) use missingIdsOf on their parse — a Response body reads
   *  once. Parse failures read as “nothing missing”: surfacing is
   *  best-effort and must never fail a write that the server applied. */
  async function readBatchMissingIds(res: Response): Promise<string[]> {
    const d = await res.json().catch(() => null);
    return missingIdsOf(d?.data ?? d);
  }
  /** Toast + reload when a batch write reported rows deleted elsewhere.
   *  A full load() rather than surgical eviction: the remote deletion also
   *  shifted every A1 row ref below it, and the reload rebuilds the engine
   *  host from server truth — the one guaranteed-coherent recovery. */
  function noteRowsDeletedElsewhere(ids: ReadonlySet<string>) {
    if (ids.size === 0) return;
    toast(`${ids.size} row${ids.size === 1 ? " was" : "s were"} deleted elsewhere — reloading`);
    void load();
  }

  /** Batch cell writes with optimistic local apply. THROWS on any refused
   *  chunk — used by undo/redo bodies where honesty is the contract, and by
   *  callers that wrap their own catch. */
  async function writeValuesBatchStrict(updates: { id: string; values: Record<string, unknown> }[]) {
    if (!tableId || updates.length === 0) return;
    const byRow = new Map(updates.map((u) => [u.id, u.values]));
    // Host first, then the mirror. Rows deleted since the command was
    // captured are simply absent from state and skipped by the server merge
    // — the documented v1 semantic: such a command may no-op, but it never
    // corrupts — and driveHostWrites drops them the same way.
    driveHostWrites(updates.flatMap((u) => Object.entries(u.values).map(([colId, raw]) => ({ colId, rowId: u.id, raw }))));
    commitRows((prev) => prev ? prev.map((r) => byRow.has(r.id) ? { ...r, values: { ...r.values, ...byRow.get(r.id)! } } : r) : prev);
    // All chunks ride ONE queued job so another value write can't
    // interleave between the slices of a single logical batch.
    const missing = new Set<string>();
    await writeQueueRef.current.run(async () => {
      for (let i = 0; i < updates.length; i += BATCH_MAX_OPS) {
        const res = await fetch(`/api/tables/${tableId}/rows/batch`, {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ updates: updates.slice(i, i + BATCH_MAX_OPS) }),
        });
        if (!res.ok) throw new Error(`batch update HTTP ${res.status}`);
        for (const mid of await readBatchMissingIds(res)) missing.add(mid);
      }
    });
    // Surfaced AFTER the queued job so the reload can't interleave with a
    // chunk still in flight — and NOT a throw: the route applied every
    // still-live row, so an undo/redo body reporting failure here would
    // re-push a command that mostly landed.
    noteRowsDeletedElsewhere(missing);
  }

  /** Batch row deletes (chunked), optimistic. Throws on a refused chunk;
   *  stale ids are tolerated by the route, which makes retries idempotent.
   *  Drives the host row by row (cumulative: later deletes see the shape
   *  earlier ones left) and persists the SURVIVORS' ref rewrites — but only
   *  after every delete chunk landed, so a refused delete never leaves
   *  rewritten sources on the server for a delete that didn't happen. */
  async function deleteRowsBatchStrict(ids: string[]) {
    if (!tableId || ids.length === 0) return;
    const doomed = new Set(ids);
    const host = engineHostRef.current;
    const live = new Set((rowsRef.current ?? []).map((r) => r.id));
    const cellRewrites = new Map<string, { colId: string; rowId: string; stored: unknown }>();
    const colRewrites = new Map<string, string>();
    let hostOk = host !== null;
    if (host) {
      try {
        for (const id of ids) {
          if (!live.has(id)) continue; // stale id — the route tolerates it, so does the host drive
          const res = host.rowDeleted(id);
          for (const rw of res.rewritten.cells) {
            if (!doomed.has(rw.rowId)) cellRewrites.set(`${rw.rowId}:${rw.colId}`, rw);
          }
          for (const cw of res.rewritten.columns) colRewrites.set(cw.colId, cw.formula);
        }
      } catch { hostOk = false; }
    }
    commitRows((prev) => prev ? prev.filter((r) => !doomed.has(r.id)) : prev);
    if (hostOk) bumpEngine();
    else rebuildEngine(tableRef.current?.columns ?? [], rowsRef.current ?? []);
    for (let i = 0; i < ids.length; i += BATCH_MAX_OPS) {
      const res = await fetch(`/api/tables/${tableId}/rows/batch`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ deletes: ids.slice(i, i + BATCH_MAX_OPS) }),
      });
      if (!res.ok) throw new Error(`batch delete HTTP ${res.status}`);
    }
    if (cellRewrites.size > 0) void persistCellRewrites([...cellRewrites.values()]);
    applyEngineColumnRewrites([...colRewrites].map(([colId, formula]) => ({ colId, formula })));
  }

  /** Fold server-created rows into the persistent host AND the local
   *  mirror at the index their POSITION dictates. Appends (auto-allocated
   *  position = max+1) land at the end; an undo restore's explicit
   *  original positions land back in the middle — the engine's row
   *  indices, and therefore every A1 ref, then match what a reload would
   *  compute from the server's position-ordered list (row anchoring is
   *  the law: engine rows = original storage order, and storage order IS
   *  position order). */
  function absorbCreatedRows(created: ApiRow[]) {
    if (created.length === 0) return;
    const host = engineHostRef.current;
    const next = [...(rowsRef.current ?? [])];
    const sorted = [...created].sort((a, b) => a.position - b.position);
    /** Index that keeps the mirror position-sorted; an append runs the
     *  walk zero times. */
    const insertAt = (row: ApiRow) => {
      let at = next.length;
      while (at > 0 && next[at - 1].position > row.position) at--;
      return at;
    };
    // rowInserted is internally a full graph rebuild, so k of them cost k
    // rebuilds — a LARGE batch (blank-sheet seed, bulk-undo restore, big
    // paste) absorbs as ONE swap instead. No rewrite is lost that way:
    // appends can't shift any ref, and the only mid-table bulk insert —
    // bulk-delete undo — restores the survivors' sources itself right
    // after this returns.
    if (host === null || created.length > 16) {
      for (const row of sorted) next.splice(insertAt(row), 0, row);
      commitRows(next);
      rebuildEngine(tableRef.current?.columns ?? [], next);
      return;
    }
    const cellRewrites: { colId: string; rowId: string; stored: unknown }[] = [];
    const colRewrites: { colId: string; formula: string }[] = [];
    let hostOk = true;
    for (const row of sorted) {
      const at = insertAt(row);
      if (hostOk) {
        try {
          const res = host.rowInserted({ id: row.id, values: row.values }, at);
          cellRewrites.push(...res.rewritten.cells);
          colRewrites.push(...res.rewritten.columns);
        } catch { hostOk = false; }
      }
      next.splice(at, 0, row);
    }
    commitRows(next);
    if (hostOk) bumpEngine();
    else rebuildEngine(tableRef.current?.columns ?? [], next);
    // A mid-table insert shifts refs at/below it down; those rewrites
    // persist like every other host rewrite. End-appends yield none.
    if (cellRewrites.length > 0) void persistCellRewrites(cellRewrites);
    applyEngineColumnRewrites(colRewrites);
  }

  /** Batch row inserts (chunked). Absorbs each chunk's server-created rows
   *  locally (host + mirror, at their position-true indices) and reports
   *  their ids via onChunk BEFORE moving on, so a restore that dies
   *  mid-way leaves a trail its retry can clean up.
   *  Returns every created row; throws on the first refused chunk. */
  async function insertRowsBatchStrict(
    payloads: { values: Record<string, unknown> }[],
    onChunk?: (createdIds: string[]) => void,
  ): Promise<ApiRow[]> {
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
      absorbCreatedRows(created);
    }
    return all;
  }

  /** Persist a full columns array, optimistic, throwing on failure — the
   *  strict sibling of persistColumns for undo/redo bodies. Column-op
   *  undo/redo replays arbitrary columns arrays (structure and type may
   *  both differ), so by default this SWAPS the engine host — the correct
   *  lever for structure/type changes, and a cheap one now that they are
   *  rare events. Callers that already drove the host incrementally
   *  (rename/move/delete inverses) pass hostAlreadyCurrent to skip it. */
  async function saveColumnsStrict(cols: Column[], opts?: { hostAlreadyCurrent?: boolean }) {
    if (!tableId) throw new Error("no table");
    // Eager tableRef bump (the addColumn/applyColumnPatches discipline):
    // value writes later in the same command must see the columns THIS
    // call just installed, not last render's.
    if (tableRef.current) tableRef.current = { ...tableRef.current, columns: cols };
    setTable((prev) => prev ? { ...prev, columns: cols } : prev);
    if (!opts?.hostAlreadyCurrent) rebuildEngine(cols, rowsRef.current ?? []);
    const res = await fetch(`/api/tables/${tableId}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ columns: cols }),
    });
    if (!res.ok) throw new Error(`columns PATCH HTTP ${res.status}`);
    savedColumnsRef.current = cols;
  }

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
        // Rows stream to COMPLETION before the table enters linkedTables —
        // a rollup aggregates these rows client-side, so a partial set here
        // would be the same silent-aggregate sin the main grid guards
        // against. Until then relationalValue keeps rendering its "…".
        const [tRes, rs] = await Promise.all([
          fetch(`/api/tables/${id}`),
          streamRows(async (cursor) => {
            const rRes = await fetch(cursor === null
              ? `/api/tables/${id}/rows`
              : `/api/tables/${id}/rows?cursor=${encodeURIComponent(cursor)}`);
            if (!rRes.ok) throw new Error(`HTTP ${rRes.status}`);
            const rd = await rRes.json();
            return {
              data: (Array.isArray(rd.data) ? rd.data : Array.isArray(rd) ? rd : []) as unknown[],
              nextCursor: typeof rd.nextCursor === "string" ? rd.nextCursor : null,
            };
          }, () => undefined),
        ]);
        if (!tRes.ok) return null;
        const td = await tRes.json();
        const t = td.data ?? td;
        const columns: Column[] = Array.isArray(t.columns) ? t.columns : [];
        return { id, name: t.name as string, columns, titleColId: titleColumnId(columns), rows: rs as ApiRow[] } as LinkedTable;
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
    if (label !== "") { try { res = engineHostRef.current?.columnRenamed(colId, label) ?? null; } catch { res = null; } }
    if (res) bumpEngine();
    const cols = applyColumnRewrites(
      cur.columns.map((c) => c.id === colId ? { ...c, label } : c),
      res?.rewritten.columns ?? [],
    );
    // columnRenamed drove the host incrementally; an empty label (the
    // engine can't rewrite refs into "[]") or a thrown rewrite falls back
    // to the swap, so the in-session host always matches what a reload
    // would compute — [Old] refs then show #NAME?, honestly.
    await saveColumnsStrict(cols, { hostAlreadyCurrent: res !== null });
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
    try { res = engineHostRef.current?.columnMoved(from, to) ?? null; } catch { res = null; }
    const [moved] = cols.splice(from, 1);
    cols.splice(to, 0, moved);
    const next = applyColumnRewrites(cols, res?.rewritten.columns ?? []);
    if (res) bumpEngine();
    // columnMoved drove the host incrementally (a thrown res falls back to
    // the swap below via the default).
    await saveColumnsStrict(next, { hostAlreadyCurrent: res !== null });
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

  /* setColumnFormat / setColumnRules died with the per-column "…" popover
   * (Sheets parity): the toolbar's 123/$/%/decimals cluster is the only
   * number-format editor now, and highlight RULES lost their editor while
   * existing rules keep painting (cellStyleFor below reads col.rules unchanged). */

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
    // TYPE (numeric-text coercion in aggregates keys off it) and formula
    // change what the engine computes — the swap is the correct lever for
    // those. format/rules are display-only: no host action at all.
    if (patches.some((p) => "type" in p.after || "formula" in p.after || "label" in p.after)) {
      rebuildEngine(cols, rowsRef.current ?? []);
    }
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

  /** Filters ride the same first-view config JSON sort does, written just
   *  as eagerly (persistSort above is the template). Only a FULLY set
   *  filter persists: the apply path needs both colId and value, so a
   *  half-picked filter (column chosen, no value yet) is a no-op that is
   *  not worth resurrecting on reload. `undefined` drops the key in the
   *  PATCH body's JSON, which is how clearing reaches the server. */
  const persistFilter = (colId: string, value: string) => {
    setFilterCol(colId);
    setFilterValue(value);
    const filter = colId && value ? { colId, value } : undefined;
    const cur: SavedView[] = viewsRef.current.length ? viewsRef.current : [{ id: "default", name: "Grid", type: "grid" }];
    const next = cur.map((v, i) => (i === 0 ? { ...v, config: { ...v.config, filter } } : v));
    viewsRef.current = next;
    void patchTable({ views: next });
  };

  /** Freeze rides the same first-view config JSON (persistSort is the
   *  template): written eagerly, `undefined` drops the key so an unfreeze
   *  reaches the server as an absent slot. No undo entry on purpose —
   *  Sheets doesn't undo freezes either, and a freeze touches no data.
   *  A null/empty freeze and an all-zero one both persist as absent. */
  const persistFreeze = (patch: Partial<SheetFreeze>) => {
    const merged: SheetFreeze = { ...(freeze ?? {}), ...patch };
    const nextFreeze = merged.rows || merged.cols
      ? { ...(merged.rows ? { rows: merged.rows } : {}), ...(merged.cols ? { cols: merged.cols } : {}) }
      : null;
    setFreeze(nextFreeze);
    const cur: SavedView[] = viewsRef.current.length ? viewsRef.current : [{ id: "default", name: "Grid", type: "grid" }];
    const next = cur.map((v, i) => (i === 0 ? { ...v, config: { ...v.config, freeze: nextFreeze ?? undefined } } : v));
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
    // Column structure changed with no incremental host op — swap. An
    // appended empty column can't change any existing value, so the
    // rebuild's pass is the cheap kind.
    rebuildEngine(cols, rowsRef.current ?? []);
    const ok = await persistColumns(cols);
    if (ok) {
      const at = cols.length - 1;
      pushUndo({
        label: `add column ${columnLetter(at)}`,
        // Inverse of an append: delete it, letting the live host produce
        // whatever rewrites refs into/past it now need.
        undo: () => removeColumnStrict(def.id),
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

  /** Delete a column through the live host (refs into it become #REF!,
   *  refs past it shift) and persist — the strict inverse of an append,
   *  shared by the add-column and insert-column undo bodies. A column
   *  already gone is a no-op, never an error. */
  async function removeColumnStrict(colId: string) {
    const curT = tableRef.current;
    if (!curT) throw new Error("table gone");
    if (!curT.columns.some((c) => c.id === colId)) return;
    let res: StructureResult | null = null;
    try { res = engineHostRef.current?.columnDeleted(colId) ?? null; } catch { res = null; }
    if (res) bumpEngine();
    const next = applyColumnRewrites(curT.columns.filter((c) => c.id !== colId), res?.rewritten.columns ?? []);
    await saveColumnsStrict(next, { hostAlreadyCurrent: res !== null });
    if (res && res.rewritten.cells.length > 0) await writeValuesBatchStrict(rewritesToUpdates(res.rewritten.cells));
  }

  /** Header-menu "Insert 1 column left/right" (Sheets). Composed from the
   *  existing primitives, no new server code: append a blank text column
   *  the way "+" does, then performMoveStrict it beside the anchor — the
   *  move's host pass shifts every ref at/right of the slot by one, which
   *  is exactly what a Sheets insert does to "=C1". ONE undo command:
   *  undo deletes the column (removeColumnStrict), redo re-appends the
   *  same def and re-targets against the anchor column as it sits then. */
  function insertColumnNear(anchorColId: string, where: "left" | "right") {
    const cur = tableRef.current ?? table;
    if (!cur) return;
    const def: Column = { id: newId(), type: "short_text", label: "" };
    const targetIndex = () => {
      const cols = tableRef.current?.columns ?? [];
      const idx = cols.findIndex((c) => c.id === anchorColId);
      if (idx < 0) return Math.max(0, cols.length - 1);
      return where === "left" ? idx : idx + 1;
    };
    /** Append `def` at the end (the addColumn discipline: eager tableRef
     *  bump, swap the host, persist — throwing, since what follows must
     *  not move a column the server never got). */
    const appendStrict = async () => {
      const curT = tableRef.current;
      if (!curT) throw new Error("table gone");
      if (curT.columns.some((c) => c.id === def.id)) return;
      const cols = [...curT.columns, { ...def }];
      tableRef.current = { ...curT, columns: cols };
      setTable((prev) => (prev ? { ...prev, columns: cols } : prev));
      rebuildEngine(cols, rowsRef.current ?? []);
      if (!(await persistColumns(cols))) throw new Error("columns PATCH failed");
    };
    void (async () => {
      try {
        const target = targetIndex();
        await appendStrict();
        // Inserting right of the last column is the no-op performMoveStrict
        // already short-circuits.
        await performMoveStrict(def.id, target);
        pushUndo({
          label: `insert column ${where}`,
          undo: () => removeColumnStrict(def.id),
          redo: async () => {
            await appendStrict();
            await performMoveStrict(def.id, targetIndex());
          },
        });
      } catch {
        toast("Couldn't insert column — reloading");
        void load();
      }
    })();
  }

  /** The blank-sheet seed for a table that has zero columns (legacy, or a
   *  creation whose seeding failed): the SAME 26-column (A..Z) × 1000-row
   *  shape lib/sheet-new seeds at creation time, so every sheet opens as
   *  the sea of empty cells the user asked for. Not undoable on purpose —
   *  it IS the blank sheet. */
  async function startSheet() {
    const cur = tableRef.current ?? table;
    if (!cur || cur.columns.length > 0) return;
    const cols: Column[] = Array.from({ length: NEW_SHEET_COLUMNS }, () => ({ id: newId(), type: "short_text", label: "" }));
    // Eager tableRef bump, same as addColumn: the guard above must see the
    // new columns immediately, or a double-click faster than the sync
    // effect fires the 1000-row seed twice (2000 blank rows).
    if (tableRef.current) tableRef.current = { ...tableRef.current, columns: cols };
    setTable((prev) => (prev ? { ...prev, columns: cols } : prev));
    // 26 fresh columns on an empty table: swap (trivially cheap here).
    rebuildEngine(cols, rowsRef.current ?? []);
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
    // Relation config (link/lookup/rollup wiring) computes outside the
    // engine; only type/formula/label patches reach engine semantics.
    if ("type" in patch || "formula" in patch || "label" in patch) {
      rebuildEngine(cols, rowsRef.current ?? []);
    }
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
    // A column FORMULA change re-fills every cell of the column — engine
    // semantics, no incremental op: swap.
    rebuildEngine(cols, rowsRef.current ?? []);
    const ok = await persistColumns(cols);
    if (ok) pushColumnPatch(`edit formula of "${col.label}"`, colId, { formula: prev }, { formula: next });
  }

  /* NO UI reaches renameColumn since the header label input died (headers
   * are pure letters now), but the rename machinery stays: undo replays
   * still route through performRenameStrict, [Header] refs in stored
   * formulas keep resolving against labels, and a future rename surface
   * plugs straight back in. */
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- kept deliberately, see the note above
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
    if (label !== "") { try { res = engineHostRef.current?.columnRenamed(colId, label) ?? null; } catch { /* a rewrite failure must never block the rename */ } }
    const cols = applyColumnRewrites(
      table.columns.map((c) => c.id === colId ? { ...c, label } : c),
      res?.rewritten.columns ?? [],
    );
    setTable({ ...table, columns: cols });
    if (res) bumpEngine();
    else rebuildEngine(cols, rowsRef.current ?? []);
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
    // Re-resolve BOTH from the live refs: the confirm await spans user time,
    // and render-scope table/rows captured before the dialog would snapshot
    // (and later restore) values a concurrent mutation already replaced.
    const curTable = tableRef.current;
    if (!curTable) return;
    const colIndex = curTable.columns.findIndex((c) => c.id === colId);
    const colDef = curTable.columns[colIndex];
    if (!colDef) return;
    const colSnapshot: Column = { ...colDef };
    const cellValues = (rowsRef.current ?? [])
      .filter((r) => r.values[colId] !== undefined)
      .map((r) => ({ id: r.id, v: r.values[colId] }));
    // Rewrites come from the PRE-delete host: refs right of the column shift
    // left, refs into it become #REF! — without persisting these, every
    // stored formula silently repoints (the bug this wave closes). The host
    // itself skips the dying column's own cells.
    let res: StructureResult | null = null;
    // Ref, not the render-scope host: the awaited confirm above can span a
    // refetch's swap, and rewrites computed on a dead instance would be lost.
    try { res = engineHostRef.current?.columnDeleted(colId) ?? null; } catch { /* a rewrite failure must never block the delete */ }
    const rewCells = res?.rewritten.cells ?? [];
    const rewCols = res?.rewritten.columns ?? [];
    // Pre-delete stored sources of everything the delete rewrote — read
    // from React state, which the host's own mutation never touches.
    const liveRowById = new Map((rowsRef.current ?? []).map((r) => [r.id, r]));
    const priorCellSources = rewCells.map((rw) => ({
      colId: rw.colId, rowId: rw.rowId, stored: liveRowById.get(rw.rowId)?.values[rw.colId] ?? null,
    }));
    const priorColFormulas = new Map(rewCols.map((cw) => [cw.colId, curTable.columns.find((c) => c.id === cw.colId)?.formula]));
    const cols = applyColumnRewrites(curTable.columns.filter((c) => c.id !== colId), rewCols);
    setTable((prev) => (prev ? { ...prev, columns: cols } : prev));
    if (res) bumpEngine();
    else rebuildEngine(cols, rowsRef.current ?? []);
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
    try { res = engineHostRef.current?.columnMoved(from, to) ?? null; } catch { /* never block the move */ }
    const [moved] = cols.splice(from, 1);
    cols.splice(to, 0, moved);
    const next = applyColumnRewrites(cols, res?.rewritten.columns ?? []);
    setTable({ ...table, columns: next });
    if (res) bumpEngine();
    else rebuildEngine(next, rowsRef.current ?? []);
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

  /* The old one-at-a-time createRow/addRow pair died with the "New row"
   * footer button: rows now arrive in blocks (the corner "+" below, the
   * silent edge growth, paste overflow), all through insertRowsBatchStrict. */

  /** The corner "+" (bottom-left, above the tab bar): 500 blank rows as
   *  ONE undoable command — the manual sibling of the silent edge growth
   *  below, for when that growth is gated off (sorted/filtered) or the
   *  user simply wants runway now. */
  const [addingRows, setAddingRows] = useState(false);
  async function addRowsBlock() {
    if (!tableId || addingRows) return;
    setAddingRows(true);
    try {
      const created = await insertRowsBatchStrict(Array.from({ length: 500 }, () => ({ values: {} })));
      // The server hands re-added rows NEW ids on redo, so the command
      // re-captures them — a second undo must aim at rows that exist.
      let ids = created.map((r) => r.id);
      let redoCreated: string[] = [];
      pushUndo({
        label: "add 500 rows",
        undo: async () => {
          await deleteRowsBatchStrict(ids);
        },
        redo: async () => {
          if (redoCreated.length > 0) {
            // A previous redo attempt died mid-chunk: clear its partial
            // append first, or rows would duplicate (the bulk-undo shape).
            await deleteRowsBatchStrict(redoCreated);
            redoCreated = [];
          }
          const again = await insertRowsBatchStrict(
            Array.from({ length: 500 }, () => ({ values: {} })),
            (chunkIds) => redoCreated.push(...chunkIds),
          );
          ids = again.map((r) => r.id);
        },
      });
    } catch { toast("Couldn't add rows"); }
    finally { setAddingRows(false); }
  }

  /** Silent growth at the bottom edge: the kernel signals (throttled) when
   *  ArrowDown / Enter-commit walks off the last row, and 100 blank rows
   *  appear — Sheets' "keep typing, the sheet keeps up". Deliberately
   *  NON-undoable (blank appends destroy nothing; Ctrl+Z should keep
   *  undoing the user's EDITS, not un-grow the sheet under them) and
   *  gated: never while a sort/filter/search reorders display (the new
   *  rows would teleport), never mid-stream, never past 50k rows, and one
   *  append in flight at a time. */
  const growRowsBusyRef = useRef(false);
  function growRows() {
    if (growRowsBusyRef.current) return;
    if (sortState || filterCol || search.trim() || streamProgress) return;
    if ((rowsRef.current?.length ?? 0) >= 50_000) return;
    growRowsBusyRef.current = true;
    void (async () => {
      try {
        // Strict insert path, but NO pushUndo — that is the whole
        // difference from addRowsBlock. Absorbed via the standard
        // insert-absorb path (end-appends yield no rewrites).
        await insertRowsBatchStrict(Array.from({ length: 100 }, () => ({ values: {} })));
      } catch {
        // Silent: growth is a convenience; the next edge hit retries.
      } finally {
        growRowsBusyRef.current = false;
      }
    })();
  }

  /** Phase 5c: a guarded PATCH bounced (409) — another client changed the
   *  cell(s) this edit vouched for. Fold ONLY the conflicted columns (where
   *  the server provably outran us) plus server keys we hold no local value
   *  for, through the same host-then-mirror order every optimistic write
   *  uses. Deliberately NOT the whole row: our own queued sibling-cell
   *  writes may still be in flight, and a wholesale absorb would clobber
   *  their optimistic values with an older server snapshot — they land on
   *  the server moments later, so keeping them IS the fresher truth. A
   *  conflicted cell absent from `current` recomputes as null (the other
   *  client cleared it). */
  function absorbConflictRow(rowId: string, current: Record<string, unknown>, conflictCols: string[]) {
    const localRow = (rowsRef.current ?? []).find((r) => r.id === rowId);
    const localValues = localRow?.values ?? {};
    const hasOwn = (o: object, k: string) => Object.prototype.hasOwnProperty.call(o, k);
    // Key-driven over the server row, so the reserved "$fmt" styles key
    // (not a column) is skipped explicitly: style maps are never guarded,
    // so they can never be the conflict, and they must not become a host
    // write.
    const colIds = new Set([
      ...conflictCols,
      ...Object.keys(current).filter((k) => !hasOwn(localValues, k)),
    ].filter((k) => !isReservedKey(k)));
    const writes = [...colIds].map((colId) => ({
      colId,
      rowId,
      // hasOwn, not bare indexing: `current` is parsed JSON, so a colId that
      // collides with a prototype name must read as empty, not as a function.
      raw: hasOwn(current, colId) ? current[colId] : null,
    }));
    driveHostWrites(writes);
    commitRows((prev) => prev ? prev.map((r) => {
      if (r.id !== rowId) return r;
      const merged = { ...r.values };
      for (const w of writes) merged[w.colId] = w.raw;
      return { ...r, values: merged };
    }) : prev);
  }

  /** Optimistic single-row PATCH, undoable. Before-values are captured from
   *  local state ahead of the optimistic write; the formula path passes
   *  `opts.before` instead — engine setCell's { previous } return, which is
   *  the authoritative overwritten value (built for exactly this wave).
   *
   *  opts.guard — THE Phase 5c concurrency opt-in, and the one central spot
   *  deciding who sends `expect`. Only the single-cell commit paths
   *  (commitEditorValue / commitCellText — they know the exact stored value
   *  the user saw and replaced) set it; `before` doubles as `expect`, so the
   *  server refuses the write (409) when another client changed that cell
   *  first. Every other write path — paste, fill, clear, bulk ops, undo/redo
   *  replay, the picker cells (link/person/attachment) and the row drawer —
   *  stays unconditional ON PURPOSE: overwriting a range is those gestures'
   *  explicit intent, and a per-cell refusal mid-gesture would shred it into
   *  a patchwork of applied and refused cells. */
  async function patchRow(rowId: string, values: Record<string, unknown>, opts?: { before?: Record<string, unknown>; label?: string; hostApplied?: boolean; guard?: boolean }) {
    if (!tableId) return;
    const prevRow = (rowsRef.current ?? []).find((r) => r.id === rowId);
    const before: Record<string, unknown> = {};
    for (const k of Object.keys(values)) {
      // An absent key restores as null: indistinguishable to every reader
      // (both are the empty cell) and Json cannot hold undefined anyway.
      before[k] = (opts?.before && k in opts.before ? opts.before[k] : prevRow?.values[k]) ?? null;
    }
    // Host before mirror. The formula commit path already ran the host's
    // setCell itself (it needed { previous }); hostApplied skips the
    // duplicate recalc pass.
    if (!opts?.hostApplied) {
      driveHostWrites(Object.entries(values).map(([colId, raw]) => ({ colId, rowId, raw })));
    }
    commitRows((prev) => prev ? prev.map((r) => r.id === rowId ? { ...r, values: { ...r.values, ...values } } : r) : prev);
    try {
      // Queued: two rapid commits to one cell must persist in action
      // order, not response order (the recorded last-write-loses race).
      // `before` is safe as `expect` even under queuing: it was captured
      // from the mirror at call time, and the mirror already held every
      // earlier queued edit's optimistic value, so back-to-back edits to
      // one cell from THIS client can never self-conflict. Its
      // null-for-absent normalization matches the server's compare
      // (absence and null are the same empty cell, never a conflict).
      const res = await writeQueueRef.current.run(() => fetch(`/api/tables/${tableId}/rows`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: rowId, values, ...(opts?.guard ? { expect: before } : {}) }),
      }));
      // 409 = the guard refused the write: NOTHING landed on the server.
      // Server truth replaces the optimistic value — the user's rejected
      // input is dropped, the same outcome Sheets gives on refresh — and
      // the early return keeps the rejected write out of history: pushUndo
      // below only ever runs after an APPLIED write, so no entry exists to
      // pop, and Ctrl+Z can never “restore” a value the server never left.
      if (res.status === 409) {
        const d = await res.json().catch(() => null);
        const payload = d?.data ?? d;
        const current = typeof payload?.current === "object" && payload.current !== null && !Array.isArray(payload.current)
          ? (payload.current as Record<string, unknown>)
          : null;
        const conflictCols: string[] = Array.isArray(payload?.conflictCols)
          ? (payload.conflictCols as unknown[]).filter((c): c is string => typeof c === "string")
          : Object.keys(values); // body lacks the list: the vouched-for cells are the conflict set
        if (current) absorbConflictRow(rowId, current, conflictCols);
        else void load(); // conflict body unreadable — reload is the reconcile
        toast("Cell updated by someone else — showing the latest value");
        return;
      }
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
    // Deliberately NO driveHostWrites here: these writes ORIGINATE from the
    // host's own rewrite pass (its model already holds them), so pushing
    // them back through setCells would only burn a redundant recalc.
    commitRows((prev) => prev ? prev.map((r) => byRow.has(r.id) ? { ...r, values: { ...r.values, ...byRow.get(r.id)! } } : r) : prev);
    const updates = [...byRow].map(([id, values]) => ({ id, values }));
    try {
      // Queued value write: an undo's restore enqueued a moment later must
      // land after these rewrites, never under them.
      const missing = new Set<string>();
      await writeQueueRef.current.run(async () => {
        for (let i = 0; i < updates.length; i += BATCH_MAX_OPS) {
          const res = await fetch(`/api/tables/${tableId}/rows/batch`, {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ updates: updates.slice(i, i + BATCH_MAX_OPS) }),
          });
          if (!res.ok) throw new Error();
          for (const mid of await readBatchMissingIds(res)) missing.add(mid);
        }
      });
      noteRowsDeletedElsewhere(missing);
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
    // ONE setCells pass clears every cell in the host before the paint —
    // a select-all clear is one recalc, not one per cell.
    driveHostWrites(cells.map((c) => ({ colId: c.colId, rowId: c.rowId, raw: null })));
    commitRows((prev) => prev ? prev.map((r) => byRow.has(r.id) ? { ...r, values: { ...r.values, ...byRow.get(r.id)! } } : r) : prev);
    const updates = [...byRow].map(([id, values]) => ({ id, values }));
    try {
      // Sequential slices riding one queued job: a failure part-way stops
      // the rest, the reload in the catch reconciles whatever did land —
      // the UI never keeps an optimistic clear the server rejected — and
      // no other value write can interleave between the slices.
      const missing = new Set<string>();
      await writeQueueRef.current.run(async () => {
        for (let i = 0; i < updates.length; i += BATCH_MAX_OPS) {
          const res = await fetch(`/api/tables/${tableId}/rows/batch`, {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ updates: updates.slice(i, i + BATCH_MAX_OPS) }),
          });
          if (!res.ok) throw new Error();
          for (const mid of await readBatchMissingIds(res)) missing.add(mid);
        }
      });
      const beforeUpdates = [...befores].map(([id, values]) => ({ id, values }));
      pushUndo({
        label: `clear ${cells.length} cell${cells.length === 1 ? "" : "s"}`,
        undo: () => writeValuesBatchStrict(beforeUpdates),
        redo: () => writeValuesBatchStrict(updates),
      });
      noteRowsDeletedElsewhere(missing);
    } catch { toast("Couldn't clear cells"); void load(); }
  }

  /** Per-cell formatting write (the B/I/U/S, colour, fill and align
   *  toolbar): apply one style patch to every cell of a rectangle.
   *
   *  Each touched row is a READ-MODIFY-WRITE of its whole "$fmt" map —
   *  the server merge is shallow, so the map is the unit of persistence,
   *  never a single cell's entry. The write is unconditional (no expect:
   *  a style is the user's explicit intent over the range, and a per-row
   *  409 mid-gesture would shred it), undoable as ONE command across all
   *  N rows (before = each row's old map, after = its new map), and rides
   *  writeValuesBatchStrict so the mirror repaints at once — the engine
   *  host never sees it (driveHostWrites filters the reserved key; styles
   *  don't recalc, so no bump is needed). A fully-cleared map writes null
   *  rather than dropping the key: the shallow merge can't delete, and
   *  every reader treats null as "no styles". */
  async function formatCells(
    targets: { rowIds: string[]; colIds: string[] },
    label: string,
    patch: Partial<Record<keyof CellStyle, unknown>>,
  ) {
    if (!tableId) return;
    const byId = new Map((rowsRef.current ?? []).map((r) => [r.id, r]));
    const befores: { id: string; values: Record<string, unknown> }[] = [];
    const afters: { id: string; values: Record<string, unknown> }[] = [];
    for (const rowId of targets.rowIds) {
      const row = byId.get(rowId);
      if (!row) continue; // deleted since the selection settled — skip, never invent a row
      let values = row.values;
      for (const colId of targets.colIds) values = withCellStyle(values, colId, patch);
      const oldMap = row.values[CELL_STYLE_KEY] ?? null;
      const newMap = values[CELL_STYLE_KEY] ?? null;
      if (sameStyleMap(oldMap, newMap)) continue; // already styled this way — no write, no history
      befores.push({ id: rowId, values: { [CELL_STYLE_KEY]: oldMap } });
      afters.push({ id: rowId, values: { [CELL_STYLE_KEY]: newMap } });
    }
    if (afters.length === 0) return;
    try {
      await writeValuesBatchStrict(afters);
      pushUndo({
        label,
        undo: () => writeValuesBatchStrict(befores),
        redo: () => writeValuesBatchStrict(afters),
      });
    } catch { toast("Couldn't apply formatting"); void load(); }
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
    let hostOk = true;
    try {
      for (const id of ids) {
        const res = engineHostRef.current!.rowDeleted(id); // ref: the confirm await can span a swap
        for (const rw of res.rewritten.cells) {
          if (doomed.has(rw.rowId)) continue;
          cellRewrites.set(`${rw.rowId}:${rw.colId}`, rw);
        }
        for (const cw of res.rewritten.columns) colRewrites.set(cw.colId, cw.formula);
      }
    } catch { hostOk = false; /* never block the delete — the rebuild below recovers */ }
    // Full snapshots BEFORE the optimistic removal — plan 3a names undo as
    // the REQUIRED mitigation for this unrecoverable deleteMany. Positions
    // ride along and are sent as EXPLICIT insert positions on undo, so
    // restored rows land exactly where they were, not at the end.
    // rowsRef, not render-scope rows: the confirm await above spans user
    // time, and a paste chunk or refetch landing meanwhile would make a
    // pre-dialog snapshot restore stale values on undo.
    const snapshots = (rowsRef.current ?? [])
      .filter((r) => doomed.has(r.id))
      .map((r) => ({ values: { ...r.values }, position: r.position }));
    // Survivors' PRE-rewrite stored values, captured before the optimistic
    // apply: with exact-position restore below, an undo puts every ref back
    // on the row it originally named, so the #REF! rewrites can be honestly
    // reverted instead of left behind.
    const liveById = new Map((rowsRef.current ?? []).map((r) => [r.id, r]));
    const survivorBefores = [...cellRewrites.values()].map((rw) => ({
      rowId: rw.rowId,
      colId: rw.colId,
      before: liveById.get(rw.rowId)?.values?.[rw.colId] ?? null,
      after: rw.stored,
    }));
    // Same one-frame discipline as deleteRow: removals + survivor rewrites
    // apply together locally; persistence still waits for the deletes.
    const rwByRow = groupRewrites([...cellRewrites.values()]);
    commitRows((prev) => prev
      ? prev.filter((r) => !doomed.has(r.id)).map((r) => rwByRow.has(r.id) ? { ...r, values: { ...r.values, ...rwByRow.get(r.id)! } } : r)
      : prev);
    if (hostOk) bumpEngine();
    else rebuildEngine(tableRef.current?.columns ?? [], rowsRef.current ?? []);
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
    // rowsRef, not render-scope rows: the confirm await can span mutations.
    const snapshot = (rowsRef.current ?? []).find((r) => r.id === rowId);
    const snapValues = snapshot ? { ...snapshot.values } : null;
    let res: StructureResult | null = null;
    try { res = engineHostRef.current?.rowDeleted(rowId) ?? null; } catch { /* never block the delete */ }
    // Removal and the survivors' ref rewrites land in ONE local update, so no
    // frame renders shifted rows against un-shifted refs. The server write of
    // the rewrites still waits for the delete to succeed: if the delete
    // fails, nothing rewritten was persisted and the reload restores truth.
    const rwByRow = groupRewrites(res?.rewritten.cells ?? []);
    commitRows((prev) => prev
      ? prev.filter((r) => r.id !== rowId).map((r) => rwByRow.has(r.id) ? { ...r, values: { ...r.values, ...rwByRow.get(r.id)! } } : r)
      : prev);
    if (res) bumpEngine();
    else rebuildEngine(tableRef.current?.columns ?? [], rowsRef.current ?? []);
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

  /** Move a row to a new index — the gutter drag AND both undo bodies run
   *  through this one path, so a move and its inverse rewrite formulas
   *  identically. STRICT: throws on persist failure (undo needs truth).
   *
   *  Ordering is the deleteColumn discipline: (1) drive the host FIRST so
   *  ref rewrites are computed against the pre-move layout ("=A5" must
   *  keep meaning the row that moved, refs in between must shift by one —
   *  losing one silently is the catastrophic bug); (2) renumber + reorder
   *  the local mirror to match storage order; (3) persist positions;
   *  (4) persist the host's rewrites (cells via the strict batch value
   *  path, column formulas via saveColumnsStrict).
   *
   *  Position renumbering is a ROTATION of the positions the span already
   *  held: post-move row i of the span takes the i-th pre-move position.
   *  The moved row therefore lands on the target row's old position and
   *  every in-between row shifts one slot toward the vacated one — no new
   *  numbers are minted, so uniqueness and any historical gaps (deleted
   *  rows) survive, and position order keeps matching display order.
   *
   *  Indices here are STORAGE indices (rowsRef order). The gesture may
   *  only translate a display index into one while display order == storage
   *  order — that is why the page withholds onRowMove under sort/filter/
   *  search/stream — but an undo replay is safe even if the user has since
   *  sorted: it re-runs in storage terms and the display just re-sorts. */
  async function performRowMoveStrict(rowId: string, toIndex: number) {
    if (!tableId) throw new Error("no table");
    const cur = rowsRef.current;
    if (!cur) throw new Error("rows gone");
    const from = cur.findIndex((r) => r.id === rowId);
    if (from < 0) return; // row deleted since — no-op, never corrupt
    const to = Math.max(0, Math.min(cur.length - 1, toIndex));
    if (from === to) return;

    // (1) Host first. A thrown rewrite must never block the move; the
    // rebuild below recovers coherence from the reordered mirror.
    let res: StructureResult | null = null;
    try { res = engineHostRef.current?.rowMoved(rowId, to) ?? null; } catch { res = null; }

    // (2) Reorder the mirror + rotate positions across the span.
    const next = [...cur];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    const lo = Math.min(from, to);
    const hi = Math.max(from, to);
    const spanPositions = cur.slice(lo, hi + 1).map((r) => r.position);
    const posUpdates: { id: string; values: Record<string, unknown>; position: number }[] = [];
    for (let i = lo; i <= hi; i++) {
      const p = spanPositions[i - lo];
      if (next[i].position !== p) {
        next[i] = { ...next[i], position: p };
        // values: {} — the batch route treats a keyless entry as
        // position-only and writes nothing else for it.
        posUpdates.push({ id: next[i].id, values: {}, position: p });
      }
    }
    commitRows(next);
    if (res) bumpEngine();
    else rebuildEngine(tableRef.current?.columns ?? [], next);

    // (3) Positions AND cell rewrites merge into the SAME batch entries —
    // the route writes values+position per row in one transaction, so a
    // network drop can no longer land the new order while the old formula
    // text survives (the silent-repoint catastrophe an unpersisted rewrite
    // causes). Chunks only split past MAX_OPS, shrinking the torn window
    // to >500-op spans; one queued job keeps other writes from
    // interleaving between the slices of one logical move. A refused chunk
    // throws: the caller toasts and reloads, the reload reconciles.
    const mergedOps = new Map<string, { id: string; values: Record<string, unknown>; position?: number }>();
    for (const u of posUpdates) mergedOps.set(u.id, { id: u.id, values: {}, position: u.position });
    if (res && res.rewritten.cells.length > 0) {
      for (const u of rewritesToUpdates(res.rewritten.cells)) {
        const e = mergedOps.get(u.id);
        if (e) e.values = { ...e.values, ...u.values };
        else mergedOps.set(u.id, { id: u.id, values: u.values });
      }
    }
    const moveOps = [...mergedOps.values()];
    await writeQueueRef.current.run(async () => {
      for (let i = 0; i < moveOps.length; i += BATCH_MAX_OPS) {
        const r = await fetch(`/api/tables/${tableId}/rows/batch`, {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ updates: moveOps.slice(i, i + BATCH_MAX_OPS) }),
        });
        if (!r.ok) throw new Error(`batch move HTTP ${r.status}`);
      }
    });

    // (4) Column-formula rewrites live on the TABLE record, not the data
    // rows, so they cannot join the batch transaction above — that narrow
    // window (row-anchored ranges inside COLUMN formulas only) remains,
    // and a failed save still throws into the caller's toast+reload.
    if (res && res.rewritten.columns.length > 0) {
      const curT = tableRef.current;
      if (curT) {
        await saveColumnsStrict(applyColumnRewrites(curT.columns, res.rewritten.columns), { hostAlreadyCurrent: true });
      }
    }
  }

  /** The gutter-drag entry point. Undo moves the row back through the SAME
   *  strict path — the live host then rewrites every ref back, and those
   *  reverted rewrites persist exactly like the forward ones did (the
   *  deleteColumn revert discipline, achieved by inversion rather than
   *  snapshots, because a move — unlike a delete — loses nothing). */
  function moveRowByDrag(rowId: string, toDisplayIndex: number) {
    const cur = rowsRef.current ?? [];
    const from = cur.findIndex((r) => r.id === rowId);
    const to = Math.max(0, Math.min(cur.length - 1, toDisplayIndex));
    if (from < 0 || from === to) return;
    void (async () => {
      try {
        await performRowMoveStrict(rowId, to);
        pushUndo({
          label: "move row",
          undo: () => performRowMoveStrict(rowId, from),
          redo: () => performRowMoveStrict(rowId, to),
        });
      } catch { toast("Couldn't move row — reloading"); void load(); }
    })();
  }

  /** Row-menu "Insert 1 row above/below" (Sheets). No new server code:
   *  append a blank row through the existing create path (the server
   *  allocates its position), then move it into place through
   *  performRowMoveStrict — the SAME path the gutter drag uses, so refs
   *  at/below the slot shift by one exactly like a Sheets insert. ONE
   *  undo command: undo deletes that row (strict), redo re-inserts and
   *  re-targets against the anchor row as it sits THEN (ids, not indices,
   *  survive intervening edits; a vanished anchor lands the row at the
   *  end rather than guessing). Gated like row moves: a storage index is
   *  only a display index while nothing reorders the display. */
  function insertRowNear(anchorRowId: string, where: "above" | "below") {
    if (sortState || filterCol || search.trim() || streamProgress) {
      toast("Clear the sort, filter and search to insert rows");
      return;
    }
    const targetIndex = () => {
      const cur = rowsRef.current ?? [];
      const idx = cur.findIndex((r) => r.id === anchorRowId);
      if (idx < 0) return Math.max(0, cur.length - 1);
      return where === "above" ? idx : idx + 1;
    };
    void (async () => {
      let curId: string | null = null;
      try {
        const target = targetIndex();
        const created = await insertRowsBatchStrict([{ values: {} }]);
        curId = created[0]?.id ?? null;
        if (!curId) throw new Error("no row created");
        // The append sits at the end; moving to the last index is the
        // no-op performRowMoveStrict already short-circuits ("below" the
        // last row).
        await performRowMoveStrict(curId, target);
        pushUndo({
          label: `insert row ${where}`,
          undo: async () => { if (curId) await deleteRowsBatchStrict([curId]); },
          redo: async () => {
            const again = await insertRowsBatchStrict([{ values: {} }]);
            curId = again[0]?.id ?? null;
            if (!curId) throw new Error("no row created");
            await performRowMoveStrict(curId, targetIndex());
          },
        });
      } catch {
        // A row may have been appended but not moved: the reload
        // reconciles (it renders at the end, honestly), and nothing
        // half-done enters history.
        toast("Couldn't insert row — reloading");
        void load();
      }
    })();
  }

  /** Row-menu "Clear row(s)": null into every editable cell of the row(s)
   *  through the existing clear path (undoable, setCells so dependents
   *  recompute). Computed columns are skipped exactly as the kernel's
   *  Delete key skips them. Formatting is left alone — Sheets' "Clear
   *  row" clears contents, not styles. */
  function clearRows(rowIds: string[]) {
    const cur = tableRef.current ?? table;
    if (!cur) return;
    const editable = cur.columns.filter((c) => c.type !== "formula" && c.type !== "lookup" && c.type !== "rollup");
    const cells = rowIds.flatMap((rowId) => editable.map((c) => ({ rowId, colId: c.id })));
    if (cells.length === 0) return;
    void clearCells(cells);
  }

  /** Header-menu "Clear column": the column-shaped twin of clearRow. A
   *  computed column has nothing to clear (its cells are derived). */
  function clearColumn(colId: string) {
    // A column spans every row; mid-stream the tail hasn't arrived, and a
    // clear of the loaded half would be a silently partial clear.
    if (streamProgress) { toast("Rows are still loading, try again in a moment"); return; }
    const cur = tableRef.current ?? table;
    const col = cur?.columns.find((c) => c.id === colId);
    if (!col) return;
    if (col.type === "formula" || col.type === "lookup" || col.type === "rollup") {
      toast("This column is computed — edit its formula or relation instead");
      return;
    }
    const cells = (rowsRef.current ?? []).map((r) => ({ rowId: r.id, colId }));
    if (cells.length === 0) return;
    void clearCells(cells);
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
    // Streaming honesty gate: a CSV cut mid-stream would be a silently
    // partial table, and computed cells would read a stale engine. Refuse
    // out loud instead; the stream completes in seconds.
    if (streamProgress) { toast("Rows are still loading, try again in a moment"); return; }
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

  // The persistent host lives in engineHostRef (declared with the mutation
  // helpers above). Lazy-created here so the very first render — before
  // load() delivers data and swaps in the real one — still has a host to
  // read from; writing a ref during render is React's sanctioned lazy-init
  // pattern, and it runs exactly once.
  if (engineHostRef.current === null) {
    engineHostRef.current = createTableEngine({ columns: table?.columns ?? [], rows: rows ?? [] });
  }
  const engineHost = engineHostRef.current;

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
    // The persistent host mutates in place; engineVersion is its change
    // signal (the host's identity only changes on a swap).
    void engineVersion;
    const cols = table?.columns ?? [];
    let list = rows ?? [];
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      list = list.filter((r) =>
        cols.some((c) => {
          const v = r.values[c.id];
          if (v === undefined || v === null) return false;
          // Search matches what the user SEES in a formula cell, not its
          // stored object. Mid-stream the host is empty (fresh) or one
          // world behind (refetch), so formula cells sit search-dark until
          // the set completes rather than matching against stale values.
          const text = isFormulaCell(v)
            ? (streamProgress ? "" : String(engineHost.display(c.id, r.id) ?? ""))
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
  }, [rows, table?.columns, search, filterCol, filterValue, engineHost, engineVersion, streamProgress]);

  const sortedRows = useMemo(() => {
    void engineVersion; // computed sort keys change when the host mutates
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
  }, [filteredRows, sortState, table?.columns, engineHost, relationalValue, engineVersion]);

  /* ── Selection stats (Sheets' bottom-right readout) ──────────────
   * Values for the selected rectangle: literals from row.values, computed
   * cells (formula/lookup/rollup columns, or a raw {"=": src} cell)
   * through the engine host. Aggregation itself is lib/sheet-stats. */
  const statsText = useMemo(() => {
    void engineVersion; // computed values change when the host mutates in place
    // Mid-stream the host holds a partial (or previous) row set. A sum
    // over that set is a lie, so the readout gates out entirely.
    if (streamProgress) return null;
    if (!gridSelection || !table) return null;
    // Clamp the span: a payload can outlive a column delete by a frame.
    const cols = table.columns.slice(
      Math.max(0, Math.min(gridSelection.c1, gridSelection.c2)),
      Math.max(gridSelection.c1, gridSelection.c2) + 1,
    );
    const cellCount = gridSelection.rowIds.length * cols.length;
    if (cellCount < 2) return null; // single cell or empty: Sheets shows nothing
    // Work cap: past 100k cells the value walk (every computed cell is an
    // engine read) can stall the frame the selection settles on. The cell
    // count needs only arithmetic, so show it and skip the reads.
    if (cellCount > 100_000) return `Cells: ${cellCount.toLocaleString()}`;
    const values: unknown[] = [];
    for (const rowId of gridSelection.rowIds) {
      const r = rowById.get(rowId);
      if (!r) continue; // stale id (row deleted after the payload fired): empty
      for (const c of cols) {
        values.push(
          // Lookup/rollup are computed display-time from linked tables — the
          // engine host has no relational awareness, so reading it here would
          // yield null for cells the grid shows as numbers.
          c.type === "lookup" || c.type === "rollup"
            ? relationalValue(c, r)
            : c.type === "formula" || isFormulaCell(r.values[c.id])
              // Errors flatten to code strings; the lib keeps them out of numerics.
              ? engineHost.value(c.id, r.id)
              : r.values[c.id],
        );
      }
    }
    const s = selectionStats(values);
    if (!s) return null; // fewer than 2 non-empty cells: nothing to say
    // Plain locale numbers on purpose: Sheets does not carry the column's
    // format into this readout either.
    const fmt = (n: number) => n.toLocaleString(undefined, { maximumFractionDigits: 4 });
    return s.numeric >= 2
      ? `Sum: ${fmt(s.sum)} · Avg: ${fmt(s.avg)} · Min: ${fmt(s.min)} · Max: ${fmt(s.max)} · Count: ${s.numeric.toLocaleString()}`
      : `Count: ${s.nonEmpty.toLocaleString()}`;
  }, [gridSelection, engineVersion, streamProgress, table, rowById, engineHost, relationalValue]);

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

  /** The cells a per-cell format action targets: the kernel's settled
   *  range (ORDERED display rowIds × the inclusive column span, via
   *  onSelectionChange), else the active cell — the kernel reports null
   *  for a single-cell selection, so the active cell IS that case. */
  const formatTargets = (): { rowIds: string[]; colIds: string[] } | null => {
    if (gridSelection && gridSelection.rowIds.length > 0) {
      const lo = Math.max(0, Math.min(gridSelection.c1, gridSelection.c2));
      const hi = Math.min(table.columns.length - 1, Math.max(gridSelection.c1, gridSelection.c2));
      const colIds = table.columns.slice(lo, hi + 1).map((c) => c.id);
      if (colIds.length > 0) return { rowIds: gridSelection.rowIds, colIds };
    }
    if (activeCell) return { rowIds: [activeCell.rowId], colIds: [activeCell.colId] };
    return null;
  };

  /** Apply one style patch to the selection (colour, fill, align — the
   *  "set" actions). Mid-stream the toolbar pills are disabled, but the
   *  keyboard path lands here too, so the gate is repeated: a style write
   *  is a read-modify-write of rows the stream may not have delivered. */
  const formatSelection = (label: string, patch: Partial<Record<keyof CellStyle, unknown>>) => {
    if (streamProgress) { toast("Rows are still loading, try again in a moment"); return; }
    const targets = formatTargets();
    if (!targets) { toast("Select a cell first"); return; }
    void formatCells(targets, label, patch);
  };

  /** B / I / U / S with Sheets' toggle rule: when EVERY selected cell
   *  already carries the flag it comes off all of them, otherwise it goes
   *  on all of them (a mixed range becomes uniformly styled, never
   *  inverted cell by cell). */
  const toggleStyleFlag = (flag: "b" | "i" | "u" | "s") => {
    if (streamProgress) { toast("Rows are still loading, try again in a moment"); return; }
    const targets = formatTargets();
    if (!targets) { toast("Select a cell first"); return; }
    // Judge against the sync mirror (what formatCells writes from), not
    // render-scope state: two toggles in one tick must see each other.
    const live = new Map((rowsRef.current ?? []).map((r) => [r.id, r]));
    let every = true;
    outer: for (const rowId of targets.rowIds) {
      const row = live.get(rowId);
      for (const colId of targets.colIds) {
        if (!readCellStyle(row?.values, colId)?.[flag]) { every = false; break outer; }
      }
    }
    const name = STYLE_FLAG_NAMES[flag];
    void formatCells(targets, every ? `remove ${name}` : name, { [flag]: every ? undefined : true });
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
      // Streaming honesty gate: while a multi-chunk stream is in flight the
      // host still holds the pre-stream world, so any computed value would
      // come from a partial (or previous) row set. Neutral pending mark
      // until the completion rebuild lands.
      if (streamProgress) return <span style={{ color: "var(--os-ink-3)" }}>…</span>;
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
      // short_text (an open column can hold a real number since entry-time
      // typing), long_text, url, email. A number renders as plain String(n):
      // Sheets shows "1000", not "1,000", until the user asks for a format,
      // and the open column has no format to ask. Right-alignment for that
      // number is cellStyleFor's job.
      default: return v == null || v === "" ? null : String(v);
    }
  };

  /** Inline style for one cell: the cell's own "$fmt" styles (bold /
   *  italic / underline / strike / colour / fill / align) with the
   *  conditional-formatting rule background (Phase 4) layered on top.
   *  Precedence is Sheets': a matching RULE background beats the cell's
   *  manual fill, text styles always apply. Rules read the RAW value
   *  (computed for formula cells) — formatting never feeds back into
   *  rules. The winning rule colour paints at ~18% alpha (hex "2E"), the
   *  same tint depth as the dept-chip pattern, so black text stays
   *  readable on any swatch. Both fills go out as backgroundColor (never
   *  the `background` shorthand): that is the one property the kernel
   *  drops for the ACTIVE cell, whose white ground keeps the editor and
   *  outline legible while its text styles still show. */
  const cellStyleFor = (rowId: string, colId: string): React.CSSProperties | undefined => {
    const r = rowById.get(rowId);
    if (!r) return undefined;
    const style = readCellStyle(r.values, colId);
    const css: React.CSSProperties = styleToCss(style);
    const c = table.columns.find((x) => x.id === colId);
    // A number in an OPEN column right-aligns, like Sheets: that is how the
    // user can SEE that entry-time typing took their "5" as a number (a
    // left-aligned "5" is text). Only the default alignment does this: an
    // explicit align style ("a") from the toolbar always wins, because the
    // user chose it.
    if (c && isOpenColumnType(c.type) && !style?.a && typeof r.values[colId] === "number") css.textAlign = "right";
    if (c?.rules && c.rules.length > 0) {
      const v = r.values[c.id];
      // Streaming honesty gate: a rule must not paint from a computed value
      // we refuse to display (the host is stale until the completion rebuild).
      if (!(streamProgress && (c.type === "formula" || isFormulaCell(v)))) {
        const raw = c.type === "formula" || isFormulaCell(v) ? engineHost.value(c.id, r.id) : v;
        const bg = matchRule(raw, c.rules);
        if (bg) css.backgroundColor = /^#[0-9a-fA-F]{6}$/.test(bg) ? `${bg}2E` : bg;
      }
    }
    return Object.keys(css).length > 0 ? css : undefined;
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
      // Streaming honesty gate: copy copies what the user sees, and during
      // a stream that is the pending mark — never a stale computed value.
      if (streamProgress) return "…";
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

  /** The kernel's Ctrl/Cmd+Arrow data-edge jump asks "is this cell empty?"
   *  and the answer comes from the MIRROR, not the DOM: stored
   *  null/undefined/"" (or an empty list) is empty; a formula cell — a
   *  per-cell "=…" in any column, or any cell of a formula column — is
   *  NON-empty even when it evaluates to "", because Sheets stops on a
   *  formula (the cell has content). Numbers and booleans are content
   *  (an unchecked checkbox is FALSE, not blank). Computed relational
   *  columns answer with the same text the clipboard reads, so what copies
   *  as "" also jumps as empty. */
  // Cmd+Arrow across a long column calls this per cell: O(1) column lookup.
  // Plain Map, not useMemo — this sits after the component's early returns
  // where hooks are illegal; a few dozen columns per render is nothing.
  const colByIdForEmpty = new Map(table.columns.map((c) => [c.id, c]));
  const isCellEmpty = (rowId: string, colId: string): boolean => {
    const r = rowById.get(rowId);
    if (!r) return true;
    const v = r.values[colId];
    if (isFormulaCell(v)) return false;
    const c = colByIdForEmpty.get(colId);
    if (c?.type === "formula") return false;
    if (c && (c.type === "lookup" || c.type === "rollup")) return cellText(c, r) === "";
    if (Array.isArray(v)) return v.length === 0;
    return v == null || v === "";
  };

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
      // ONE setCells pass for the whole paste/fill before the paint — this
      // is the batch path the Phase 5 seam work exists for: a 500-cell
      // paste is one recalc, not 500 engine rebuilds.
      driveHostWrites(updates.flatMap((u) => Object.entries(u.values).map(([colId, raw]) => ({ colId, rowId: u.id, raw }))));
      commitRows((prev) => prev ? prev.map((r) => {
        const patch = updatesByRow.get(r.id);
        return patch ? { ...r, values: { ...r.values, ...patch } } : r;
      }) : prev);
    }

    const missingRows = new Set<string>();
    try {
      // Sequential slices at the server's per-kind cap, exactly like
      // clearCells/bulkDeleteRows: a failure part-way stops the rest and the
      // reload below reconciles whatever did commit.
      // The route commits updates + inserts in ONE transaction, so when the
      // whole paste fits in a single call, send both keys together and keep
      // that guarantee. Only an oversized paste has to be split, and then
      // the reload below reconciles whatever committed.
      // The whole sequence rides ONE queued job (it carries value updates,
      // which must not race other value writes); created rows are absorbed
      // as each response lands, exactly as before.
      await writeQueueRef.current.run(async () => {
        const oneShot = updates.length <= BATCH_MAX_OPS && realInserts.length <= BATCH_MAX_OPS;
        for (let i = 0; !oneShot && i < updates.length; i += BATCH_MAX_OPS) {
          const res = await fetch(`/api/tables/${tableId}/rows/batch`, {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ updates: updates.slice(i, i + BATCH_MAX_OPS) }),
          });
          if (!res.ok) throw new Error();
          for (const mid of await readBatchMissingIds(res)) missingRows.add(mid);
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
          // Body already consumed for `inserted`; mine the SAME parse for
          // missingIds (a Response body reads once).
          for (const mid of missingIdsOf(payload)) missingRows.add(mid);
          const created: ApiRow[] = (Array.isArray(payload?.inserted) ? payload.inserted : [])
            .map((r: { id: string; values: unknown; position: number }) => ({
              id: r.id,
              values: (r.values ?? {}) as Record<string, unknown>,
              position: r.position,
            }));
          createdRows.push(...created);
          absorbCreatedRows(created);
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
          absorbCreatedRows(created);
        }
      });
    } catch {
      toast("Couldn't paste — reloading the table");
      void load();
      // Rethrow: the grid's runApply catches this and returns false, so it
      // won't move the selection as though the write had landed.
      throw new Error("batch write failed");
    }

    // Rows the route named in missingIds were deleted by another client
    // mid-paste; the cells pasted onto them are gone. Surface + reload, but
    // keep the undo entry below: replaying it is stale-tolerant (deleted
    // targets no-op) and still restores every surviving row.
    noteRowsDeletedElsewhere(missingRows);

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

  /** Sheets-pure header: the column LETTER, centered, and nothing else —
   *  no label line, no hover icon cluster ("We are building it like
   *  Excel"). The letter doubles as the drag-to-reorder handle; the right
   *  edge stays the resize grip. Every column OPERATION the old hover
   *  icons carried (edit formula, configure relation, delete, plus sort)
   *  moved to the header's right-click menu (onHeaderContextMenu). The
   *  format/highlight-rules popover that used to open here is gone
   *  entirely — the toolbar's 123/$/%/decimals cluster is the one
   *  number-format surface, and existing highlight rules KEEP PAINTING
   *  through cellStyleFor; only their editor died. */
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
          title={`Column ${columnLetter(colIndex)} · drag to reorder · right-click for options`}
          draggable
          onDragStart={() => setDragColId(c.id)}
          onDragEnd={() => setDragColId(null)}
          style={{ cursor: "grab", textAlign: "center", fontWeight: 600, fontSize: 12.5, lineHeight: "18px", color: "#3f3f46" }}
        >{columnLetter(colIndex)}</span>
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
        const res = (engineHostRef.current ?? engineHost).setCell(colId, rowId, trimmed);
        // The setCell above IS the host drive — incremental, only the
        // transitive dependents recomputed — so patchRow skips its own
        // pass (hostApplied). Computed values are never sent to the
        // server. res.previous — the engine's authoritative overwritten
        // value — seeds the undo command.
        bumpEngine();
        void patchRow(rowId, { [colId]: res.stored }, { before: { [colId]: res.previous }, label: "formula edit", hostApplied: true, guard: true });
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
    // Guarded (Phase 5c): this path knows the exact stored value it is
    // replacing — see patchRow's guard note for the full opt-in policy.
    void patchRow(rowId, { [colId]: res.value }, { guard: true });
  };

  /** Text editors commit through here so "=…" becomes a stored formula even
   *  when the editor was opened plain (F2 first, "=" typed after) — the
   *  seed path below only catches type-to-replace. */
  const commitEditorValue = (rowId: string, colId: string, v: unknown) => {
    if (typeof v === "string" && v.trimStart().startsWith("=")) {
      commitCellText(rowId, colId, v);
      return;
    }
    // Entry-time typing (lib/sheet-entry): in an OPEN column the plain
    // editor's "5" is stored as the number 5: Sheets' rule, and the only
    // way SUM(A1:A3) over a fresh sheet can ever be non-zero, because the
    // engine deliberately reads numeric TEXT as a number in numeric-typed
    // columns only. Every other type stores what its editor produced.
    const col = table.columns.find((c) => c.id === colId);
    const typed = col && isOpenColumnType(col.type) && typeof v === "string" ? autoTypeEntry(v) : v;
    // Legacy note: a cell that still holds the STRING "5" (typed before this
    // rule existed) re-committed untouched becomes the number 5. That is a
    // real write on purpose (it upgrades the text to the number the user
    // always meant) and it cannot false-409: patchRow builds `expect` from
    // the STORED value ("5"), which is exactly what the server still holds.
    // Guarded (Phase 5c): see patchRow's guard note for the opt-in policy.
    void patchRow(rowId, { [colId]: typed }, { guard: true });
  };

  const kernelEditor = (rowId: string, colId: string, opts: { seed: string | null; commit: () => void }) => {
    const r = rowById.get(rowId);
    const c = table.columns.find((x) => x.id === colId);
    if (!r || !c) return null;
    // A formula cell always edits as its SOURCE (never the computed value —
    // the user must see what their edit replaces), and a "=" seed opens the
    // formula editor in ANY editable cell: number/date/choice editors cannot
    // even type "=", so the formula editor takes over for them.
    // Raw stored shape FIRST: during a multi-chunk stream (or a refetch's
    // stale window) the host doesn't know this table's cells yet, and a
    // plain editor opened on an unrecognized formula cell would commit a
    // literal over it — silent destruction. The {"=": ...} shape is
    // stream-independent truth; the host only ADDS formula-column fills.
    const rawStored = r.values[colId];
    const rawFormula = isFormulaCell(rawStored);
    const hasFormula = rawFormula || engineHost.isFormulaCell(colId, rowId);
    const formulaSeed = opts.seed != null && opts.seed.trimStart().startsWith("=");
    if (hasFormula || formulaSeed) {
      // cellSource returns "=SRC" (with the "=") for any computed cell. ANY
      // seed wins over the source — type-to-replace on a formula cell starts
      // from what was typed, exactly like the plain editors — while the
      // commit baseline stays the ORIGINAL source, so a seeded value that is
      // left as-is still commits (and Escape still cancels via the ref).
      // The raw source outranks the host's: raw is current-world truth even
      // while the host is empty (fresh stream) or one world behind (refetch).
      const src = hasFormula
        ? (rawFormula ? `=${rawStored[FORMULA_KEY]}` : String(engineHost.cellSource(colId, rowId) ?? "="))
        : "";
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
  // The toolbar's B/I/U/S/colour/align pills reflect the ACTIVE cell's
  // stored style (Sheets lights the pill when the cursor sits on bold).
  const activeStyle = activeCell ? readCellStyle(activeCellRow?.values, activeCell.colId) : undefined;
  const fmtDisabled = streamProgress !== null;
  // One predicate for the gutter-drag gate AND the row-insert menu items.
  const rowInsertBlocked = !!sortState || !!filterCol || !!search.trim() || streamProgress !== null;
  // Right-click INSIDE a multi-row selection acts on the whole span
  // (Sheets): the row menu's delete and clear both read this.
  const rowMenuSpan = rowMenu && gridSelection && gridSelection.rowIds.length > 1 && gridSelection.rowIds.includes(rowMenu.rowId)
    ? gridSelection.rowIds
    : null;
  // What the grid actually freezes: the persisted counts re-clamped against
  // the LIVE display (a filter can shrink the row list below the saved
  // freeze; the persisted value survives so clearing the filter restores
  // it). Display-index counts, so a sorted/filtered sheet freezes its first
  // N DISPLAYED rows, exactly like Sheets freezes by position.
  const gridFreeze = clampFreeze(freeze, sortedRows.length, table.columns.length);
  // "Freeze up to row N": N is the clicked row's DISPLAY number; offered
  // only while at least one row would remain scrollable, matching the
  // kernel's own clamp so the menu never promises a freeze it can't make.
  const rowMenuDisplayIdx = rowMenu ? sortedRows.findIndex((r) => r.id === rowMenu.rowId) : -1;
  const rowMenuCanFreeze = rowMenuDisplayIdx >= 0 && rowMenuDisplayIdx + 1 <= sortedRows.length - 1;
  const FMT_STREAM_TITLE = "Rows are still loading — formatting is available once they finish";
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
          today — each pill is traced to a handler, nothing is decorative. ── */}
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
        {/* Per-cell text styles (Sheets order: B I U S, colours, align).
            The toggles light up from the ACTIVE cell's stored style, like
            Sheets; each action is one undo entry across the whole range.
            Mid-stream they sit disabled: a style write is a read-modify-
            write of rows the stream may not have delivered yet. */}
        <button
          type="button"
          className={`shx__tb-btn ${activeStyle?.b ? "is-on" : ""}`}
          onClick={() => toggleStyleFlag("b")}
          disabled={fmtDisabled}
          title={fmtDisabled ? FMT_STREAM_TITLE : "Bold (⌘B)"}
          aria-label="Bold"
          aria-pressed={!!activeStyle?.b}
        ><Bold /></button>
        <button
          type="button"
          className={`shx__tb-btn ${activeStyle?.i ? "is-on" : ""}`}
          onClick={() => toggleStyleFlag("i")}
          disabled={fmtDisabled}
          title={fmtDisabled ? FMT_STREAM_TITLE : "Italic (⌘I)"}
          aria-label="Italic"
          aria-pressed={!!activeStyle?.i}
        ><Italic /></button>
        <button
          type="button"
          className={`shx__tb-btn ${activeStyle?.u ? "is-on" : ""}`}
          onClick={() => toggleStyleFlag("u")}
          disabled={fmtDisabled}
          title={fmtDisabled ? FMT_STREAM_TITLE : "Underline (⌘U)"}
          aria-label="Underline"
          aria-pressed={!!activeStyle?.u}
        ><Underline /></button>
        <button
          type="button"
          className={`shx__tb-btn ${activeStyle?.s ? "is-on" : ""}`}
          onClick={() => toggleStyleFlag("s")}
          disabled={fmtDisabled}
          title={fmtDisabled ? FMT_STREAM_TITLE : "Strikethrough"}
          aria-label="Strikethrough"
          aria-pressed={!!activeStyle?.s}
        ><Strikethrough /></button>
        {/* Colour pills open a compact swatch grid (not a native colour
            input — Sheets' palette is a grid of named chips). The bar
            under each icon shows the active cell's current colour. */}
        <details className="shx__dd">
          <summary
            className={`shx__tb-btn shx__tb-color ${fmtDisabled ? "is-disabled" : ""}`}
            title={fmtDisabled ? FMT_STREAM_TITLE : "Text color"}
            aria-label="Text color"
            aria-disabled={fmtDisabled || undefined}
            onClick={(e) => { if (fmtDisabled) e.preventDefault(); }}
          >
            <Baseline />
            <span className="shx__tb-colorbar" style={{ background: activeStyle?.c ?? "transparent" }} aria-hidden />
          </summary>
          <div className="shx__dd-menu shx__dd-menu--swatches" role="group" aria-label="Text colors">
            <div className="shx__swatches">
              {TEXT_SWATCHES.map((sw) => (
                <button
                  key={sw.hex}
                  type="button"
                  className={`shx__swatch ${activeStyle?.c?.toUpperCase() === sw.hex ? "is-on" : ""}`}
                  style={{ background: sw.hex }}
                  title={sw.name}
                  aria-label={`Text color ${sw.name}`}
                  onClick={(e) => { formatSelection(`text color ${sw.name.toLowerCase()}`, { c: sw.hex }); closeDetails(e); }}
                />
              ))}
            </div>
            <button type="button" className="shx__swatch-reset" onClick={(e) => { formatSelection("reset text color", { c: undefined }); closeDetails(e); }}>
              <X /> Reset
            </button>
          </div>
        </details>
        <details className="shx__dd">
          <summary
            className={`shx__tb-btn shx__tb-color ${fmtDisabled ? "is-disabled" : ""}`}
            title={fmtDisabled ? FMT_STREAM_TITLE : "Fill color"}
            aria-label="Fill color"
            aria-disabled={fmtDisabled || undefined}
            onClick={(e) => { if (fmtDisabled) e.preventDefault(); }}
          >
            <PaintBucket />
            <span className="shx__tb-colorbar" style={{ background: activeStyle?.bg ?? "transparent" }} aria-hidden />
          </summary>
          <div className="shx__dd-menu shx__dd-menu--swatches" role="group" aria-label="Fill colors">
            <div className="shx__swatches">
              {FILL_SWATCHES.map((sw) => (
                <button
                  key={sw.hex}
                  type="button"
                  className={`shx__swatch ${activeStyle?.bg?.toUpperCase() === sw.hex ? "is-on" : ""}`}
                  style={{ background: sw.hex }}
                  title={sw.name}
                  aria-label={`Fill color ${sw.name}`}
                  onClick={(e) => { formatSelection(`fill ${sw.name.toLowerCase()}`, { bg: sw.hex }); closeDetails(e); }}
                />
              ))}
            </div>
            <button type="button" className="shx__swatch-reset" onClick={(e) => { formatSelection("reset fill", { bg: undefined }); closeDetails(e); }}>
              <X /> Reset
            </button>
          </div>
        </details>
        <span className="shx__tb-sep" aria-hidden />
        <button
          type="button"
          className={`shx__tb-btn ${activeStyle?.a === "l" ? "is-on" : ""}`}
          onClick={() => formatSelection("align left", { a: "l" })}
          disabled={fmtDisabled}
          title={fmtDisabled ? FMT_STREAM_TITLE : "Align left"}
          aria-label="Align left"
          aria-pressed={activeStyle?.a === "l"}
        ><TextAlignStart /></button>
        <button
          type="button"
          className={`shx__tb-btn ${activeStyle?.a === "c" ? "is-on" : ""}`}
          onClick={() => formatSelection("align center", { a: "c" })}
          disabled={fmtDisabled}
          title={fmtDisabled ? FMT_STREAM_TITLE : "Align center"}
          aria-label="Align center"
          aria-pressed={activeStyle?.a === "c"}
        ><TextAlignCenter /></button>
        <button
          type="button"
          className={`shx__tb-btn ${activeStyle?.a === "r" ? "is-on" : ""}`}
          onClick={() => formatSelection("align right", { a: "r" })}
          disabled={fmtDisabled}
          title={fmtDisabled ? FMT_STREAM_TITLE : "Align right"}
          aria-label="Align right"
          aria-pressed={activeStyle?.a === "r"}
        ><TextAlignEnd /></button>
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
              <select value={filterCol} onChange={(e) => persistFilter(e.target.value, "")}>
                <option value="">No filter</option>
                {table.columns.filter((c) => c.type === "select" || c.type === "multi_select").map((c) => (
                  <option key={c.id} value={c.id}>{c.label}</option>
                ))}
              </select>
              {filterColDef && (
                <select value={filterValue} onChange={(e) => persistFilter(filterCol, e.target.value)}>
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
            cellStyle={cellStyleFor}
            onFormatKey={toggleStyleFlag}
            onRowContextMenu={(rowId, x, y) => setRowMenu({ rowId, x, y })}
            onHeaderContextMenu={(colId, x, y) => setHeaderMenu({ colId, x, y })}
            // Freeze panes are display-only: the kernel pins the first N
            // display rows/columns; nothing here reaches the engine.
            freeze={gridFreeze ?? undefined}
            isCellEmpty={isCellEmpty}
            // Row moving exists ONLY while display order IS storage order:
            // under a sort/filter/search the gutter's display index names a
            // different storage slot, and mid-stream the tail hasn't even
            // arrived. Omitting the prop keeps the gutter click-select only.
            onRowMove={rowInsertBlocked ? undefined : moveRowByDrag}
            onGrowRows={growRows}
            onSelectionChange={(sel) => setGridSelection(sel)}
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
            readOnlyCols={new Set(table.columns.filter((c) => c.type === "formula" || c.type === "lookup" || c.type === "rollup").map((c) => c.id))}
          />
          </div>
          {/* The corner "+": the one manual add-rows affordance left after
              the "New row" footer button died. Compact square, Sheets'
              bottom-left placement, one undoable 500-row block per press. */}
          <button
            type="button"
            className="shx__addrows shx__np"
            onClick={() => void addRowsBlock()}
            disabled={addingRows}
            title="Add 500 rows"
            aria-label="Add 500 rows"
          >
            {addingRows ? <Loader2 className="frmb__spin" /> : <Plus />}
          </button>
        </div>
      )}

      <SheetTabsBar
        currentId={tableId}
        currentName={table.name}
        stats={statsText}
        meta={streamProgress
          // Multi-chunk stream in flight: the muted meta span doubles as the
          // Sheets-like progress line; the normal counts return on completion.
          ? (streamProgress.total !== null
            ? `Loading rows — ${streamProgress.loaded.toLocaleString()} of ${streamProgress.total.toLocaleString()}`
            : `Loading rows — ${streamProgress.loaded.toLocaleString()}…`)
          : `${rows.length} row${rows.length === 1 ? "" : "s"} · ${table.columns.length} col${table.columns.length === 1 ? "" : "s"}`}
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
            {/* The drawer's gutter chevron died with the checkbox gutter —
                this menu entry is the drawer's remaining door. */}
            <MenuItem
              icon={ChevronRight}
              label="Open row"
              onClick={() => { setActiveRowId(rowMenu.rowId); setRowMenu(null); }}
            />
            {/* Sheets' inserts. Gated exactly like the gutter drag: a
                storage slot is only a display slot while nothing reorders
                the display (sort/filter/search) and the whole table is
                resident (stream). Disabled, not hidden — the user learns
                why from the title. */}
            <MenuItem
              icon={ArrowUpFromLine}
              label="Insert 1 row above"
              disabled={rowInsertBlocked}
              title={rowInsertBlocked ? "Clear the sort, filter and search to insert rows" : undefined}
              onClick={() => { setRowMenu(null); insertRowNear(rowMenu.rowId, "above"); }}
            />
            <MenuItem
              icon={ArrowDownToLine}
              label="Insert 1 row below"
              disabled={rowInsertBlocked}
              title={rowInsertBlocked ? "Clear the sort, filter and search to insert rows" : undefined}
              onClick={() => { setRowMenu(null); insertRowNear(rowMenu.rowId, "below"); }}
            />
            {/* Sheets' freeze, from the row menu (we have no View menubar).
                N is the clicked row's display number; hidden, not disabled,
                when it would leave nothing scrollable. Unfreeze appears only
                while rows are frozen. Neither touches data or undo. */}
            {rowMenuCanFreeze ? (
              <MenuItem
                icon={Pin}
                label={`Freeze up to row ${rowMenuDisplayIdx + 1}`}
                onClick={() => { setRowMenu(null); persistFreeze({ rows: rowMenuDisplayIdx + 1 }); }}
              />
            ) : null}
            {freeze?.rows ? (
              <MenuItem
                icon={PinOff}
                label="Unfreeze rows"
                onClick={() => { setRowMenu(null); persistFreeze({ rows: undefined }); }}
              />
            ) : null}
            {rowMenuSpan ? (
              // Sheets' "Clear rows 2-5": the whole span, one undo entry.
              <MenuItem
                icon={Eraser}
                label={`Clear ${rowMenuSpan.length} rows`}
                onClick={() => { setRowMenu(null); clearRows(rowMenuSpan); }}
              />
            ) : (
              <MenuItem
                icon={Eraser}
                label="Clear row"
                onClick={() => { setRowMenu(null); clearRows([rowMenu.rowId]); }}
              />
            )}
            {rowMenuSpan ? (
              // The whole span, through the same confirmed+undoable bulk
              // path the old checkbox pill used.
              <MenuItem
                icon={Trash2}
                label={`Delete ${rowMenuSpan.length} rows`}
                destructive
                onClick={() => { setRowMenu(null); void bulkDeleteRows(rowMenuSpan); }}
              />
            ) : (
              <MenuItem
                icon={Trash2}
                label="Delete row"
                destructive
                onClick={() => { setRowMenu(null); void deleteRow(rowMenu.rowId); }}
              />
            )}
          </MenuList>
        </MorePortal>
      ) : null}

      {headerMenu ? (() => {
        // Resolve the column at render: a delete can outlive the menu by a
        // frame, and a dead colId must render nothing rather than a menu
        // whose every action would no-op or throw.
        const hc = table.columns.find((c) => c.id === headerMenu.colId);
        if (!hc) return null;
        const colIdx = table.columns.findIndex((c) => c.id === headerMenu.colId);
        const letter = columnLetter(colIdx);
        // Same rule as rows: a freeze must leave at least one column scrolling.
        const canFreezeCol = colIdx + 1 <= table.columns.length - 1;
        return (
          <MorePortal
            anchorRef={headerMenuAnchorRef}
            panelRef={headerMenuPanelRef}
            width={200}
            open
            placement="below"
            point={{ x: headerMenu.x, y: headerMenu.y }}
          >
            <MenuList className="min-w-[200px]">
              {/* Sorting drives the SAME persisted sortState the kernel's
                  old header arrow cycled — persistSort writes it into the
                  first saved view exactly as before. */}
              <MenuItem
                icon={ArrowDownAZ}
                label={`Sort sheet A → Z by ${letter}`}
                onClick={() => { setHeaderMenu(null); persistSort({ colId: hc.id, dir: "asc" }); }}
              />
              <MenuItem
                icon={ArrowUpZA}
                label={`Sort sheet Z → A by ${letter}`}
                onClick={() => { setHeaderMenu(null); persistSort({ colId: hc.id, dir: "desc" }); }}
              />
              {sortState ? (
                <MenuItem
                  icon={X}
                  label="Clear sort"
                  onClick={() => { setHeaderMenu(null); persistSort(null); }}
                />
              ) : null}
              {/* Sheets' column inserts + clear. Column order is never
                  display-reordered (no column sort exists), so these need
                  no gate; the clear of a computed column toasts instead. */}
              <MenuItem
                icon={ArrowLeftToLine}
                label="Insert 1 column left"
                onClick={() => { setHeaderMenu(null); insertColumnNear(hc.id, "left"); }}
              />
              <MenuItem
                icon={ArrowRightToLine}
                label="Insert 1 column right"
                onClick={() => { setHeaderMenu(null); insertColumnNear(hc.id, "right"); }}
              />
              {/* Freeze columns, the header-menu twin of the row menu's
                  freeze: display-only, no undo entry, hidden when it would
                  pin every column. */}
              {canFreezeCol ? (
                <MenuItem
                  icon={Pin}
                  label={`Freeze up to column ${letter}`}
                  onClick={() => { setHeaderMenu(null); persistFreeze({ cols: colIdx + 1 }); }}
                />
              ) : null}
              {freeze?.cols ? (
                <MenuItem
                  icon={PinOff}
                  label="Unfreeze columns"
                  onClick={() => { setHeaderMenu(null); persistFreeze({ cols: undefined }); }}
                />
              ) : null}
              <MenuItem
                icon={Eraser}
                label={`Clear column ${letter}`}
                onClick={() => { setHeaderMenu(null); clearColumn(hc.id); }}
              />
              {hc.type === "formula" ? (
                <MenuItem
                  icon={Sigma}
                  label="Edit formula"
                  onClick={() => { setHeaderMenu(null); void editFormula(hc.id); }}
                />
              ) : null}
              {hc.type === "link" || hc.type === "lookup" || hc.type === "rollup" ? (
                <MenuItem
                  icon={Link2}
                  label="Configure relation"
                  onClick={() => { setHeaderMenu(null); setConfigColId(hc.id); }}
                />
              ) : null}
              <MenuItem
                icon={Trash2}
                label={`Delete column ${letter}`}
                destructive
                onClick={() => { setHeaderMenu(null); void deleteColumn(hc.id); }}
              />
            </MenuList>
          </MorePortal>
        );
      })() : null}

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
          formulaDisplay={(colId) => streamProgress ? "…" : String(engineHost.display(colId, activeRow.id) ?? "")}
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
function SheetTabsBar({ currentId, currentName, meta, stats }: { currentId: string | null; currentName: string; meta: string; stats?: string | null }) {
  const router = useRouter();
  const { toast } = useOsToast();
  const { bumpRowVersion } = useOsShell();
  const confirm = useConfirm();
  const promptDialog = usePrompt();
  const [sheets, setSheets] = useState<{ id: string; name: string }[] | null>(null);
  const [creating, setCreating] = useState(false);
  // Right-click a tab (Sheets' own model): Rename / Delete. Before this
  // menu existed there was NO way to delete a spreadsheet anywhere in the
  // UI — the DELETE route sat unused.
  const [tabMenu, setTabMenu] = useState<{ id: string; name: string; x: number; y: number } | null>(null);
  const tabMenuAnchorRef = useRef<HTMLElement | null>(null); // unused in point mode
  const tabMenuPanelRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!tabMenu) return;
    const onDown = (e: MouseEvent) => {
      if (tabMenuPanelRef.current?.contains(e.target as Node)) return;
      setTabMenu(null);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setTabMenu(null); };
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [tabMenu]);

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

  const renameSheet = async (id: string, name: string) => {
    const next = await promptDialog({ title: "Rename sheet", defaultValue: name || UNTITLED_SHEET_NAME });
    if (next == null) return;
    const trimmed = next.trim() || UNTITLED_SHEET_NAME;
    if (trimmed === name) return;
    try {
      const res = await fetch(`/api/tables/${id}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: trimmed }),
      });
      if (!res.ok) throw new Error(`PATCH ${res.status}`);
      notifyTablesChanged();
      bumpRowVersion("tables");
      if (id === currentId) router.refresh();
    } catch { toast("Couldn't rename sheet"); }
  };

  /** DELETE is a soft delete server-side (moveToTrash), so this is
   *  recoverable — the confirm still names it as a deletion because that
   *  is what the user sees. Deleting the OPEN sheet navigates to the next
   *  tab (or the overview when it was the last one). */
  const deleteSheet = async (id: string, name: string) => {
    const label = name || UNTITLED_SHEET_NAME;
    if (!(await confirm({ title: "Delete sheet", description: `Delete "${label}"? It moves to Trash.`, destructive: true, confirmLabel: "Delete" }))) return;
    try {
      const res = await fetch(`/api/tables/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error(`DELETE ${res.status}`);
      const remaining = (sheets ?? []).filter((s) => s.id !== id);
      setSheets(remaining);
      notifyTablesChanged();
      bumpRowVersion("tables");
      if (id === currentId) router.push(remaining[0] ? `/tables/${remaining[0].id}` : "/tables");
    } catch { toast("Couldn't delete sheet"); }
  };

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
            onContextMenu={(e) => { e.preventDefault(); setTabMenu({ id: s.id, name: s.name, x: e.clientX, y: e.clientY }); }}
            title={s.name || UNTITLED_SHEET_NAME}
          >
            {s.name || UNTITLED_SHEET_NAME}
          </button>
        ))}
      </div>
      {tabMenu ? (
        <MorePortal anchorRef={tabMenuAnchorRef} panelRef={tabMenuPanelRef} width={180} open placement="below" point={{ x: tabMenu.x, y: tabMenu.y }}>
          <MenuList className="min-w-[180px]">
            <MenuItem icon={Pencil} label="Rename" onClick={() => { const t = tabMenu; setTabMenu(null); void renameSheet(t.id, t.name); }} />
            <MenuItem icon={Trash2} label="Delete sheet" destructive onClick={() => { const t = tabMenu; setTabMenu(null); void deleteSheet(t.id, t.name); }} />
          </MenuList>
        </MorePortal>
      ) : null}
      {stats ? (
        /* Selection stats: reuses the meta span's class so the cluster
           inherits the strip's flex push (tabs own all free space, so the
           two spans sit adjacent at the right edge with zero new layout). */
        <span className="shx__tabbar-meta">{stats}</span>
      ) : null}
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
    // An open (short_text) column can hold a real NUMBER; React stringifies
    // it for defaultValue, so a bare `text !== value` would read "5" vs 5
    // as an edit and push a no-op write (plus a no-op undo entry) on every
    // untouched blur. Compare what the commit would STORE instead: the
    // typed value for an open column (so "5", " 5" and "5.0" over a stored
    // 5 are all no-ops), the text itself elsewhere. What does pass: "5"
    // over a legacy STRING "5" (5 !== "5"), a deliberate upgrade write,
    // see commitEditorValue.
    const unchanged = (text: string) =>
      isOpenColumnType(t) ? autoTypeEntry(text) === (value ?? "") : text === String(value ?? "");
    return (
      <input
        type={t === "short_text" ? "text" : t}
        defaultValue={(value as string | number) ?? ""}
        onBlur={(e) => { if (cancelled?.current) return; if (!unchanged(e.target.value)) onChange(e.target.value); }}
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
