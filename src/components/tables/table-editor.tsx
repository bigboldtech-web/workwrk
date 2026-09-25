"use client";

/* Tables · the sheet (spec-tables-forms section 2 /tables/[id]): a
 * spreadsheet measured against Google Sheets.
 *
 * Chrome, top to bottom (SheetChrome in components/tables/sheet-chrome):
 *   title row 48   BackButton (the Space, else Tables), the neutral Table2
 *                  tile, the inline name (Enter or blur commits, Esc
 *                  reverts), the AutosaveIndicator, the star, the
 *                  co-presence chip, the public-link glyph, ShareOrRoleChip
 *                  (the one Share dialog), the "..." (TableRowMenu)
 *   menu bar 36    File · Edit · View · Insert · Format · Data (SheetMenuBar;
 *                  one "Menu" button under 900px)
 *   toolbar 44     undo, redo, zoom, number formats, B I U S, colours,
 *                  alignment, Filter, Σ; right: Copy link (+ Copy embed code)
 *                  and the "..." (Display, About)
 *   formula bar 36 address, fx, the source input (View > Formula bar hides it)
 *   grid           the card; its status bar pinned at the bottom (rows and
 *                  columns or the stream progress, the selection statistics,
 *                  the last-saved time)
 * There is no bottom sheet tab bar: it listed every table in the org as if it
 * were a sheet of this one. Switching tables is the Tables sidebar and
 * /tables; rename and delete are the "..." and the File menu; the counts and
 * statistics are the status bar. Every control is real: no dead buttons.
 *
 * Per-cell formatting (bold/italic/underline/strike/colour/fill/align)
 * rides a RESERVED key on each row's values Json, values["$fmt"] (see
 * lib/sheet-cell-style): no schema change, invisible to every
 * column-driven reader, and deliberately never handed to the formula
 * engine host, styles don't recalc.
 *
 * A column with no name shows its letter (A, B, C...); a named one shows the
 * name after its letter. "+" appends a text column instantly; the column
 * menu (header chevron, right click, Alt+Down) names and types it. Rows
 * carry a Sheets-style numbered gutter: click selects the row, shift
 * extends, drag reorders; its chevron opens the row menu, and Open row (or
 * Cmd+Enter) opens the row drawer at ?row=. The sheet kernel (SheetGrid)
 * renders the grid; this page owns data semantics, the formula engine
 * host, undo and CSV import/export.
 *
 * ONE SHEET, THREE ADDRESSES. This component is the body of /tables/[id]
 * (the Tables hub) and of the Work addresses /spaces/[slug]/tables/[id] and
 * /work/tables/[id], which a table opened from Work uses so the person stays
 * in Work (src/lib/nav/object-href.ts). In Work (`inWork`, from the
 * placement the route's gate computed) the crumb is declared by the
 * WorkPlacementProvider, Back and Trash land on the Work crumb, and every
 * query-only navigation (?row, the ?new strip) goes to the address the sheet
 * is mounted at (`selfPath`), never to window.location.pathname, which is
 * the task drawer's URL while the drawer is open. No save, load, ledger or
 * leave-guard path changes with the address.
 */

import { Dots } from "@/components/ui/dots";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  Plus,
  Trash2,
  Upload,
  Download,
  Search,
  Filter,
  Globe,
  Lock,
  Sigma,
  Star,
  Check,
  Tag,
  Table2,
  Sparkles,
  Undo2,
  Redo2,
  Printer,
  DollarSign,
  Percent,
  ChevronDown,
  ChevronUp,
  X,
  Pencil,
  MoreVertical,
  Bold,
  Italic,
  Underline,
  Strikethrough,
  Baseline,
  PaintBucket,
  TextAlignStart,
  TextAlignCenter,
  TextAlignEnd,
  Link2,
  Code2,
  MoreHorizontal,
  Info,
  Copy,
  ClipboardPaste,
  Scissors,
  ArrowDownToLine,
  ArrowRightToLine,
  Eraser,
  Columns3,
  Rows3,
  Snowflake,
  Maximize2,
  Minimize2,
  Grid3x3,
  PanelTop,
  FolderInput,
  ShieldCheck,
  Palette,
  ArrowUpDown,
  Hash,
  Type,
  AlignLeft,
  FileSpreadsheet,
  ZoomIn,
  FunctionSquare,
} from "lucide-react";
import { useOsToast } from "@/components/layout/os/toast";
import { useConfirm, usePrompt } from "@/components/ui/dialog-provider";
import { MenuList, MenuItem, MenuSeparator } from "@/components/ui/menu";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { MorePortal } from "@/components/layout/os/more-portal";
import { createTableEngine, columnLetter, type StructureResult, type TableEngine, type NamedRangeDef } from "@/lib/sheet-engine-host";
import { createSerialQueue } from "@/lib/sheet-serial-queue";
// Cell VALUE writes (updates, deletes, the single-cell PATCH) ride keepalive
// plus a retry on a network failure or a 5xx; each is idempotent on a repeat.
// Row INSERTS keep a plain fetch: a repeat after a lost response would add
// the rows twice.
import { fetchWithRetry } from "@/lib/fetch-retry";
import { ledgerFail, ledgerRowId, ledgerSettle, overlayLedger, overlayTableEntry, rowLedgerKey, TABLE_LEDGER_KEY, type SaveLedger } from "@/lib/sheet-save-ledger";
import { jsonEqual } from "@/lib/sheet-conflict";
import { streamRows } from "@/lib/sheet-stream";
import { isFormulaCell, FORMULA_KEY } from "@/lib/sheet-engine";
import { createUndoStack, type UndoCommand } from "@/lib/sheet-undo";
import { TEXT_SWATCHES, FILL_SWATCHES, RULE_COLORS, SCALE_DEFAULT, BAR_DEFAULT, FIND_MATCH_BG, FIND_CURRENT_BG } from "@/lib/sheet-palette";
import { formatCellValue, isNegativeStyled, matchRule, numericRange, colorScaleColor, dataBarBackground, iconSetIcon, type ColumnFormat, type ConditionalRule, type CondFormatV2 } from "@/lib/sheet-format";
import { adjustDecimals, formatPatchFor, kindForColType, NUMBER_FORMAT_CHOICES, type NumberFormatKind } from "@/lib/sheet-format-actions";
import { CELL_STYLE_KEY, isReservedKey, readCellStyle, ROW_HEIGHT_KEY, styleToCss, withCellStyle, type CellStyle } from "@/lib/sheet-cell-style";
import { createNewTable, NEW_SHEET_COLUMNS, NEW_SHEET_ROWS, UNTITLED_TABLE_NAME } from "@/lib/sheet-new";
import { readSheetFormulaBar, readSheetGridlines, readZoom, zoomKey, ZOOM_LEVELS, readPivotConfig, pivotPatch, type PivotConfig } from "@/lib/tables-prefs";
import { autoTypeEntry, autoTypeEntryRich, isOpenColumnType } from "@/lib/sheet-entry";
import { validateValue, isEmptyValidation, type DataValidation } from "@/lib/sheet-validation";
import { matchesFindQuery, replaceAllOccurrences, REPLACE_SKIP_TYPES } from "@/lib/sheet-find";
import { notifyTablesChanged } from "@/components/layout/os/sidebar-refresh";
import { useOsShell } from "@/components/layout/os/shell-context";
import { RelationConfigModal } from "@/components/tables/relation-config-modal";
import { GridHeaderMenu } from "@/components/tables/grid-header-menu";
import { GridRowMenu } from "@/components/tables/grid-row-menu";
import { ColumnTypePicker, COLUMN_TYPE_ICON } from "@/components/tables/column-type-picker";
import { Picker } from "@/components/ui/picker";
import { DateField } from "@/components/ui/date-field";
import { ColumnTypeChangeDialog } from "@/components/tables/column-type-change-dialog";
import { SelectOptionsDialog } from "@/components/tables/select-options-dialog";
import { HeaderRenameInput } from "@/components/tables/header-rename-input";
import {
  cleanColumnName, columnTypeLabel, COMPUTED_TYPES, countTypeChangeLosses, RELATION_TYPES,
  typeChangePatch, type ColumnTypeValue,
} from "@/lib/sheet-columns";
import { columnDisplayName } from "@/lib/sheet-embed";
import { SheetGrid, SHEET_ROW_H, rowNumbersById, type SheetSort } from "@/components/tables/sheet-grid";
import { selectionStats } from "@/lib/sheet-stats";
import { FormulaBar, FormulaTextInput, type FormulaBarCell } from "@/components/tables/formula-bar";
import { NamedRangesDialog } from "@/components/tables/named-ranges-dialog";
import { TableTrashDialog } from "@/components/tables/table-trash-dialog";
import { PivotDialog } from "@/components/tables/pivot-dialog";
import { AskDataDialog } from "@/components/tables/ask-data-dialog";
import { TableFavoriteButton } from "@/components/board-view/table-favorite-button";
import { BackButton } from "@/components/ui/back-button";
import { SkeletonRows } from "@/components/ui/skeleton";
import { EntityTile, NEUTRAL_TILE } from "@/components/ui/entity-tile";
import { AutosaveIndicator } from "@/components/ui/autosave-indicator";
import { useDirtyGuard } from "@/hooks/use-dirty-guard";
import { confirmLeave, setLeaveConfirmer } from "@/lib/dirty-guard";
import { Drawer } from "@/components/ui/drawer";
import { FilterGroup, FilterPanel, FilterRow } from "@/components/ui/filter-panel";
import {
  activeFilterCount, cellPassesFilter, emptyFilterFor, filterIsActive, filtersToConfig, isDateFilterType,
  readSavedFilters, type SheetColumnFilter,
} from "@/lib/sheet-filters";
import { OsEmptyView } from "@/components/layout/os/empty-view";
import { NotFoundView } from "@/components/access/not-found-view";
import { Breadcrumb } from "@/components/layout/os/top-bar/breadcrumb";
import { ShareOrRoleChip } from "@/components/access/share-or-role-chip";
import { ObjectShareDialog, embedSnippet } from "@/components/tables/object-share-dialog";
import { TableRowMenu } from "@/components/tables/table-row-menu";
import { CsvImportDialog } from "@/components/tables/csv-import-dialog";
import { csvExportCell, csvFormulaSafe } from "@/lib/csv";
import { SheetMenuBar, type SheetMenuSpec } from "@/components/tables/sheet-menu-bar";
import { CoPresenceChip, SheetStatusBar, TableAboutDialog, useTablePresence } from "@/components/tables/sheet-parts";
import { cn } from "@/lib/utils";
import { useWorkPlacement, useWorkTitle } from "@/components/layout/os/work-placement";
import { copyObjectLink, objectHrefNow, sectionHrefNow } from "@/components/layout/os/use-object-href";
import { canonicalHref } from "@/lib/nav/object-href";
import { FunctionReferenceDrawer } from "@/components/tables/function-reference-drawer";
import { useSheetShortcutList } from "@/components/tables/sheet-shortcut-list";

// The zoom steps (lib/tables-prefs ZOOM_LEVELS: 75 90 100 125 150). CSS
// `zoom` (not transform scale) so the layout REFLOWS: the kernel's
// virtualizer keeps computing against real layout px and its math stays
// consistent.

/* The toolbar's one button shape (tokens only): 32px square ghost, 16px
 * glyph, the pressed state on aria-pressed rather than a hand-kept class. */
const TB = "inline-flex h-8 min-w-8 shrink-0 items-center justify-center gap-0.5 rounded-md px-1.5 text-sm font-medium text-ink-2 hover:bg-hover hover:text-ink disabled:cursor-not-allowed disabled:opacity-40 aria-pressed:bg-active aria-pressed:text-ink [&_svg]:h-4 [&_svg]:w-4";
const TB_SEP = "mx-1 h-5 w-px shrink-0 bg-line";

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
  // Raw cell values NEVER change shape, sort/formulas/clipboard read raw.
  format?: ColumnFormat;      // column-level number/date formatting
  rules?: ConditionalRule[];  // conditional formatting v1 (value → cell bg)
  condFormat?: CondFormatV2;  // conditional formatting v2 (color scale / data bar)
  protected?: boolean;        // 4f: a locked column, read-only, can't be edited/pasted/cleared
  validation?: DataValidation; // data validation (reject-mode): list / number / text-length
};

type LinkedTable = { id: string; name: string; columns: Column[]; titleColId: string; rows: ApiRow[] };
/** Stored view types. Only "grid" is produced now (the bar is Google Sheets:
 *  no view switcher). The other three are legacy values older rows may still
 *  carry; they are kept in the type so a read of views[] never drops them. */
type ViewType = "grid" | "kanban" | "calendar" | "gallery";
/** Freeze panes (Sheets' View → Freeze): display-index COUNTS of leading
 *  rows/columns pinned while the rest scrolls. Display-only, the engine
 *  never sees it, and it makes no undo entry (Sheets doesn't undo a freeze
 *  either; the menu's Unfreeze is the way back). */
type SheetFreeze = { rows?: number; cols?: number };
type SavedView = { id: string; name: string; type: ViewType; config?: { kanbanCol?: string; calCol?: string; sort?: { colId: string; dir: "asc" | "desc" }; filter?: { colId: string; value: string }; filters?: SheetColumnFilter[]; freeze?: SheetFreeze } };
type TableSettings = { namedRanges?: NamedRangeDef[] };
type ApiTable = { id: string; name: string; description?: string | null; columns: Column[]; views?: SavedView[]; rowCount: number; isPublic?: boolean; settings?: TableSettings | null; spaceId?: string | null;
  /** Creator or admin (GET /api/tables/[id], lib/object-manage): may delete the table or change its public link. */
  canManage?: boolean;
  /** The org's toggle 10 (lib/public-links): whether the Share dialog's Public link row exists. */
  publicLinksAllowed?: boolean };

/** Named ranges out of a table's settings blob, defensively. */
function readNamedRanges(settings: TableSettings | null | undefined): NamedRangeDef[] {
  const list = settings?.namedRanges;
  if (!Array.isArray(list)) return [];
  return list.filter(
    (r): r is NamedRangeDef => !!r && typeof r.name === "string" && typeof r.ref === "string",
  );
}

/** A freeze is only meaningful while at least ONE row and ONE column can
 *  still scroll, a sheet that is entirely frozen band is a sheet that
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
  if (!u) return "Unknown person";
  return `${u.firstName ?? ""} ${u.lastName ?? ""}`.trim() || "Unnamed";
}
function userInitials(u: OrgUser | undefined): string {
  if (!u) return "?";
  return `${(u.firstName ?? "")[0] ?? ""}${(u.lastName ?? "")[0] ?? ""}`.toUpperCase() || "?";
}

/** The display/title column of a table, first short_text, else first column. */
function titleColumnId(columns: Column[]): string {
  return (columns.find((c) => c.type === "short_text") ?? columns[0])?.id ?? "";
}

/** Pull a single linked row's display title. */
function rowTitle(row: ApiRow | undefined, titleColId: string): string {
  if (!row) return "Unknown row";
  const v = row.values[titleColId];
  // A per-cell formula in another table can't be computed here (its engine
  // would need that table's rows), show its source rather than
  // "[object Object]".
  if (isFormulaCell(v)) return `=${v[FORMULA_KEY]}`;
  return v == null || v === "" ? "Untitled" : String(v);
}

function newId() { return Math.random().toString(36).slice(2, 10); }

// The batch route 400s a whole request above MAX_OPS ops of one kind
// (api/tables/[id]/rows/batch), and select-all happily spans thousands of
// rows, so bulk work ships in slices this size.
const BATCH_MAX_OPS = 500;
/** The corner "+" adds this many blank rows as one undoable step (spec: "Add 1,000 rows"). */
const ADD_ROWS_BLOCK = 1000;
/** One toast slot for every "this did not save" report on the sheet: a
 *  second failure replaces the first instead of stacking, and the slot is
 *  dismissed the moment the unsaved ledger empties (noteWriteSettled). */
const SAVE_FAILED_TOAST = "table-save-failed";
/** Column types whose numeric values right-align by default (cellStyleFor). */
const NUMERIC_ALIGN_TYPES = new Set(["number", "currency", "percent"]);

// Column types the format menu (and formatCellValue routing) applies to.
// Rating keeps its stars, text stays text, formatting is opt-in per the
// Phase 4 scope (column-level only; per-cell formats deferred).
const FORMATTABLE_TYPES = new Set<ColType>(["number", "currency", "percent", "date"]);

/* ── Per-row height (Sheets' row resize) ──────────────────────────
 * Storage: NO schema change, a custom height rides the row's values Json
 * under the RESERVED key "$rh" (lib/sheet-cell-style's ROW_HEIGHT_KEY), a
 * plain number of layout px. Absent, or null, the deletable spelling,
 * because the shallow PATCH/batch merge cannot drop keys, means the
 * default SHEET_ROW_H. The key is invisible to every column-driven reader
 * (CSV export, stats, search, sort and the row drawer all iterate
 * table.columns), and isReservedKey keeps it out of the key-driven paths
 * (engine host writes, conflict absorb, the guard's expect map) exactly
 * as it keeps "$fmt" out. */

/** Height clamp: below 16px a row is unreadable and its boundary
 *  un-grabbable; above 400px one stray drag swallows the viewport. Must
 *  match the kernel's own drag clamp so a persisted height re-reads as
 *  the height that was previewed. */
const ROW_HEIGHT_MIN = 16;
const ROW_HEIGHT_MAX = 400;

/** Stored "$rh" → a usable height. Junk (strings, NaN, null, arrays)
 *  reads as "no custom height" rather than crashing a 50k-row geometry
 *  build; out-of-range numbers clamp instead of dropping, like the dp
 *  clamp, a persisted 1000 still carries the intent "very tall". */
function readRowHeight(v: unknown): number | undefined {
  if (typeof v !== "number" || !Number.isFinite(v)) return undefined;
  return Math.min(ROW_HEIGHT_MAX, Math.max(ROW_HEIGHT_MIN, Math.round(v)));
}

/* ── Per-cell number format for OPEN columns ──────────────────────
 * Two formatting worlds coexist on purpose:
 *   OPEN columns (short_text, what every new sheet is born with) format
 *   per CELL, like Sheets: the $ / % / .0 / .00 / 123 toolbar writes
 *   `nf` / `dp` into the cell's "$fmt" style, and the column's type never
 *   moves, so the cell next door still takes text.
 *   LEGACY typed columns (number / currency / percent / date / checkbox)
 *   keep their COLUMN-level col.type + col.format: the type IS the
 *   editor there (a number input), so "format" and "type" are one choice.
 * The helpers below are the open-world half; they are pure so the display,
 * the editor's edit-form and the commit all agree on one reading. */

type OpenNumberFormat = NonNullable<CellStyle["nf"]>;

/** A withCellStyle patch: set keys to values, or to undefined to remove. */
type StylePatch = Partial<Record<keyof CellStyle, unknown>>;

/** The cell's nf/dp as a ColumnFormat for the existing formatter (no new
 *  formatter: one Intl path renders a column's $1,234.50 and a cell's).
 *  `thousands` is on because Sheets' $ and 123→Number formats group;
 *  `decimals` undefined means "show the stored digits faithfully" (what a
 *  typed "12.5%" shows until the user steps .0/.00). */
function openCellFormat(style: CellStyle | undefined): ColumnFormat | undefined {
  if (!style?.nf) return undefined;
  return { style: style.nf, decimals: style.dp, thousands: true, currency: "USD" };
}

/** Display text of a value in an OPEN column. Only a finite NUMBER with an
 *  nf goes through the formatter; text ignores any nf the cell carries
 *  (Sheets: a format on a text cell is invisible), and a number with no nf
 *  renders String(n): "1000", not "1,000", until the user asks. Percent
 *  cells store the fraction (0.05 for "5%", what Sheets stores and what
 *  SUM/AVERAGE must read), but the formatter's percent style renders the
 *  stored number as-is because legacy percent COLUMNS store 12 for "12%",
 *  so the ×100 happens here. The float noise of ×100 (7.000000000000001)
 *  never shows: the formatter rounds to at most 10 fraction digits. */
function formatOpenCell(v: unknown, style: CellStyle | undefined): string {
  if (v == null || v === "") return "";
  if (typeof v !== "number" || !Number.isFinite(v)) return String(v);
  const nf = style?.nf;
  const format = openCellFormat(style);
  if (!nf || !format) return String(v);
  return formatCellValue(nf === "percent" ? v * 100 : v, nf, format);
}

/** Percent amount of a stored fraction as the user would type it: 0.07 is
 *  "7", not "7.000000000000001". toPrecision(15) (DBL_DIG, the same 15
 *  significant digits sheet-entry trusts) drops the ×100 noise without
 *  rounding away anything a double genuinely holds. */
function percentAmount(v: number): number {
  return Number((v * 100).toPrecision(15));
}

/** What the editor opens WITH for a cell in an OPEN column, Sheets'
 *  edit-form: an nf-percent cell edits as "5%" (dp-aware by PADDING only,
 *  "5.0%" at dp 1, never rounding, so an untouched Enter re-parses to the
 *  exact stored value), an nf-currency cell edits as the bare "5" (Sheets
 *  shows the raw number, the $ is format), anything else as today. */
function openCellEditText(v: unknown, style: CellStyle | undefined): string {
  if (v == null) return "";
  if (typeof v !== "number" || !Number.isFinite(v) || style?.nf !== "percent") return String(v);
  let s = String(percentAmount(v));
  // Exponent forms ("1e-7") cannot be padded and would not re-parse as a
  // number anyway; leave them as they are rather than corrupt them.
  if (style.dp !== undefined && !/e/i.test(s)) {
    const dot = s.indexOf(".");
    const have = dot < 0 ? 0 : s.length - dot - 1;
    if (have < style.dp) s = `${dot < 0 ? `${s}.` : s}${"0".repeat(style.dp - have)}`;
  }
  return `${s}%`;
}

/** Where the .0 / .00 steppers start when a cell has no dp yet: the
 *  digits the nf's default display shows (matches adjustDecimals for
 *  columns, so a column and a cell step identically). */
function defaultDp(nf: OpenNumberFormat): number {
  return nf === "percent" ? 0 : 2;
}

/** The dp a TYPED symbol entry seeds. "$5" shows as $5.00 in Sheets;
 *  "5%" shows as 5% but "12.5%" as 12.50% (Sheets' automatic percent
 *  picks 0.00% once there are fraction digits). */
function typedEntryDp(nf: OpenNumberFormat, value: number): number {
  if (nf === "percent") return Number.isInteger(percentAmount(value)) ? 0 : 2;
  return 2;
}

/** Resolve a plain-editor commit on an OPEN cell that may already carry an
 *  nf. The rule is Sheets': a typed symbol ("5%", "$5") SETS the cell's
 *  format (switching nf resets dp to that nf's typed default); a bare
 *  number or text KEEPS whatever format the cell has. `fmt` is null when
 *  the style needs no write, so the unchanged-check and the commit can
 *  both ask one question. */
function resolveOpenEntry(
  text: string,
  stored: CellStyle | undefined,
): { value: number | string; fmt: { nf: OpenNumberFormat; dp: number } | null } {
  const rich = autoTypeEntryRich(text);
  if (rich.nf && rich.nf !== stored?.nf && typeof rich.value === "number") {
    return { value: rich.value, fmt: { nf: rich.nf, dp: typedEntryDp(rich.nf, rich.value) } };
  }
  // Sheets: a BARE number typed into a percent-formatted cell is read as a
  // percent (7 -> 7%, stored 0.07). Only the bare form: "7%" already
  // carries its own scale, and text is text.
  if (!rich.nf && stored?.nf === "percent" && typeof rich.value === "number") {
    return { value: Number((rich.value / 100).toFixed(12)), fmt: null };
  }
  return { value: rich.value, fmt: null };
}

// The red the grid already uses for formula errors, reused for
// negative-styled numbers so "red negatives" match the existing token.
const NEGATIVE_RED: React.CSSProperties = { color: "var(--os-danger-text)" };

/** Labels for the toggleable text flags, shared by the toolbar pills, the
 *  kernel's Cmd/Ctrl+B/I/U shortcut and the undo-stack labels. */
const STYLE_FLAG_NAMES: Record<"b" | "i" | "u" | "s", string> = { b: "bold", i: "italic", u: "underline", s: "strikethrough" };

/** Two stored "$fmt" maps hold the same styles. Key order is stable (the
 *  sanitiser rebuilds entries in one fixed order), so a JSON compare is an
 *  honest equality, and a spurious mismatch only costs a no-op write. */
function sameStyleMap(a: unknown, b: unknown): boolean {
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
}

/** Fold the engine host's column-formula rewrites into a columns array,
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
 *  also orders the un-padded dates a CSV import can leave behind, both
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
 *  only where the grouping shape is unambiguous, "1,5" stays unparseable
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

/** Date columns store ISO "YYYY-MM-DD", what the date editor writes and
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
 *  - write: store this (null clears the cell, pasting a blank over a
 *           value clears it, same as Sheets).
 *  - empty: the text has no reading in this column, so the cell is
 *           CLEARED and the count surfaced. The user aimed at this cell;
 *           leaving the old number sitting under the paste is the worse
 *           lie. Dates are the exception (see below).
 *  - skip:  leave the cell exactly as it was, and count it. */
type PasteCoercion = { kind: "write"; value: unknown } | { kind: "skip" };

const RULE_LABELS: Record<ConditionalRule["when"], string> = {
  gt: "greater than", lt: "less than", gte: "≥", lte: "≤",
  eq: "equals", neq: "not equals", contains: "contains",
  empty: "is empty", nonempty: "is not empty",
};
const RULE_ORDER: ConditionalRule["when"][] = ["gt", "lt", "gte", "lte", "eq", "neq", "contains", "empty", "nonempty"];

/** Conditional formatting editor. Three modes, one active at a time:
 *  - Single color: per-cell value rules (v1, `column.rules`).
 *  - Color scale: a heat-map gradient across the column's range (v2).
 *  - Data bar: an in-cell bar sized by the value (v2).
 *  Saving a v2 mode clears the v1 rules and vice-versa, so a column reads one
 *  way. Local draft; commits through one undo step. */
function ConditionalRulesDialog({ column, columnName, onClose, onSave }: {
  column: Column;
  /** The label, or the column letter for an unnamed column (every column
   *  of a new table), as the header shows it. */
  columnName: string;
  onClose: () => void;
  onSave: (patch: { rules: ConditionalRule[]; condFormat?: CondFormatV2 }) => void;
}) {
  const initialMode: "single" | "color_scale" | "data_bar" | "icon_set" =
    column.condFormat?.type === "color_scale" ? "color_scale"
    : column.condFormat?.type === "data_bar" ? "data_bar"
    : column.condFormat?.type === "icon_set" ? "icon_set"
    : "single";
  const [mode, setMode] = useState(initialMode);
  const [iconSet, setIconSet] = useState<"arrows" | "traffic">(
    column.condFormat?.type === "icon_set" ? column.condFormat.set : "arrows",
  );
  const [rules, setRules] = useState<ConditionalRule[]>(() => (column.rules ?? []).map((r) => ({ ...r })));
  const cs = column.condFormat?.type === "color_scale" ? column.condFormat : null;
  const [scaleMin, setScaleMin] = useState(cs?.min ?? SCALE_DEFAULT.min);
  const [scaleMid, setScaleMid] = useState(cs?.mid ?? SCALE_DEFAULT.mid);
  const [useMid, setUseMid] = useState<boolean>(cs ? cs.mid != null : true);
  const [scaleMax, setScaleMax] = useState(cs?.max ?? SCALE_DEFAULT.max);
  const barCf = column.condFormat?.type === "data_bar" ? column.condFormat : null;
  const [barColor, setBarColor] = useState(barCf?.color ?? BAR_DEFAULT);

  const addRule = () => setRules((prev) => [...prev, { when: "gt", value: "", bg: RULE_COLORS[prev.length % RULE_COLORS.length] }]);
  const update = (i: number, patch: Partial<ConditionalRule>) => setRules((prev) => prev.map((r, x) => (x === i ? { ...r, ...patch } : r)));
  const remove = (i: number) => setRules((prev) => prev.filter((_, x) => x !== i));
  const needsValue = (w: ConditionalRule["when"]) => w !== "empty" && w !== "nonempty";

  const save = () => {
    if (mode === "single") {
      onSave({ rules: rules.filter((r) => !needsValue(r.when) || String(r.value ?? "").trim() !== ""), condFormat: undefined });
    } else if (mode === "color_scale") {
      onSave({ rules: [], condFormat: { type: "color_scale", min: scaleMin, mid: useMid ? scaleMid : null, max: scaleMax } });
    } else if (mode === "data_bar") {
      onSave({ rules: [], condFormat: { type: "data_bar", color: barColor } });
    } else {
      onSave({ rules: [], condFormat: { type: "icon_set", set: iconSet } });
    }
  };

  const TABS: { key: typeof mode; label: string }[] = [
    { key: "single", label: "Single color" },
    { key: "color_scale", label: "Color scale" },
    { key: "data_bar", label: "Data bar" },
    { key: "icon_set", label: "Icon set" },
  ];
  const swatch = (val: string, set: (v: string) => void, label: string) => (
    <label className="flex items-center gap-1.5 text-xs text-ink-2">
      <input type="color" value={val} onChange={(e) => set(e.target.value)} className="h-7 w-8 rounded border border-line bg-raised p-0.5" aria-label={label} />
      {label}
    </label>
  );

  return (
    <Dialog open onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Conditional formatting: {columnName}</DialogTitle>
        </DialogHeader>

        <div className="inline-flex self-start overflow-hidden rounded-md border border-line text-sm mb-3">
          {TABS.map((t) => (
            <button
              key={t.key}
              type="button"
              onClick={() => setMode(t.key)}
              className={`h-8 px-3 ${mode === t.key ? "bg-brand text-white" : "bg-raised text-ink-2 hover:bg-hover"}`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {mode === "single" ? (
          <>
            <p className="text-sm text-ink-2 mb-2">Cells matching a rule take its colour. Rules apply top to bottom; the first match wins.</p>
            <div className="flex flex-col gap-2 max-h-[42vh] overflow-y-auto">
              {rules.length === 0 ? (
                <p className="py-4 text-center text-sm text-ink-3">No rules yet.</p>
              ) : rules.map((r, i) => (
                <div key={i} className="flex items-center gap-2 rounded-lg border border-line p-2">
                  <select
                    value={r.when}
                    onChange={(e) => update(i, { when: e.target.value as ConditionalRule["when"] })}
                    className="h-8 rounded-md border border-line px-2 text-sm text-ink outline-none focus:border-[var(--os-brand)]"
                  >
                    {RULE_ORDER.map((w) => <option key={w} value={w}>{RULE_LABELS[w]}</option>)}
                  </select>
                  {needsValue(r.when) && (
                    <input
                      type="text"
                      value={r.value == null ? "" : String(r.value)}
                      onChange={(e) => update(i, { value: e.target.value })}
                      placeholder="value"
                      className="h-8 w-24 rounded-md border border-line px-2 text-sm text-ink outline-none focus:border-[var(--os-brand)]"
                    />
                  )}
                  <div className="flex items-center gap-1">
                    {RULE_COLORS.map((hex) => (
                      <button
                        key={hex}
                        type="button"
                        onClick={() => update(i, { bg: hex })}
                        aria-label={`Colour ${hex}`}
                        className={`h-5 w-5 rounded-full border ${r.bg === hex ? "ring-2 ring-[var(--os-brand)] ring-offset-1" : "border-line-strong"}`}
                        style={{ background: hex }}
                      />
                    ))}
                  </div>
                  <button type="button" onClick={() => remove(i)} className="ml-auto text-ink-3 hover:text-red-600" aria-label="Remove rule">
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              ))}
            </div>
            <button type="button" onClick={addRule} className="mt-2 inline-flex h-8 items-center gap-1.5 self-start rounded-md border border-dashed border-line-strong px-3 text-sm text-ink-2 hover:bg-hover">
              <Plus className="h-3.5 w-3.5" /> Add rule
            </button>
          </>
        ) : null}

        {mode === "color_scale" ? (
          <div className="flex flex-col gap-3">
            <p className="text-sm text-ink-2">A heat-map across this column&rsquo;s numbers. The lowest gets the min colour, the highest the max.</p>
            <div className="flex items-center gap-4">
              {swatch(scaleMin, setScaleMin, "Min")}
              <label className="flex items-center gap-1.5 text-xs text-ink-2">
                <input type="checkbox" checked={useMid} onChange={(e) => setUseMid(e.target.checked)} /> Midpoint
              </label>
              {useMid ? swatch(scaleMid, setScaleMid, "Mid") : null}
              {swatch(scaleMax, setScaleMax, "Max")}
            </div>
            <div
              className="h-6 rounded-md border border-line"
              style={{ background: `linear-gradient(to right, ${scaleMin}, ${useMid ? `${scaleMid}, ` : ""}${scaleMax})` }}
              aria-label="Colour scale preview"
            />
          </div>
        ) : null}

        {mode === "data_bar" ? (
          <div className="flex flex-col gap-3">
            <p className="text-sm text-ink-2">Each cell shows a bar sized by its value relative to the column.</p>
            {swatch(barColor, setBarColor, "Bar colour")}
            <div className="flex flex-col gap-1 rounded-md border border-line p-2" aria-label="Data bar preview">
              {[0.9, 0.55, 0.3].map((w, i) => (
                <div key={i} className="h-5 rounded-sm" style={{ background: `linear-gradient(to right, ${barColor}55 0%, ${barColor}55 ${w * 100}%, transparent ${w * 100}%)` }} />
              ))}
            </div>
          </div>
        ) : null}

        {mode === "icon_set" ? (
          <div className="flex flex-col gap-3">
            <p className="text-sm text-ink-2">Each cell gets an icon by where its value sits in the column: top third, middle or bottom.</p>
            <div className="inline-flex self-start overflow-hidden rounded-md border border-line text-sm">
              {(["arrows", "traffic"] as const).map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => setIconSet(s)}
                  className={`h-8 px-3 ${iconSet === s ? "bg-brand text-white" : "bg-raised text-ink-2 hover:bg-hover"}`}
                >
                  {s === "arrows" ? "Arrows" : "Traffic light"}
                </button>
              ))}
            </div>
            <div className="flex items-center gap-4 rounded-md border border-line p-3">
              {[{ t: "High", v: 9 }, { t: "Mid", v: 4.5 }, { t: "Low", v: 0 }].map((x) => ({ t: x.t, icon: iconSetIcon(x.v, 0, 9, iconSet) })).map((x) => (
                <span key={x.t} className="inline-flex items-center gap-1.5 text-xs text-ink-2">
                  <span style={{ color: x.icon?.color, fontSize: 11 }}>{x.icon?.char}</span> {x.t}
                </span>
              ))}
            </div>
          </div>
        ) : null}

        <div className="mt-4 flex justify-end gap-2">
          <button type="button" onClick={onClose} className="h-8 px-3 rounded-md text-base text-ink-2 hover:bg-hover border border-line">Cancel</button>
          <button
            type="button"
            onClick={save}
            className="h-8 px-3 rounded-md text-base font-medium text-white bg-[var(--os-brand)] hover:bg-[var(--os-brand-hover)]"
          >
            Save
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** Data validation editor (Zoho/Sheets). Restrict a column to a list
 *  (renders a dropdown), a number range, or a text length. v1 is
 *  reject-mode: invalid entries are refused. Commits via one undo step. */
function DataValidationDialog({ column, columnName, onClose, onSave }: {
  column: Column;
  /** Label or letter, as ConditionalRulesDialog's. */
  columnName: string;
  onClose: () => void;
  onSave: (validation: DataValidation | undefined) => void;
}) {
  const initial = column.validation;
  const [kind, setKind] = useState<"none" | DataValidation["kind"]>(initial?.kind ?? "none");
  const [listText, setListText] = useState(initial?.kind === "list" ? initial.values.join("\n") : "");
  const [min, setMin] = useState(initial && "min" in initial && initial.min != null ? String(initial.min) : "");
  const [max, setMax] = useState(initial && "max" in initial && initial.max != null ? String(initial.max) : "");

  const build = (): DataValidation | undefined => {
    if (kind === "list") {
      const values = [...new Set(listText.split("\n").map((x) => x.trim()).filter(Boolean))];
      return values.length ? { kind: "list", values } : undefined;
    }
    if (kind === "number" || kind === "textLength") {
      const mn = min.trim() === "" ? undefined : Number(min);
      const mx = max.trim() === "" ? undefined : Number(max);
      const v: DataValidation = kind === "number"
        ? { kind: "number", ...(Number.isFinite(mn) ? { min: mn } : {}), ...(Number.isFinite(mx) ? { max: mx } : {}) }
        : { kind: "textLength", ...(Number.isFinite(mn) ? { min: mn } : {}), ...(Number.isFinite(mx) ? { max: mx } : {}) };
      return isEmptyValidation(v) ? undefined : v;
    }
    return undefined;
  };

  return (
    <Dialog open onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Data validation: {columnName}</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-ink-2 mb-3">Restrict what this column accepts. Invalid entries are refused.</p>
        <label className="mb-1 block text-sm font-medium text-ink-2">Criteria</label>
        <select
          value={kind}
          onChange={(e) => setKind(e.target.value as typeof kind)}
          className="mb-3 h-9 w-full rounded-lg border border-line px-2.5 text-base text-ink outline-none focus:border-[var(--os-brand)]"
        >
          <option value="none">No validation</option>
          <option value="list">List of items (dropdown)</option>
          <option value="number">Number between…</option>
          <option value="textLength">Text length between…</option>
        </select>
        {kind === "list" && (
          <div>
            <label className="mb-1 block text-sm font-medium text-ink-2">Allowed values (one per line)</label>
            <textarea
              value={listText}
              onChange={(e) => setListText(e.target.value)}
              rows={5}
              placeholder={"Todo\nIn progress\nDone"}
              className="w-full rounded-lg border border-line px-2.5 py-2 text-base text-ink outline-none focus:border-[var(--os-brand)]"
            />
          </div>
        )}
        {(kind === "number" || kind === "textLength") && (
          <div className="flex items-center gap-2">
            <input type="number" value={min} onChange={(e) => setMin(e.target.value)} placeholder="min" className="h-9 w-full rounded-lg border border-line px-2.5 text-base text-ink outline-none focus:border-[var(--os-brand)]" />
            <span className="text-sm text-ink-3">to</span>
            <input type="number" value={max} onChange={(e) => setMax(e.target.value)} placeholder="max" className="h-9 w-full rounded-lg border border-line px-2.5 text-base text-ink outline-none focus:border-[var(--os-brand)]" />
          </div>
        )}
        <div className="mt-4 flex justify-between">
          {initial ? (
            <button type="button" onClick={() => onSave(undefined)} className="h-8 px-3 rounded-md text-base text-red-600 hover:bg-red-50">Remove</button>
          ) : <span />}
          <div className="flex gap-2">
            <button type="button" onClick={onClose} className="h-8 px-3 rounded-md text-base text-ink-2 hover:bg-hover border border-line">Cancel</button>
            <button type="button" onClick={() => onSave(kind === "none" ? undefined : build())} className="h-8 px-3 rounded-md text-base font-medium text-white bg-[var(--os-brand)] hover:bg-[var(--os-brand-hover)]">Save</button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** coercePaste + column data-validation: a pasted/filled/stamped value that
 *  fails the column's validation is skipped (never written), matching the
 *  reject-mode the editor enforces. */
function coercePaste(col: Column, raw: string): PasteCoercion {
  const res = coercePasteRaw(col, raw);
  if (res.kind === "write" && col.validation) {
    const v = validateValue(col.validation, res.value);
    if (!v.ok) return { kind: "skip" };
  }
  return res;
}

function coercePasteRaw(col: Column, raw: string): PasteCoercion {
  const text = raw.trim();
  switch (col.type) {
    // Computed. readOnlyCols already tells the grid these can't be edited;
    // a paste over one is dropped rather than written and immediately
    // recomputed away.
    case "formula": case "lookup": case "rollup":
      return { kind: "skip" };
    // A row id, a user id and an uploaded file have no text encoding a
    // paste could safely invent, "Acme Corp" is a title, not an id, and
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
      // a value the user asked to erase, "N/A" or a European "1.234,50" in
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
      // has always stored. This one branch is the chokepoint for paste and
      // the fill handle (the grid sends its series here as text): PLAIN
      // grammar on purpose, a pasted "5%" has no cell format to attach to.
      // The editors (grid cell, formula bar, row modal) take the RICH
      // grammar instead, see openEntryValues.
      return { kind: "write", value: isOpenColumnType(col.type) ? autoTypeEntry(raw) : raw };
  }
}

/* Escape must cancel, never save. Blur is what commits every text-ish editor
 * in this file, and Escape has to blur to close the editor, so the host
 * raises this flag first and each blur handler reads it synchronously (a ref,
 * not state: blur fires in the same tick). Null outside the sheet kernel,
 * where editors commit on blur exactly as before. */
const CellEditCancel = createContext<{ current: boolean } | null>(null);

/** True when any column formula or formula cell mentions [label] (header
 *  references are case-insensitive). A plain text scan: a string literal that
 *  happens to contain "[label]" also counts, which errs on the side of not
 *  clearing a name. */
function formulasReferToLabel(columns: { formula?: string | null }[], rows: { values: Record<string, unknown> }[], label: string): boolean {
  const needle = `[${label.trim().toLowerCase()}]`;
  const mentions = (src: unknown) => typeof src === "string" && src.toLowerCase().includes(needle);
  if (columns.some((c) => mentions(c.formula))) return true;
  for (const r of rows) {
    for (const v of Object.values(r.values ?? {})) {
      if (isFormulaCell(v) && mentions(v[FORMULA_KEY])) return true;
    }
  }
  return false;
}

export function TableEditor({ tableId: routeTableId }: { tableId: string }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  // Work mode is a value, read once here before any early return: the
  // placement is the route's own (its segment's params), so it holds under
  // the task drawer too.
  const place = useWorkPlacement();
  const inWork = place?.kind === "table" && place.id === routeTableId;
  const selfPath = inWork && place ? place.self : canonicalHref("table", routeTableId);
  const { toast, dismiss: dismissToast } = useOsToast();
  const confirm = useConfirm();
  const promptDialog = usePrompt();
  const { prefs, patchPrefs, railApps, bumpRowVersion } = useOsShell();
  const aiEntitled = railApps.some((a) => a.key === "ai");
  const [tableId, setTableId] = useState<string | null>(null);
  // The Share dialog, About, the in-place CSV import, full screen.
  const [shareMode, setShareMode] = useState<"share" | "who" | null>(null);
  const [aboutOpen, setAboutOpen] = useState(false);
  const [csvOpen, setCsvOpen] = useState(false);
  const [fullScreen, setFullScreen] = useState(false);
  const [sheetMoreOpen, setSheetMoreOpen] = useState(false);
  // The title-row "..." opens at the menu; File > Move to Space... opens the
  // same TableRowMenu straight at its Space picker.
  const [sheetMenuMode, setSheetMenuMode] = useState<"menu" | "move">("menu");
  const sheetMoreRef = useRef<HTMLButtonElement>(null);
  const [toolbarMenu, setToolbarMenu] = useState<null | "zoom" | "numfmt" | "text" | "fill" | "more" | "link">(null);
  const tbAnchor = useRef<Record<string, HTMLButtonElement | null>>({});
  // A read-only edit attempt in the formula bar: the reason, inline under the
  // bar in danger text (spec: not a toast), cleared on the next cell.
  const [readOnlyNote, setReadOnlyNote] = useState<string | null>(null);
  // The last server-confirmed save, for the status bar and the indicator.
  const [lastSavedAt, setLastSavedAt] = useState<Date | null>(null);
  // The writes the server has not accepted (lib/sheet-save-ledger): a save
  // settles only the keys it wrote, the indicator reads Not saved while any
  // entry is left, and Retry re-sends every entry.
  const [failedWrites, setFailedWrites] = useState<SaveLedger>(() => new Map());
  const failedWritesRef = useRef<SaveLedger>(failedWrites);
  const saveFailed = failedWrites.size > 0;
  // While a write is unsaved, leaving (reload, tab close, a guarded
  // navigation) asks first; the guard's Save re-sends the ledger.
  const retryFailedWritesRef = useRef<() => Promise<boolean>>(async () => true);
  // load() is a stable callback; what it says after re-applying the ledger
  // (lib/sheet-save-ledger overlayLedger) goes through this ref, so the
  // toast function is not one of its dependencies.
  const reportOrphanedRef = useRef<(cells: number) => void>(() => undefined);
  const onGuardSave = useCallback(() => retryFailedWritesRef.current(), []);
  useDirtyGuard(saveFailed, { onSave: onGuardSave });
  // In-app navigation asks too (the form builder's pattern). useDirtyGuard
  // covers reload and tab close; a click on any app link (the sidebar, the
  // breadcrumb) or the title row's BackButton while a cell is Not saved goes
  // through confirmLeave first, on the app's own dialog. "Retry and leave"
  // re-sends the ledger and leaves only when it lands; when it fails again
  // the second question says so, and "Leave anyway" is the honest way out
  // (offline, signed out) because nothing unsaved is kept on this device.
  useEffect(() => {
    setLeaveConfirmer(async () => {
      const retry = await confirm({
        title: "Some cells are not saved",
        description: "What you typed has not reached the server. Retry now and leave once it saves, or stay and keep editing.",
        confirmLabel: "Retry and leave",
        cancelLabel: "Keep editing",
        destructive: false,
      });
      if (!retry) return "stay";
      if (await retryFailedWritesRef.current()) return "discard"; // saved: nothing is discarded
      const leave = await confirm({
        title: "The cells still did not save",
        description: "If you leave now, what you typed in them is lost. Stay to keep it on screen and press Retry when you are back online.",
        confirmLabel: "Leave anyway",
        cancelLabel: "Keep editing",
        destructive: true,
      });
      return leave ? "discard" : "stay";
    });
    return () => setLeaveConfirmer(null);
  }, [confirm]);
  // The "didn't save" toast lives in the shell, not in this page, so it
  // outlived the table: after "Leave anyway" it rode along onto the Tables
  // list, still offering a Retry for cells the person had just chosen to
  // drop. Leaving the table takes it down.
  useEffect(() => () => dismissToast(SAVE_FAILED_TOAST), [dismissToast]);
  useEffect(() => {
    if (!saveFailed) return;
    const onClick = (e: MouseEvent) => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const a = (e.target as HTMLElement | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
      if (!a || a.target === "_blank" || a.hasAttribute("download")) return;
      const url = new URL(a.href, window.location.href);
      if (url.origin !== window.location.origin || url.pathname === window.location.pathname) return;
      e.preventDefault();
      e.stopPropagation();
      // sectionHrefNow: an object link followed from this guard opens in the
      // section the sheet is in, whichever capture listener saw it first.
      void confirmLeave().then((ok) => { if (ok) router.push(sectionHrefNow(url.pathname + url.search + url.hash)); });
    };
    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, [saveFailed, router]);
  const titleInputRef = useRef<HTMLInputElement>(null);
  // View > Gridlines and View > Formula bar, remembered per person (home.tables).
  const showGridlines = readSheetGridlines(prefs.home);
  const showFormulaBar = readSheetFormulaBar(prefs.home);
  const [table, setTable] = useState<ApiTable | null>(null);
  // The Work crumb's title, once the table has loaded (the gate's placement
  // already names it until then).
  useWorkTitle(inWork && table ? (table.name?.trim() || UNTITLED_TABLE_NAME) : null);
  const [rows, setRowsState] = useState<ApiRow[] | null>(null);
  /* Eagerly-updated mirror of `rows`. The persistent engine host (below) is
   * driven BEFORE each optimistic setState, and swap-rebuilds read the rows
   * of record synchronously, React state only commits at the next render,
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
   * ran a full pass, 560ms at 2k rows, 11.8s at 10k). The host still
   * computes over the UNSORTED rows order: display sort never reaches it,
   * which is what keeps a sorted grid from changing any formula's value.
   *
   * A full SWAP (new instance) happens ONLY on bulk data arrival (initial
   * load, refetch, CSV import's reload) and on column structure/type
   * changes without an incremental host op (add, type change, column-op
   * undo/redo replays), a column's TYPE changes engine semantics (numeric
   * text only counts in aggregates in numeric-typed columns), so the
   * rebuild is the CORRECT lever there, and cheap now that structure
   * changes are rare events rather than every keystroke.
   *
   * engineVersion bumps after every host mutation so memos and renders
   * re-read a host whose identity did not change. */
  const engineHostRef = useRef<TableEngine | null>(null);
  const [engineVersion, setEngineVersion] = useState(0);
  const [namedRangesOpen, setNamedRangesOpen] = useState(false);
  // Insert > Function > More functions…: the function reference drawer.
  const [functionsOpen, setFunctionsOpen] = useState(false);
  // The sheet's chords in the "?" overlay, while the grid is on screen.
  useSheetShortcutList(!!table);
  const [trashOpen, setTrashOpen] = useState(false);
  const [pivotOpen, setPivotOpen] = useState(false);
  const [askOpen, setAskOpen] = useState(false);
  /** Re-render + re-derive after an in-place host mutation. */
  const bumpEngine = useCallback(() => setEngineVersion((v) => v + 1), []);
  /** Swap in a brand-new host built from canonical page state. */
  const rebuildEngine = useCallback((columns: readonly Column[], rowList: readonly ApiRow[]) => {
    engineHostRef.current = createTableEngine({
      columns,
      rows: rowList,
      namedRanges: readNamedRanges(tableRef.current?.settings),
    });
    setEngineVersion((v) => v + 1);
  }, []);

  /* Row-VALUE persistence (single-cell PATCH + batch value writes) is
   * serialized through one per-table promise chain, so persistence order =
   * user action order, the recorded rapid-same-cell-edit race, where two
   * quick commits could land their PATCHes inverted (last-write-loses).
   * Reads, row creates and column ops deliberately do NOT queue, and the
   * optimistic state updates stay synchronous: only the fetches wait. */
  const writeQueueRef = useRef(createSerialQueue());
  useEffect(() => { writeQueueRef.current = createSerialQueue(); }, [tableId]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [notFound, setNotFound] = useState(false);
  /* ── Phase 5a streaming transport (docs/plans/tables.md, amended
   * decision): rows arrive in keyset chunks until the WHOLE table is
   * resident. loadGenRef guards every async effect of load(), a refetch
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
  // Saved-view JSON still lives in DataTable.views server-side. views[0] is
  // the persistence slot only: this surface reads and writes its sort,
  // filter and freeze and leaves every other view untouched. The
  // view-switching UI is gone (Excel-ify decision 1).
  const viewsRef = useRef<SavedView[]>([]);
  // The column filters (lib/sheet-filters): every ticked column, including
  // one ticked with nothing chosen yet (it shows its control and narrows
  // nothing). Several at once, all must hold.
  const [filters, setFilters] = useState<SheetColumnFilter[]>([]);
  const filterActive = filters.some(filterIsActive);
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
  // The row detail drawer lives at ?row=<id> (design 4.5), so Copy link on
  // it works and Back closes it. replace, not push: opening a row is not a
  // page in history.
  const activeRowId = searchParams.get("row");
  const setActiveRowId = useCallback((id: string | null) => {
    const next = new URLSearchParams(window.location.search);
    if (id) next.set("row", id); else next.delete("row");
    const s = next.toString();
    router.replace(`${selfPath}${s ? `?${s}` : ""}`, { scroll: false });
  }, [router, selfPath]);
  // Relational: rows of every table this one links to (for pickers + lookup/rollup).
  const [linkedTables, setLinkedTables] = useState<Record<string, LinkedTable>>({});
  // All org tables (for the link-target picker in the relation config modal).
  const [allTables, setAllTables] = useState<{ id: string; name: string }[]>([]);
  // Column currently being configured in the relation modal (link/lookup/rollup).
  const [configColId, setConfigColId] = useState<string | null>(null);
  /* Column naming and typing (Phase 5, spec-tables-forms "Naming a column",
   * "Typing a column"). renamingColId swaps that header's label for the
   * inline input; typePicker is the ColumnTypePicker's anchor; typeChange is
   * a lossy change waiting on its confirm; optionsColId is the select
   * options editor; pendingRelType is a Link / Lookup / Rollup choice waiting
   * on the relation dialog (the type lands only when that dialog saves). */
  const [renamingColId, setRenamingColId] = useState<string | null>(null);
  const [typePicker, setTypePicker] = useState<{ colId: string; top: number; left: number } | null>(null);
  const [typeChange, setTypeChange] = useState<{ colId: string; toType: ColumnTypeValue; cells: number } | null>(null);
  const [optionsColId, setOptionsColId] = useState<string | null>(null);
  const [pendingRelType, setPendingRelType] = useState<{ colId: string; type: ColumnTypeValue } | null>(null);
  // Toolbar filter toggle: the search/filter row hides behind the funnel
  // icon (Sheets keeps its toolbar dense; the row appears on demand).
  const [filterOpen, setFilterOpen] = useState(false);
  // Zoom (75..150), per device in localStorage `workwrk:tables:zoom:{id}`
  // (settings 7.3 allows one sheet's zoom as ephemera). The old key
  // `workwrk:sheet-zoom:{id}` is read as a fallback, so no saved zoom resets
  // when the key changes. Applied as CSS `zoom` on the grid wrapper.
  const [zoom, setZoom] = useState(100);
  useEffect(() => {
    if (!tableId) return;
    let storage: Storage | null = null;
    try { storage = window.localStorage; } catch { storage = null; }
    const v = readZoom(storage, tableId);
    const t = setTimeout(() => setZoom(v), 0);
    return () => clearTimeout(t);
  }, [tableId]);
  const changeZoom = (v: number) => {
    setZoom(v);
    if (!tableId) return;
    try { window.localStorage.setItem(zoomKey(tableId), String(v)); } catch { /* best effort */ }
  };
  // The toolbar Σ upgrade: while set, the very next "=" seed the kernel
  // opens an editor with becomes this string. See insertSumSeed below.
  const sigmaSeedRef = useRef<string | null>(null);
  // The Σ upgrade snapshotted for the WHOLE editing session (keyed by cell):
  // the host re-seeds its input whenever the seed prop CHANGES, and the
  // kernel re-renders the editor on every scroll, so a seed that flapped
  // back to "=" after the one-tick sigmaSeedRef clear would wipe the draft
  // mid-edit. Cleared when the session commits/cancels.
  const sigmaSessionRef = useRef<{ rowId: string; colId: string; seed: string } | null>(null);
  // Name at title-focus time, so an edit-free blur skips the PATCH.
  const titleBeforeEditRef = useRef<string | null>(null);
  // Org users (for Person columns), lazy-loaded when one exists.
  const [orgUsers, setOrgUsers] = useState<OrgUser[]>([]);
  // The BackButton target (back-map 7): the table's Space page and name when
  // `spaceId` is set, else /tables labelled Tables.
  const [spaceBack, setSpaceBack] = useState<{ fallbackHref: string; label: string } | null>(null);
  // Column drag-reorder + resize.
  const [dragColId, setDragColId] = useState<string | null>(null);
  // `moved` gates the release persist: a plain click on the grip (and each
  // press of a double-click) must not fire a stale-width columns PATCH
  // that could land AFTER the autofit's and overwrite it.
  const resizeRef = useRef<{ colId: string; startX: number; startW: number; moved: boolean } | null>(null);
  // While a header-grip drag is live the kernel draws its full-height
  // guide at this column's right edge (colResizeGuideId); null = no guide.
  const [resizingColId, setResizingColId] = useState<string | null>(null);
  // Row right-click menu, open / delete (single or the whole selected
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
  // Header right-click menu, the Sheets model: column operations (sort /
  // delete / formula / relation) live here now that the hover icon cluster
  // and the per-column "…" popover are gone. Same MorePortal point-mode
  // pattern as the row menu above.
  const [headerMenu, setHeaderMenu] = useState<{ colId: string; x: number; y: number } | null>(null);
  const [rulesColId, setRulesColId] = useState<string | null>(null);
  const [validationColId, setValidationColId] = useState<string | null>(null);
  const headerMenuAnchorRef = useRef<HTMLElement | null>(null); // unused in point mode
  const headerMenuPanelRef = useRef<HTMLDivElement | null>(null);
  // Cmd/Ctrl+B/I/U anywhere on the sheet (capture phase): after clicking a
  // toolbar button the focus sits on that button, where the grid's own
  // keydown never hears the shortcut and the browser does its own thing
  // with it. Grid-focused events are skipped, the kernel's handler owns
  // those (skipping prevents a double toggle). Ref-filled per render since
  // toggleStyleFlag is defined after the early returns below.
  const formatKeyRef = useRef<((k: "b" | "i" | "u") => void) | null>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.altKey || e.shiftKey) return;
      const k = e.key.toLowerCase();
      if (k !== "b" && k !== "i" && k !== "u") return;
      const t = e.target as HTMLElement | null;
      if (t?.closest?.('input, textarea, select, [contenteditable]:not([contenteditable="false"])')) return;
      if (t?.closest?.('[role="grid"]')) return; // kernel path owns it there
      if (!formatKeyRef.current) return;
      e.preventDefault();
      formatKeyRef.current(k as "b" | "i" | "u");
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, []);
  // Cmd/Ctrl+F / Cmd/Ctrl+H anywhere on the sheet page (capture phase, same
  // shape as the B/I/U handler above): preventDefault so the browser's own
  // find bar never opens over the sheet. Unlike B/I/U, grid-focused events
  // are NOT skipped, the kernel has no find handler, so this is the only
  // door. v1 scope decision (Sheets diverges: it commits the edit first):
  // while the caret sits in any editor input the browser's native find
  // stays reachable, EXCEPT inside the find card's own inputs, where
  // Cmd+F re-focuses the query and Cmd+H reveals the replace row instead
  // of stacking the native bar on top of ours. Ref-filled per render like
  // formatKeyRef, since openFind is defined after the early returns.
  const findKeyRef = useRef<((withReplace: boolean) => void) | null>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.altKey || e.shiftKey) return;
      const k = e.key.toLowerCase();
      if (k !== "f" && k !== "h") return;
      const t = e.target as HTMLElement | null;
      if (t?.closest?.('input, textarea, select, [contenteditable]:not([contenteditable="false"])') && !t?.closest?.("[data-sheet-find]")) return;
      if (!findKeyRef.current) return;
      e.preventDefault();
      findKeyRef.current(k === "h");
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, []);
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

  // The route reads its own params now and passes the id in. It is still
  // adopted a tick after mount, exactly as `params.then` adopted it, so every
  // effect keyed on tableId sees the same first null it always saw.
  useEffect(() => { void Promise.resolve(routeTableId).then(setTableId); }, [routeTableId]);

  const load = useCallback(async () => {
    if (!tableId) return;
    // Every load owns a generation. Chunk application and ALL completion
    // effects below check it and bail when superseded, so a refetch that
    // starts during a slow stream can never interleave rows or rebuild the
    // engine over the newer load's world.
    const gen = ++loadGenRef.current;
    setNotFound(false);
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
      // The table fetch and the FIRST row page run in parallel, the same
      // wire timing as the old Promise.all, and the stream helper then
      // consumes the pre-started page as page one.
      let firstPage: ReturnType<typeof fetchRowPage> | null = fetchRowPage(null);
      // If the table fetch throws first, the abandoned page must not
      // surface as an unhandled rejection; awaiting it later still throws.
      firstPage.catch(() => undefined);
      const tRes = await fetch(`/api/tables/${tableId}`);
      // The API hides existence (404 for an id the viewer holds nothing
      // on, 400 for a malformed one): that is the in-shell 404, not an
      // error with a Retry that can only fail again.
      if (tRes.status === 404 || tRes.status === 400) {
        if (gen === loadGenRef.current) setNotFound(true);
        return;
      }
      if (!tRes.ok) throw new Error(`HTTP ${tRes.status}`);
      const td = await tRes.json();
      const t: ApiTable = td.data ?? td;
      t.columns = Array.isArray(t.columns) ? t.columns : [];
      if (gen !== loadGenRef.current) return;
      // A table field the server has not accepted yet (a column rename, a
      // column config, the name) stays on screen through the reload: server
      // truth plus the unsaved ledger, never server truth alone, or the
      // grid would show the old value while the indicator reads Not saved.
      // Columns merge by id (lib/sheet-save-ledger overlayTableEntry), so a
      // column someone else added while this save was failing is kept.
      if (failedWritesRef.current.has(TABLE_LEDGER_KEY)) {
        Object.assign(t, overlayTableEntry(failedWritesRef.current, t));
        t.columns = Array.isArray(t.columns) ? t.columns : [];
      }
      if (t.spaceId) {
        void fetch(`/api/spaces/${t.spaceId}`)
          .then(async (r) => {
            if (!r.ok) return null;
            const d = await r.json();
            const s = d.space as { slug?: string; name?: string } | undefined;
            return s?.slug ? { fallbackHref: `/spaces/${s.slug}`, label: s.name || "Space" } : null;
          })
          .then((back) => { if (gen === loadGenRef.current) setSpaceBack(back); })
          .catch(() => { if (gen === loadGenRef.current) setSpaceBack(null); });
      } else {
        setSpaceBack(null);
      }

      /* THE HONESTY RULE: rows appear progressively, but the engine host is
       * rebuilt exactly ONCE, after the FINAL chunk, the formula engine is
       * client-side and a value computed over a partial row set would be
       * silently wrong (the one forbidden sin). A single-chunk stream,
       * every table within the old 5k ceiling, buffers its one chunk and
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
        // Single chunk: the pre-stream sequence, byte-for-byte, table,
        // rows and engine land together. (The progress clear is a no-op
        // here unless this load superseded a mid-stream one.)
        setStreamProgress(null);
        // The unsaved cells go back on top of the server's rows (the same
        // re-apply as the table fields above).
        const overlaid = overlayLedger(failedWritesRef.current, t, (firstChunk ?? allRows) as ApiRow[]);
        const rowsArr = overlaid.rows;
        if (overlaid.ledger !== failedWritesRef.current) {
          failedWritesRef.current = overlaid.ledger;
          setFailedWrites(overlaid.ledger);
        }
        if (overlaid.orphanedCells > 0) reportOrphanedRef.current(overlaid.orphanedCells);
        setTable(t);
        commitRows(rowsArr);
        // Bulk data arrival (initial load, refetch, CSV import's reload) is a
        // swap trigger: rebuild the host once from server truth. This also
        // heals any host/state drift, which is why every failure path reloads.
        rebuildEngine(t.columns, rowsArr);
      } else {
        // Completion rebuild reads rowsRef, NOT allRows: value edits made
        // while streaming went through commitRows into the mirror, and
        // commitRows is synchronous, every chunk append of this generation
        // has already landed by the time the stream resolves.
        setStreamProgress(null);
        if (failedWritesRef.current.size > 0) {
          const overlaid = overlayLedger(failedWritesRef.current, t, rowsRef.current ?? []);
          commitRows(overlaid.rows);
          if (overlaid.ledger !== failedWritesRef.current) {
            failedWritesRef.current = overlaid.ledger;
            setFailedWrites(overlaid.ledger);
          }
          if (overlaid.orphanedCells > 0) reportOrphanedRef.current(overlaid.orphanedCells);
        }
        rebuildEngine(t.columns, rowsRef.current ?? []);
      }
      const savedViews: SavedView[] = Array.isArray(t.views) && t.views.length ? t.views : [{ id: "default", name: "Grid", type: "grid" }];
      viewsRef.current = savedViews;
      setSortState(savedViews[0]?.config?.sort ?? null);
      // Filter restores from the same first-view config sort does, but only
      // while its column still exists: applying a filter over a deleted
      // column would silently blank the whole sheet.
      // readSavedFilters restores only what the panel can SHOW (the column
      // still exists, its type still takes that control, a chosen option is
      // still an option), otherwise the filter would hide rows while the
      // panel shows nothing ticked: an invisible filter with no way to clear
      // it. It also reads the previous release's single `filter`.
      setFilters(readSavedFilters(savedViews[0]?.config, t.columns));
      // Freeze restores from the same first-view config, clamped against the
      // rows/columns that exist NOW (rowsRef is already the full table: both
      // stream paths above commit synchronously before this line), a freeze
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
   * which throw on failure, a failed undo must never pretend it worked
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
      toast(`Couldn't undo ${undoStack.peekUndoLabel() ?? "the last action"}. Reloading.`);
      void load();
    } finally { refreshUndoUi(); }
  }, [undoStack, toast, load, refreshUndoUi]);
  const runRedo = useCallback(async () => {
    const op = undoStack.redo();
    refreshUndoUi();
    try {
      await op;
    } catch {
      toast(`Couldn't redo ${undoStack.peekRedoLabel() ?? "the last action"}. Reloading.`);
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
   *  clock snapshot, one recalc, a 500-cell batch is one pass, not 500),
   *  ahead of the caller's optimistic setState. Writes to rows no longer in
   *  the mirror are dropped, matching the server merge's stale-id
   *  tolerance; unknown columns are dropped via the host's own column map.
   *  If the host still refuses an id, drift, which would mean a missed
   *  mutation site, the swap IS the recovery: rebuild from canonical
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
   *  and this write), missingIds in the response, instead of only
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
   *  response) use missingIdsOf on their parse, a Response body reads
   *  once. Parse failures read as “nothing missing”: surfacing is
   *  best-effort and must never fail a write that the server applied. */
  async function readBatchMissingIds(res: Response): Promise<string[]> {
    const d = await res.json().catch(() => null);
    return missingIdsOf(d?.data ?? d);
  }
  /** Toast + reload when a batch write reported rows deleted elsewhere.
   *  A full load() rather than surgical eviction: the remote deletion also
   *  shifted every A1 row ref below it, and the reload rebuilds the engine
   *  host from server truth, the one guaranteed-coherent recovery. */
  function noteRowsDeletedElsewhere(ids: ReadonlySet<string>) {
    if (ids.size === 0) return;
    toast(`${ids.size} row${ids.size === 1 ? " was" : "s were"} deleted elsewhere. Reloading.`);
    void load();
  }

  function noteWriteFailed(key: string, values: Record<string, unknown>) {
    const next = ledgerFail(failedWritesRef.current, key, values);
    failedWritesRef.current = next;
    setFailedWrites(next);
  }

  /** A save landed (or the server's value replaced ours): the keys it wrote
   *  are no longer unsaved. Keys it did not write stay in the ledger. */
  function noteWriteSettled(key: string, keys: readonly string[]) {
    const next = ledgerSettle(failedWritesRef.current, key, keys);
    if (next === failedWritesRef.current) return;
    failedWritesRef.current = next;
    setFailedWrites(next);
    // Everything saved: the "didn't save" toasts are now false, so they go
    // with the ledger, whichever Retry (toast, title indicator, dirty-guard
    // Save) or later write did it.
    if (next.size === 0) dismissToast(SAVE_FAILED_TOAST);
  }

  retryFailedWritesRef.current = retryFailedWrites;
  reportOrphanedRef.current = (cells) => {
    toast(`${cells} unsaved cell${cells === 1 ? " was" : "s were"} on rows deleted elsewhere, so ${cells === 1 ? "it" : "they"} could not be saved`, { tone: "danger" });
  };

  /** Re-send every write the server has not accepted. True when the ledger
   *  is empty afterwards (the dirty guard's Save uses this). */
  async function retryFailedWrites(): Promise<boolean> {
    const entries = [...failedWritesRef.current];
    await Promise.all(entries.map(async ([key, values]) => {
      if (key === TABLE_LEDGER_KEY) {
        // Columns re-send the CURRENT columns (later edits ride along);
        // every other field re-sends the value that failed.
        const { columns, ...rest } = values as Partial<ApiTable>;
        const cur = tableRef.current;
        if (columns !== undefined && cur) await persistColumns(cur.columns);
        if (Object.keys(rest).length > 0) await patchTable(rest);
        return;
      }
      const rowId = ledgerRowId(key);
      if (rowId) await patchRow(rowId, { ...values }, { guard: false });
    }));
    return failedWritesRef.current.size === 0;
  }

  /** Batch cell writes with optimistic local apply. THROWS on any refused
   *  chunk, used by undo/redo bodies where honesty is the contract, and by
   *  callers that wrap their own catch. */
  async function writeValuesBatchStrict(updates: { id: string; values: Record<string, unknown> }[]) {
    if (!tableId || updates.length === 0) return;
    const byRow = new Map(updates.map((u) => [u.id, u.values]));
    // Host first, then the mirror. Rows deleted since the command was
    // captured are simply absent from state and skipped by the server merge
    // the documented v1 semantic: such a command may no-op, but it never
    // corrupts, and driveHostWrites drops them the same way.
    driveHostWrites(updates.flatMap((u) => Object.entries(u.values).map(([colId, raw]) => ({ colId, rowId: u.id, raw }))));
    commitRows((prev) => prev ? prev.map((r) => byRow.has(r.id) ? { ...r, values: { ...r.values, ...byRow.get(r.id)! } } : r) : prev);
    // All chunks ride ONE queued job so another value write can't
    // interleave between the slices of a single logical batch.
    const missing = new Set<string>();
    await writeQueueRef.current.run(async () => {
      for (let i = 0; i < updates.length; i += BATCH_MAX_OPS) {
        const res = await fetchWithRetry(`/api/tables/${tableId}/rows/batch`, {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ updates: updates.slice(i, i + BATCH_MAX_OPS) }),
        });
        if (!res.ok) throw new Error(`batch update HTTP ${res.status}`);
        for (const mid of await readBatchMissingIds(res)) missing.add(mid);
      }
    });
    // Surfaced AFTER the queued job so the reload can't interleave with a
    // chunk still in flight, and NOT a throw: the route applied every
    // still-live row, so an undo/redo body reporting failure here would
    // re-push a command that mostly landed.
    noteRowsDeletedElsewhere(missing);
    setLastSavedAt(new Date());
    for (const u of updates) noteWriteSettled(rowLedgerKey(u.id), Object.keys(u.values));
  }

  /** Batch row deletes (chunked), optimistic. Throws on a refused chunk;
   *  stale ids are tolerated by the route, which makes retries idempotent.
   *  Drives the host row by row (cumulative: later deletes see the shape
   *  earlier ones left) and persists the SURVIVORS' ref rewrites, but only
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
          if (!live.has(id)) continue; // stale id, the route tolerates it, so does the host drive
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
      const res = await fetchWithRetry(`/api/tables/${tableId}/rows/batch`, {
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
   *  original positions land back in the middle, the engine's row
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
    // rebuilds, a LARGE batch (blank-sheet seed, bulk-undo restore, big
    // paste) absorbs as ONE swap instead. No rewrite is lost that way:
    // appends can't shift any ref, and the only mid-table bulk insert,
    // bulk-delete undo, restores the survivors' sources itself right
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

  /** Persist a full columns array, optimistic, throwing on failure, the
   *  strict sibling of persistColumns for undo/redo bodies. Column-op
   *  undo/redo replays arbitrary columns arrays (structure and type may
   *  both differ), so by default this SWAPS the engine host, the correct
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
    const res = await fetchWithRetry(`/api/tables/${tableId}`, {
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
        // Rows stream to COMPLETION before the table enters linkedTables,
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

  /** True when the server accepted the patch, the undo push sites need to
   *  know an action actually landed before recording how to reverse it. */
  async function patchTable(patch: Partial<ApiTable>): Promise<boolean> {
    if (!tableId) return false;
    try {
      // A table PATCH sets fields, so a repeat is harmless: retried on a
      // network failure or a 5xx, with keepalive, before it reports false.
      const res = await fetchWithRetry(`/api/tables/${tableId}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      // The title row's AutosaveIndicator and the status bar's last-saved
      // time read these; a failure stays visible until a save lands.
      if (res.ok) { setLastSavedAt(new Date()); noteWriteSettled(TABLE_LEDGER_KEY, Object.keys(patch)); }
      else noteWriteFailed(TABLE_LEDGER_KEY, patch as Record<string, unknown>);
      return res.ok;
    } catch { noteWriteFailed(TABLE_LEDGER_KEY, patch as Record<string, unknown>); return false; }
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
   * failure, the undo stack needs the truth. */

  async function performRenameStrict(colId: string, label: string) {
    const cur = tableRef.current;
    if (!cur) throw new Error("table gone");
    if (!cur.columns.some((c) => c.id === colId)) return; // column deleted since, no-op, never corrupt
    // An empty label is legal on this surface (anonymous Excel columns) but
    // the engine can't rewrite refs INTO it, "[]" doesn't tokenize, so a
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
    // would compute, [Old] refs then show #NAME?, honestly.
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
      if (!cur.columns.some((c) => c.id === colId)) return; // column deleted since, no-op
      await saveColumnsStrict(cur.columns.map((c) => (c.id === colId ? { ...c, ...patch } : c)));
    };
    pushUndo({ label, undo: () => apply(before), redo: () => apply(after) });
  }

  /* setColumnFormat / setColumnRules died with the per-column "…" popover
   * (Sheets parity): the toolbar's 123/$/%/decimals cluster is the only
   * number-format editor now, and highlight RULES lost their editor while
   * existing rules keep painting (cellStyleFor below reads col.rules unchanged). */

  /** Apply per-column before/after patches as ONE optimistic columns write
   *  and ONE undo command, the multi-column sibling of pushColumnPatch, for
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
    // change what the engine computes, the swap is the correct lever for
    // those. format/rules are display-only: no host action at all.
    if (patches.some((p) => "type" in p.after || "formula" in p.after || "label" in p.after)) {
      rebuildEngine(cols, rowsRef.current ?? []);
    }
    void persistColumns(cols).then((ok) => {
      // Never a silent failure: the column on screen must be the column the
      // server holds, so a refused write says so and reloads the truth.
      if (!ok) { toast(`Couldn't save: ${label}. Reloading the table.`); void load(); return; }
      const apply = async (pick: "before" | "after") => {
        const live = tableRef.current;
        if (!live) throw new Error("table gone");
        await saveColumnsStrict(live.columns.map((c) => (byId.has(c.id) ? { ...c, ...byId.get(c.id)![pick] } : c)));
      };
      pushUndo({ label, undo: () => apply("before"), redo: () => apply("after") });
    });
  }

  /** The "123" menu's COLUMN-level action (Sheets' Format → Number →
   *  Currency mental model, replacing the rejected Type submenu): a kind
   *  sets col.type AND a starter col.format together, in a single write so
   *  a single undo restores both. The kind→patch mapping is shared with the
   *  column "…" popover via lib/sheet-format-actions, so the two menus
   *  cannot drift. Legacy/relational columns are skipped, the popover
   *  shows them a read-only line instead. The toolbar reaches this only for
   *  the editor-changing kinds (Date / Checkbox); its number kinds route
   *  per cell on open columns, see routeNumberFormat. */
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
   *  a legacy table's other views pass through untouched, they just never
   *  render again on this surface. */
  const persistSort = (sn: SheetSort) => {
    setSortState(sn);
    const cur: SavedView[] = viewsRef.current.length ? viewsRef.current : [{ id: "default", name: "Grid", type: "grid" }];
    const next = cur.map((v, i) => (i === 0 ? { ...v, config: { ...v.config, sort: sn ?? undefined } } : v));
    viewsRef.current = next;
    void patchTable({ views: next });
  };

  /** Filters ride the same first-view config JSON sort does, written just
   *  as eagerly (persistSort above is the template). Only a filter that
   *  NARROWS persists (lib/sheet-filters filtersToConfig): a ticked column
   *  with nothing chosen yet is a no-op not worth resurrecting on reload.
   *  `undefined` drops the key in the PATCH body's JSON, which is how
   *  clearing reaches the server. The legacy single `filter` key is written
   *  alongside for one release (the previous client reads only it). */
  const persistFilters = (nextFilters: SheetColumnFilter[]) => {
    setFilters(nextFilters);
    const { filters: saved, filter } = filtersToConfig(nextFilters);
    const cur: SavedView[] = viewsRef.current.length ? viewsRef.current : [{ id: "default", name: "Grid", type: "grid" }];
    const next = cur.map((v, i) => (i === 0 ? { ...v, config: { ...v.config, filters: saved, filter } } : v));
    viewsRef.current = next;
    void patchTable({ views: next });
  };
  /** Change one column's filter, keeping every other one. */
  const setColumnFilter = (colId: string, next: SheetColumnFilter | null) => {
    const others = filters.filter((f) => f.colId !== colId);
    persistFilters(next ? [...others, next] : others);
  };

  /** Freeze rides the same first-view config JSON (persistSort is the
   *  template): written eagerly, `undefined` drops the key so an unfreeze
   *  reaches the server as an absent slot. No undo entry on purpose,
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

  /** "+" appends a generic text column INSTANTLY, no dialog, no type
   *  picker (Excel-ify decision 3). A column's type/format lives in its
   *  "…" menu now. tableRef is bumped eagerly so rapid clicks compose
   *  (each sees the column the previous click just appended). */
  /** The one-click start of a columnless table (the old "Start sheet"):
   *  the canonical 26 columns, then 1,000 blank rows when it has none. */
  async function startTable() {
    const cur = tableRef.current ?? table;
    if (!cur || cur.columns.length > 0) return;
    const cols: Column[] = Array.from({ length: NEW_SHEET_COLUMNS }, () => ({ id: newId(), type: "short_text", label: "" }));
    // Eager tableRef bump, same as addColumn: the guard above must see the
    // new columns immediately, or a double click faster than the sync
    // effect would seed the rows twice.
    if (tableRef.current) tableRef.current = { ...tableRef.current, columns: cols };
    setTable((prev) => (prev ? { ...prev, columns: cols } : prev));
    rebuildEngine(cols, rowsRef.current ?? []);
    const ok = await persistColumns(cols);
    if (!ok) { toast("Couldn't start the table", { tone: "danger" }); void load(); return; }
    if ((rowsRef.current ?? []).length > 0) return;
    try {
      await insertRowsBatchStrict(Array.from({ length: NEW_SHEET_ROWS }, () => ({ values: {} })));
    } catch { toast("Couldn't add the starter rows", { tone: "danger" }); }
  }

  async function addColumn() {
    const cur = tableRef.current ?? table;
    if (!cur) return;
    const def: Column = { id: newId(), type: "short_text", label: "" };
    const cols = [...cur.columns, def];
    tableRef.current = { ...cur, columns: cols };
    setTable((prev) => (prev ? { ...prev, columns: [...prev.columns, def] } : prev));
    // Column structure changed with no incremental host op, swap. An
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
   *  refs past it shift) and persist, the strict inverse of an append,
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
   *  the way "+" does, then performMoveStrict it beside the anchor, the
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
     *  bump, swap the host, persist, throwing, since what follows must
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
        toast("Couldn't insert the column. Reloading.");
        void load();
      }
    })();
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
      if (!ok) { toast("Couldn't save the column settings. Reloading the table."); void load(); return; }
      if (before) pushColumnPatch(`configure "${col!.label}"`, colId, before, patch);
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
    // A column FORMULA change re-fills every cell of the column, engine
    // semantics, no incremental op: swap.
    rebuildEngine(cols, rowsRef.current ?? []);
    const ok = await persistColumns(cols);
    if (ok) pushColumnPatch(`edit formula of "${col.label}"`, colId, { formula: prev }, { formula: next });
  }

  /* The header rename input (Phase 5) reaches this through commitRename. The
   * input keeps its own local text and writes once, on Enter or blur, so the
   * pre-edit label is still the live column's; the last SERVER-CONFIRMED
   * columns are preferred when present because they are the truth a reload
   * would show. Rewrites every stored [Old] formula reference through the
   * engine's columnRenamed, persists, and pushes one undo command. */
  function renameColumn(colId: string, label: string) {
    if (!table) return;
    const prevLabel = savedColumnsRef.current?.find((c) => c.id === colId)?.label
      ?? table.columns.find((c) => c.id === colId)?.label;
    // Rewrites come from the PRE-rename host, same as deleteColumn: [Header]
    // refs must follow the rename, and without persisting the rewritten
    // sources a rename to a label another column already carries would
    // silently repoint refs via the leftmost-wins rule.
    // Empty labels never go through the engine: "[]" doesn't tokenize, so
    // rewriting [Old] refs to it would corrupt stored formulas. They keep
    // [Old] and show #NAME? instead, honest and undoable.
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
      // A failed write is never silent: say so and reload the truth, so the
      // header never shows a name the server does not have.
      if (!ok) { toast("Couldn't rename the column. Reloading the table."); void load(); return; }
      // Awaited so an immediate undo can't race the rewrite POST (it never throws).
      await persistCellRewrites(res?.rewritten.cells ?? []);
      if (prevLabel !== undefined && prevLabel !== label) {
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

  /** The rename input's commit: clean the name, skip a no-op, refuse a name
   *  another column already carries (a [Name] formula reference would then
   *  point at whichever column is leftmost), then rename. */
  function commitRename(colId: string, raw: string) {
    const cur = tableRef.current ?? table;
    const col = cur?.columns.find((c) => c.id === colId);
    if (!cur || !col) return;
    const next = cleanColumnName(raw);
    if (next === col.label) return;
    // Mid-stream the engine host still holds the pre-stream world and the
    // tail rows have not arrived, so the [Old] references in them could not
    // be rewritten and would read #NAME? after the rename.
    if (streamProgress) { toast("Wait for the rows to finish loading, then rename the column"); return; }
    // Clearing a name cannot go through the engine ("[]" does not tokenize),
    // so every formula that says [Old] would silently turn into #NAME?.
    // Refuse while anything refers to it; a rename keeps them working.
    if (next === "" && col.label.trim() !== "" && formulasReferToLabel(cur.columns, rowsRef.current ?? [], col.label)) {
      toast(`Formulas use [${col.label}]. Give the column a new name instead of clearing it.`);
      return;
    }
    if (next && cur.columns.some((c) => c.id !== colId && c.label.trim().toLowerCase() === next.toLowerCase())) {
      toast(`Another column is already called "${next}"`);
      return;
    }
    renameColumn(colId, next);
  }

  /** Put keyboard focus back on a column's header (after a rename or a menu). */
  const focusHeaderCell = (colId: string) => {
    const idx = (tableRef.current ?? table)?.columns.findIndex((c) => c.id === colId) ?? -1;
    if (idx < 0) return;
    window.requestAnimationFrame(() => {
      gridWrapElRef.current?.querySelector<HTMLElement>(`[role="columnheader"][data-col-index="${idx}"]`)?.focus({ preventScroll: true });
    });
  };

  /** The ColumnTypePicker's choice. A type change never rewrites a stored
   *  cell; it changes how cells read, so the confirm below names how many
   *  would read differently and offers to copy them into a Text column
   *  first. Types that mean nothing without more input open their editor:
   *  Formula asks for the formula, Link / Lookup / Rollup open the relation
   *  dialog, and a select opens its options editor after the change. */
  async function chooseColumnType(colId: string, toType: ColumnTypeValue) {
    const cur = tableRef.current ?? table;
    const col = cur?.columns.find((c) => c.id === colId);
    if (!cur || !col || col.type === toType) return;
    // Mid-stream the tail rows have not arrived: a count or a copy made now
    // would silently miss them.
    if (streamProgress) { toast("Wait for the rows to finish loading, then change the type"); return; }
    const values = (rowsRef.current ?? []).map((r) => r.values[colId]);
    const patch = typeChangePatch(col, toType, values);
    // Leaving a computed type (Formula, Lookup, Rollup) hides every value the
    // column was SHOWING, which lives nowhere in the stored cells, so those
    // count too, and "keep the old values" copies what was on screen.
    const losses = COMPUTED_TYPES.has(col.type)
      ? (rowsRef.current ?? []).filter((r) => computedCellText(col, r) !== "").length
      : countTypeChangeLosses(values, toType, patch.options ?? col.options);
    if (losses > 0) { setTypeChange({ colId, toType, cells: losses }); return; }
    await applyColumnType(colId, toType);
  }

  /** What a computed column shows in one row, as text. */
  function computedCellText(col: Column, row: ApiRow): string {
    try {
      if (col.type === "formula") return String(engineHostRef.current?.display(col.id, row.id) ?? "");
      if (col.type === "lookup" || col.type === "rollup") return String(relationalValue(col, row) ?? "");
    } catch { /* fall through: nothing to show */ }
    return "";
  }

  /** Write the type (and whatever it needs first). */
  async function applyColumnType(colId: string, toType: ColumnTypeValue) {
    const cur = tableRef.current ?? table;
    const col = cur?.columns.find((c) => c.id === colId);
    if (!cur || !col) return;
    // Link / Lookup / Rollup mean nothing until configured: open the relation
    // dialog with the type pending, and the type lands with its settings.
    if (RELATION_TYPES.has(toType)) {
      setPendingRelType({ colId, type: toType });
      setConfigColId(colId);
      return;
    }
    const values = (rowsRef.current ?? []).map((r) => r.values[colId]);
    const patch: Partial<Column> = { ...typeChangePatch(col, toType, values) } as Partial<Column>;
    if (toType === "formula") {
      const f = await promptDialog({ title: "Formula for this column", defaultValue: col.formula ?? "=" });
      if (f == null) return;
      patch.formula = f.trim();
    }
    const before: Partial<Column> = {};
    for (const k of Object.keys(patch)) (before as Record<string, unknown>)[k] = (col as unknown as Record<string, unknown>)[k];
    applyColumnPatches([{ colId, before, after: patch }], `change ${columnDisplayName(col.label, cur.columns.indexOf(col))} to ${columnTypeLabel(toType)}`);
    if (toType === "select" || toType === "multi_select") setOptionsColId(colId);
  }

  /** "Keep the old values in a new Text column": insert a Text column to the
   *  right named "{name} (old)", copy every stored value into it, THEN change
   *  the type. The copy is written before the type change so a failure stops
   *  the change and loses nothing. */
  async function keepOldValuesThenChange(colId: string, toType: ColumnTypeValue) {
    const cur = tableRef.current ?? table;
    const col = cur?.columns.find((c) => c.id === colId);
    if (!cur || !col) return;
    const idx = cur.columns.indexOf(col);
    const baseName = columnDisplayName(col.label, idx);
    let name = `${baseName} (old)`;
    for (let n = 2; cur.columns.some((c) => c.label.trim().toLowerCase() === name.toLowerCase()); n++) name = `${baseName} (old ${n})`;
    const def: Column = { id: newId(), type: "short_text", label: name };
    try {
      const withCopy = [...cur.columns, def];
      tableRef.current = { ...cur, columns: withCopy };
      setTable((prev) => (prev ? { ...prev, columns: withCopy } : prev));
      rebuildEngine(withCopy, rowsRef.current ?? []);
      if (!(await persistColumns(withCopy))) throw new Error("columns PATCH failed");
      await performMoveStrict(def.id, idx + 1);
      // A computed column's "old values" are what it showed, copied as text;
      // any other column's are its stored cells, copied as they are.
      const fromComputed = COMPUTED_TYPES.has(col.type);
      const updates = (rowsRef.current ?? [])
        .map((r) => ({ id: r.id, v: fromComputed ? computedCellText(col, r) : r.values[colId] }))
        .filter((u) => u.v !== undefined && u.v !== null && u.v !== "")
        .map((u) => ({ id: u.id, values: { [def.id]: u.v } }));
      for (let i = 0; i < updates.length; i += 500) await writeValuesBatchStrict(updates.slice(i, i + 500));
    } catch {
      toast("Couldn't copy the old values, so the type was not changed. Reloading the table.");
      void load();
      return;
    }
    await applyColumnType(colId, toType);
  }

  /** Column width by number (the keyboard path next to the drag grip). */
  async function promptColumnWidth(colId: string) {
    const col = (tableRef.current ?? table)?.columns.find((c) => c.id === colId);
    if (!col) return;
    const raw = await promptDialog({ title: "Column width in pixels (40 to 800)", defaultValue: String(col.width ?? 180) });
    if (raw == null) return;
    const w = Math.round(Number(raw));
    if (!Number.isFinite(w) || w < 40 || w > 800) { toast("Enter a width from 40 to 800"); return; }
    applyColumnPatches([{ colId, before: { width: col.width }, after: { width: w } }], "column width");
  }

  /** Move column left or right by one (the keyboard path next to drag). */
  function moveColumnBy(colId: string, dir: -1 | 1) {
    const cols = (tableRef.current ?? table)?.columns ?? [];
    const idx = cols.findIndex((c) => c.id === colId);
    const target = cols[idx + dir];
    if (idx < 0 || !target) return;
    moveColumn(colId, target.id);
  }

  async function deleteColumn(colId: string) {
    if (!table) return;
    if (!(await confirm({ title: "Delete column", description: "Delete this column? Existing cell values for it will be lost.", destructive: true, confirmLabel: "Delete" }))) return;
    // Undo capture BEFORE anything mutates: the column def and its index,
    // every row's stored value for it (stored formula objects included), and
    // once the host reports its rewrites, the PRE-delete sources those
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
    // left, refs into it become #REF!, without persisting these, every
    // stored formula silently repoints (the bug this wave closes). The host
    // itself skips the dying column's own cells.
    let res: StructureResult | null = null;
    // Ref, not the render-scope host: the awaited confirm above can span a
    // refetch's swap, and rewrites computed on a dead instance would be lost.
    try { res = engineHostRef.current?.columnDeleted(colId) ?? null; } catch { /* a rewrite failure must never block the delete */ }
    const rewCells = res?.rewritten.cells ?? [];
    const rewCols = res?.rewritten.columns ?? [];
    // Pre-delete stored sources of everything the delete rewrote, read
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
    if (!ok) return; // the delete never landed on the server, nothing to undo
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
        // Repeat the delete with the CAPTURED rewrites, after an undo the
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

  // Column resize, width persisted on the column (optimistic update while
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
    resizeRef.current = { colId, startX: e.clientX, startW: col?.width ?? 160, moved: false };
    // The kernel draws the Sheets drag guide at this column's LIVE right
    // edge for the whole gesture: the optimistic width writes below flow
    // through the columns prop every mousemove, so the guide tracks the
    // pointer with no page-side geometry at all.
    setResizingColId(colId);
    const onMove = (ev: MouseEvent) => {
      const st = resizeRef.current;
      if (!st) return;
      st.moved = true;
      setColumnWidthLocal(st.colId, Math.max(80, Math.round(st.startW + (ev.clientX - st.startX) / z)));
    };
    const onUp = () => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
      const moved = resizeRef.current?.moved ?? false;
      resizeRef.current = null;
      setResizingColId(null);
      // Persist only when the drag actually changed a width, see the
      // `moved` note on resizeRef. Queued: a dblclick-autofit lands right
      // after a sub-pixel jiggle's persist, and the queue keeps their
      // server order equal to their UI order (last write = what you see).
      if (moved) setTable((prev) => { if (prev) void writeQueueRef.current.run(() => persistColumns(prev.columns)); return prev; });
    };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  }

  /* The old one-at-a-time createRow/addRow pair died with the "New row"
   * footer button: rows now arrive in blocks (the corner "+" below, the
   * silent edge growth, paste overflow), all through insertRowsBatchStrict. */

  /** The corner "+" (bottom-left, under the gutter): 1,000 blank rows as
   *  ONE undoable command, the manual sibling of the silent edge growth
   *  below, for when that growth is gated off (sorted/filtered) or the
   *  user simply wants runway now. */
  const [addingRows, setAddingRows] = useState(false);
  async function addRowsBlock() {
    if (!tableId || addingRows) return;
    setAddingRows(true);
    try {
      const created = await insertRowsBatchStrict(Array.from({ length: ADD_ROWS_BLOCK }, () => ({ values: {} })));
      // The server hands re-added rows NEW ids on redo, so the command
      // re-captures them, a second undo must aim at rows that exist.
      let ids = created.map((r) => r.id);
      let redoCreated: string[] = [];
      pushUndo({
        label: "add 1,000 rows",
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
            Array.from({ length: ADD_ROWS_BLOCK }, () => ({ values: {} })),
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
   *  appear, Sheets' "keep typing, the sheet keeps up". Deliberately
   *  NON-undoable (blank appends destroy nothing; Ctrl+Z should keep
   *  undoing the user's EDITS, not un-grow the sheet under them) and
   *  gated: never while a sort/filter/search reorders display (the new
   *  rows would teleport), never mid-stream, never past 50k rows, and one
   *  append in flight at a time. */
  const growRowsBusyRef = useRef(false);
  function growRows() {
    if (growRowsBusyRef.current) return;
    if (sortState || filterActive || search.trim() || streamProgress) return;
    if ((rowsRef.current?.length ?? 0) >= 50_000) return;
    growRowsBusyRef.current = true;
    void (async () => {
      try {
        // Strict insert path, but NO pushUndo, that is the whole
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

  /** A table with columns and NO rows (a template or an agent created it
   *  with columns, or its starter rows never landed). Sheets never has one:
   *  you click A1 and type. The kernel paints placeholder rows and, on the
   *  first click, arrow or typed character, asks for the runway: the same
   *  1,000 blank rows a new table opens with, non-undoable for the reason
   *  growRows gives. The cell the person aimed at then becomes active, and
   *  a typed character opens its editor (activeRequest.seed), so the
   *  keystroke that started the table is not lost. Same gates as growth. */
  const emptyStartBusyRef = useRef(false);
  // EVERY KEY TYPED WHILE THE RUNWAY IS BEING CREATED, not just the first.
  //
  // The grid calls onEmptyStart once per keydown while the table still has
  // no rows, and the 1,000-row batch takes a round trip (about 90ms on
  // localhost, far more in production). This used to return early on the
  // busy flag, so only the FIRST character reached the editor: typing
  // "hello world" at speed saved "h", and even at a human pace of 150ms a
  // key it saved "hllo world". That is typed data silently lost, the one
  // thing a spreadsheet may never do. So the keys are appended here while
  // busy, the editor opens holding all of them, and a failed batch hands the
  // whole buffer to Retry rather than only the key that started it.
  const emptyStartTypedRef = useRef("");
  function startEmptyGrid(at: { r: number; c: number; seed: string | null }) {
    if (emptyStartBusyRef.current) {
      if (at.seed) emptyStartTypedRef.current += at.seed;
      return;
    }
    if (!tableId) return;
    if ((rowsRef.current?.length ?? 0) > 0) return;
    if (sortState || filterActive || search.trim() || streamProgress) return;
    emptyStartBusyRef.current = true;
    emptyStartTypedRef.current = at.seed ?? "";
    void (async () => {
      try {
        const created = await insertRowsBatchStrict(Array.from({ length: ADD_ROWS_BLOCK }, () => ({ values: {} })));
        const target = created[Math.min(Math.max(at.r, 0), created.length - 1)];
        const seed = emptyStartTypedRef.current || null;
        if (target) setFindActiveRequest({ rowId: target.id, c: at.c, nonce: ++findNonceRef.current, seed });
      } catch {
        const kept = { ...at, seed: emptyStartTypedRef.current || null };
        toast("Couldn't add rows", { tone: "danger", action: { label: "Retry", onClick: () => startEmptyGrid(kept) } });
      } finally {
        emptyStartBusyRef.current = false;
        emptyStartTypedRef.current = "";
      }
    })();
  }

  /** Phase 5c: a guarded PATCH bounced (409), another client changed the
   *  cell(s) this edit vouched for. Fold ONLY the conflicted columns (where
   *  the server provably outran us) plus server keys we hold no local value
   *  for, through the same host-then-mirror order every optimistic write
   *  uses. Deliberately NOT the whole row: our own queued sibling-cell
   *  writes may still be in flight, and a wholesale absorb would clobber
   *  their optimistic values with an older server snapshot, they land on
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
   *  `opts.before` instead, engine setCell's { previous } return, which is
   *  the authoritative overwritten value (built for exactly this wave).
   *
   *  opts.guard, THE Phase 5c concurrency opt-in, and the one central spot
   *  deciding who sends `expect`. Only the single-cell commit paths
   *  (commitEditorValue / commitCellText, they know the exact stored value
   *  the user saw and replaced) set it; `before` doubles as `expect`, so the
   *  server refuses the write (409) when another client changed that cell
   *  first. Every other write path, paste, fill, clear, bulk ops, undo/redo
   *  replay, the picker cells (link/person/attachment) and the row drawer,
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
      // The reserved "$fmt" styles key never enters `expect`: a rich
      // editor commit ("5%") writes the cell's value AND the row's style
      // map in this one PATCH, but styles are a read-modify-write the
      // user's edit did not vouch for (formatCells writes them unguarded
      // for the same reason), and absorbConflictRow skips the key on the
      // way back, so a guarded style would be a conflict nobody can see.
      const expect = opts?.guard
        ? Object.fromEntries(Object.entries(before).filter(([k]) => !isReservedKey(k)))
        : undefined;
      const res = await writeQueueRef.current.run(() => fetchWithRetry(`/api/tables/${tableId}/rows`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: rowId, values, ...(expect ? { expect } : {}) }),
      }));
      // 409 = the guard refused the write: NOTHING landed on the server.
      // Server truth replaces the optimistic value, the user's rejected
      // input is dropped, the same outcome Sheets gives on refresh, and
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
        // The conflict can be our OWN write: the first attempt landed, its
        // answer was lost, and fetchWithRetry sent it again against a guard
        // that now sees the new value. When the server already holds every
        // value this edit wrote, it applied; record it like any other edit.
        const ownWriteLanded = !!current && Object.keys(values).length > 0
          && Object.entries(values).every(([k, v]) => isReservedKey(k) || jsonEqual(current[k], v));
        if (ownWriteLanded) {
          noteWriteSettled(rowLedgerKey(rowId), Object.keys(values));
          if (prevRow) {
            pushUndo({
              label: opts?.label ?? "cell edit",
              undo: () => writeValuesBatchStrict([{ id: rowId, values: before }]),
              redo: () => writeValuesBatchStrict([{ id: rowId, values }]),
            });
          }
          return;
        }
        // The server's value replaced ours on purpose (the concurrency
        // guard): those cells are no longer waiting to be saved.
        noteWriteSettled(rowLedgerKey(rowId), Object.keys(values));
        if (current) {
          absorbConflictRow(rowId, current, conflictCols);
          // A rich commit ("5%") carried the row's style map in the same
          // refused PATCH; the optimistic nf must fall back to the server's
          // map with the value, or the cell would show a format the server
          // never stored. absorbConflictRow skips the key on purpose (it is
          // not a host write), so the mirror takes it here.
          if (CELL_STYLE_KEY in values) {
            const serverMap = Object.prototype.hasOwnProperty.call(current, CELL_STYLE_KEY) ? current[CELL_STYLE_KEY] : null;
            commitRows((prev) => prev ? prev.map((r) => r.id === rowId ? { ...r, values: { ...r.values, [CELL_STYLE_KEY]: serverMap ?? null } } : r) : prev);
          }
        } else void load(); // conflict body unreadable: reload is the reconcile
        // The concurrency guard's visible half (Tables Phase 5 backlog): the
        // other person's value is on screen now, and Reload brings every row
        // up to date, instead of a silent clobber either way.
        toast("This row changed while you were editing", {
          description: "Showing the latest value.",
          action: { label: "Reload", onClick: () => void load() },
        });
        return;
      }
      if (!res.ok) throw new Error(`PATCH ${res.status}`);
      setLastSavedAt(new Date());
      noteWriteSettled(rowLedgerKey(rowId), Object.keys(values));
      if (prevRow) {
        pushUndo({
          label: opts?.label ?? "cell edit",
          undo: () => writeValuesBatchStrict([{ id: rowId, values: before }]),
          redo: () => writeValuesBatchStrict([{ id: rowId, values }]),
        });
      }
    } catch {
      // A failed save never drops silently: the typed value stays in the
      // grid, the indicator reads "Not saved", and Retry re-sends it.
      noteWriteFailed(rowLedgerKey(rowId), values);
      toast("Cell didn't save", { tone: "danger", key: SAVE_FAILED_TOAST, action: { label: "Retry", onClick: () => void retryFailedWrites() } });
    }
  }

  /** Persist the engine host's per-cell rewrites after a structure change.
   *  The stored value is the { "=": source } object the host built, the
   *  same shape a formula edit stores, through the same batch path as every
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
          const res = await fetchWithRetry(`/api/tables/${tableId}/rows/batch`, {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ updates: updates.slice(i, i + BATCH_MAX_OPS) }),
          });
          if (!res.ok) throw new Error();
          for (const mid of await readBatchMissingIds(res)) missing.add(mid);
        }
      });
      noteRowsDeletedElsewhere(missing);
      for (const u of updates) noteWriteSettled(rowLedgerKey(u.id), Object.keys(u.values));
    } catch {
      // The layout change (a column rename, an insert) has already landed, so
      // a reload here would bring back cells whose formulas still name the old
      // layout and read #NAME?. Instead every rewrite goes into the unsaved
      // ledger: the grid keeps the rewritten formulas, the indicator reads
      // "Not saved", leaving asks first, and Retry re-sends them.
      for (const u of updates) noteWriteFailed(rowLedgerKey(u.id), u.values);
      toast("Couldn't save the formulas rewritten for the new layout", {
        tone: "danger",
        key: SAVE_FAILED_TOAST,
        action: { label: "Retry", onClick: () => void retryFailedWrites() },
      });
    }
  }

  async function clearCells(cells: { rowId: string; colId: string }[]) {
    if (!tableId || cells.length === 0) return;
    const byRow = new Map<string, Record<string, unknown>>();
    // Before-values captured from pre-clear state, per cell actually cleared
    // an undo puts back EXACTLY what was there, stored formulas included.
    const befores = new Map<string, Record<string, unknown>>();
    for (const c of cells) {
      const m = byRow.get(c.rowId) ?? {};
      m[c.colId] = null;
      byRow.set(c.rowId, m);
      const b = befores.get(c.rowId) ?? {};
      b[c.colId] = rowById.get(c.rowId)?.values[c.colId] ?? null;
      befores.set(c.rowId, b);
    }
    // ONE setCells pass clears every cell in the host before the paint,
    // a select-all clear is one recalc, not one per cell.
    driveHostWrites(cells.map((c) => ({ colId: c.colId, rowId: c.rowId, raw: null })));
    commitRows((prev) => prev ? prev.map((r) => byRow.has(r.id) ? { ...r, values: { ...r.values, ...byRow.get(r.id)! } } : r) : prev);
    const updates = [...byRow].map(([id, values]) => ({ id, values }));
    try {
      // Sequential slices riding one queued job: a failure part-way stops
      // the rest, the reload in the catch reconciles whatever did land,
      // the UI never keeps an optimistic clear the server rejected, and
      // no other value write can interleave between the slices.
      const missing = new Set<string>();
      await writeQueueRef.current.run(async () => {
        for (let i = 0; i < updates.length; i += BATCH_MAX_OPS) {
          const res = await fetchWithRetry(`/api/tables/${tableId}/rows/batch`, {
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
   *  Each touched row is a READ-MODIFY-WRITE of its whole "$fmt" map,
   *  the server merge is shallow, so the map is the unit of persistence,
   *  never a single cell's entry. The write is unconditional (no expect:
   *  a style is the user's explicit intent over the range, and a per-row
   *  409 mid-gesture would shred it), undoable as ONE command across all
   *  N rows (before = each row's old map, after = its new map), and rides
   *  writeValuesBatchStrict so the mirror repaints at once, the engine
   *  host never sees it (driveHostWrites filters the reserved key; styles
   *  don't recalc, so no bump is needed). A fully-cleared map writes null
   *  rather than dropping the key: the shallow merge can't delete, and
   *  every reader treats null as "no styles".
   *
   *  `patch` is one style patch for every cell, or a function deciding per
   *  cell (the decimal steppers: each cell steps from ITS OWN dp); a null
   *  answer leaves that cell's style untouched. */
  async function formatCells(
    targets: { rowIds: string[]; colIds: string[] },
    label: string,
    patch: StylePatch | ((row: ApiRow, colId: string) => StylePatch | null),
  ) {
    if (!tableId) return;
    const byId = new Map((rowsRef.current ?? []).map((r) => [r.id, r]));
    const befores: { id: string; values: Record<string, unknown> }[] = [];
    const afters: { id: string; values: Record<string, unknown> }[] = [];
    for (const rowId of targets.rowIds) {
      const row = byId.get(rowId);
      if (!row) continue; // deleted since the selection settled, skip, never invent a row
      let values = row.values;
      for (const colId of targets.colIds) {
        const cellPatch = typeof patch === "function" ? patch(row, colId) : patch;
        if (cellPatch) values = withCellStyle(values, colId, cellPatch);
      }
      const oldMap = row.values[CELL_STYLE_KEY] ?? null;
      const newMap = values[CELL_STYLE_KEY] ?? null;
      if (sameStyleMap(oldMap, newMap)) continue; // already styled this way, no write, no history
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
    // earlier ones left, the merged map (last write wins) is cumulative.
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
    } catch { hostOk = false; /* never block the delete, the rebuild below recovers */ }
    // Full snapshots BEFORE the optimistic removal, plan 3a names undo as
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
        const res = await fetchWithRetry(`/api/tables/${tableId}/rows/batch`, {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ deletes: ids.slice(i, i + BATCH_MAX_OPS) }),
        });
        if (!res.ok) throw new Error();
      }
      // The server hands restored rows NEW ids, so the command re-captures
      // them: a second undo/redo cycle acts on rows that actually exist.
      // Restored rows keep their ORIGINAL positions, so survivors' #REF!
      // rewrites are reverted too, the refs point at the same rows again
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
    // Snapshot before anything mutates, undo restores these exact values.
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
      // A delete is idempotent (a repeat after a lost answer finds the row
      // already gone), so it rides the retry like the other value writes.
      const delRes = await fetchWithRetry(`/api/tables/${tableId}/rows`, {
        method: "DELETE", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: rowId }),
      });
      // 404 means the row is already gone: a retry whose first attempt
      // landed, or a delete from another tab. Either way the row is deleted.
      if (!delRes.ok && delRes.status !== 404) throw new Error(`DELETE ${delRes.status}`);
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

  /** Move a row to a new index, the gutter drag AND both undo bodies run
   *  through this one path, so a move and its inverse rewrite formulas
   *  identically. STRICT: throws on persist failure (undo needs truth).
   *
   *  Ordering is the deleteColumn discipline: (1) drive the host FIRST so
   *  ref rewrites are computed against the pre-move layout ("=A5" must
   *  keep meaning the row that moved, refs in between must shift by one,
   *  losing one silently is the catastrophic bug); (2) renumber + reorder
   *  the local mirror to match storage order; (3) persist positions;
   *  (4) persist the host's rewrites (cells via the strict batch value
   *  path, column formulas via saveColumnsStrict).
   *
   *  Position renumbering is a ROTATION of the positions the span already
   *  held: post-move row i of the span takes the i-th pre-move position.
   *  The moved row therefore lands on the target row's old position and
   *  every in-between row shifts one slot toward the vacated one, no new
   *  numbers are minted, so uniqueness and any historical gaps (deleted
   *  rows) survive, and position order keeps matching display order.
   *
   *  Indices here are STORAGE indices (rowsRef order). The gesture may
   *  only translate a display index into one while display order == storage
   *  order, that is why the page withholds onRowMove under sort/filter/
   *  search/stream, but an undo replay is safe even if the user has since
   *  sorted: it re-runs in storage terms and the display just re-sorts. */
  async function performRowMoveStrict(rowId: string, toIndex: number) {
    if (!tableId) throw new Error("no table");
    const cur = rowsRef.current;
    if (!cur) throw new Error("rows gone");
    const from = cur.findIndex((r) => r.id === rowId);
    if (from < 0) return; // row deleted since, no-op, never corrupt
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
        // values: {}, the batch route treats a keyless entry as
        // position-only and writes nothing else for it.
        posUpdates.push({ id: next[i].id, values: {}, position: p });
      }
    }
    commitRows(next);
    if (res) bumpEngine();
    else rebuildEngine(tableRef.current?.columns ?? [], next);

    // (3) Positions AND cell rewrites merge into the SAME batch entries,
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
        const r = await fetchWithRetry(`/api/tables/${tableId}/rows/batch`, {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ updates: moveOps.slice(i, i + BATCH_MAX_OPS) }),
        });
        if (!r.ok) throw new Error(`batch move HTTP ${r.status}`);
      }
    });

    // (4) Column-formula rewrites live on the TABLE record, not the data
    // rows, so they cannot join the batch transaction above, that narrow
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
   *  strict path, the live host then rewrites every ref back, and those
   *  reverted rewrites persist exactly like the forward ones did (the
   *  deleteColumn revert discipline, achieved by inversion rather than
   *  snapshots, because a move, unlike a delete, loses nothing). */
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
      } catch { toast("Couldn't move the row. Reloading."); void load(); }
    })();
  }

  /** The kernel's row-resize release, and the boundary double-click,
   *  which arrives as the DEFAULT height meaning "reset". Persists through
   *  the normal UNCONDITIONAL row write (a resize is explicit intent over
   *  the row(s); no expect guard, the paste/fill policy) and lands ONE
   *  undo command whether it touched one row or the whole selected group:
   *  Sheets resizes every selected row together when the dragged boundary
   *  belongs to one of them, and single-row is the fallback. Heights never
   *  reach the engine host, driveHostWrites drops the reserved key, so
   *  a resize costs no recalc and no engine bump. */
  function resizeRowsTo(rowId: string, height: number) {
    // The default height stores as null, not as the number 33: null and
    // absent read identically (readRowHeight), the shallow merge cannot
    // delete keys, and a default-height row costs no bytes forever after.
    // A drag released exactly at 33px is the same "default" and needs no key.
    const px = height === SHEET_ROW_H ? null : (readRowHeight(height) ?? null);
    const sel = gridSelection;
    const targets = sel && sel.rowIds.length > 1 && sel.rowIds.includes(rowId) ? sel.rowIds : [rowId];
    // The sync mirror, not render-scope rows: the release handler may
    // outlive the render that created it by a beat.
    const live = new Map((rowsRef.current ?? []).map((r) => [r.id, r]));
    // Already at the target height ⇒ no write, no history entry (the
    // formatCells no-op rule). Junk stored values read as default, so a
    // reset over junk is ALSO a no-op, readers never saw the junk anyway.
    const changed = targets.filter((id) => {
      const row = live.get(id);
      return !!row && (readRowHeight(row.values[ROW_HEIGHT_KEY]) ?? null) !== px;
    });
    if (changed.length === 0) return;
    if (changed.length === 1) {
      // Single row: the normal row PATCH. patchRow captures the old "$rh"
      // (or null) as before and pushes the one "resize row" command.
      void patchRow(changed[0], { [ROW_HEIGHT_KEY]: px }, { label: "resize row" });
      return;
    }
    // Group resize: ONE batch, ONE undo command across the whole span.
    // Befores keep each row's raw stored value (junk included) so an undo
    // restores exactly what was there.
    const befores = changed.map((id) => ({ id, values: { [ROW_HEIGHT_KEY]: live.get(id)!.values[ROW_HEIGHT_KEY] ?? null } }));
    const afters = changed.map((id) => ({ id, values: { [ROW_HEIGHT_KEY]: px } }));
    void (async () => {
      try {
        await writeValuesBatchStrict(afters);
        pushUndo({
          label: `resize ${changed.length} rows`,
          undo: () => writeValuesBatchStrict(befores),
          redo: () => writeValuesBatchStrict(afters),
        });
      } catch { toast("Couldn't resize rows"); void load(); }
    })();
  }

  /** Row-menu "Insert 1 row above/below" (Sheets). No new server code:
   *  append a blank row through the existing create path (the server
   *  allocates its position), then move it into place through
   *  performRowMoveStrict, the SAME path the gutter drag uses, so refs
   *  at/below the slot shift by one exactly like a Sheets insert. ONE
   *  undo command: undo deletes that row (strict), redo re-inserts and
   *  re-targets against the anchor row as it sits THEN (ids, not indices,
   *  survive intervening edits; a vanished anchor lands the row at the
   *  end rather than guessing). Gated like row moves: a storage index is
   *  only a display index while nothing reorders the display. */
  function insertRowNear(anchorRowId: string, where: "above" | "below") {
    if (sortState || filterActive || search.trim() || streamProgress) {
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
        toast("Couldn't insert the row. Reloading.");
        void load();
      }
    })();
  }

  /** Row-menu "Clear row(s)": null into every editable cell of the row(s)
   *  through the existing clear path (undoable, setCells so dependents
   *  recompute). Computed columns are skipped exactly as the kernel's
   *  Delete key skips them. Formatting is left alone, Sheets' "Clear
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
      toast("This column is computed. Edit its formula or relation instead.");
      return;
    }
    const cells = (rowsRef.current ?? []).map((r) => ({ rowId: r.id, colId }));
    if (cells.length === 0) return;
    void clearCells(cells);
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
    // Anonymous columns export under their letter, like Excel would,
    // an empty header cell would make the file unreadable elsewhere.
    // CSV injection: a header or a text cell someone typed (or imported, or
    // sent through a form) as =HYPERLINK(...) or +cmd would run as a formula
    // when the file is opened in Excel or Sheets. It goes out through
    // csvExportCell, the same function GET /api/tables/[id]/export uses, so
    // the two exports cannot disagree. A cell that reads as a number (-42,
    // -$42.00, 12%) goes out as a number; anything else is escaped.
    const headers = table.columns.map((c, i) => csvEscape(csvFormulaSafe(c.label || columnLetter(i)))).join(",");
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
          // Rating shows stars in the grid; formatted CSV should match.
          if (formatted && c.type === "rating") {
            const n = typeof v === "number" ? Math.max(0, Math.min(5, Math.round(v))) : 0;
            return n > 0 ? "★".repeat(n) : "";
          }
          if (formatted && FORMATTABLE_TYPES.has(c.type) && !Array.isArray(v)) return formatCellValue(v, c.type, c.format);
          // An open cell's own nf/dp is what the user sees, so the
          // formatted export honours it the way it honours a column's.
          if (formatted && isOpenColumnType(c.type)) return formatOpenCell(v, readCellStyle(r.values, c.id));
          return Array.isArray(v) ? v.join("; ") : String(v);
        })();
        // Decided on the TEXT: see csvExportCell for why neither the column
        // type nor the value's type is allowed to exempt a cell.
        return csvEscape(csvExportCell(str));
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
  // helpers above). Lazy-created here so the very first render, before
  // load() delivers data and swaps in the real one, still has a host to
  // read from; writing a ref during render is React's sanctioned lazy-init
  // pattern, and it runs exactly once.
  if (engineHostRef.current === null) {
    engineHostRef.current = createTableEngine({
      columns: table?.columns ?? [],
      rows: rows ?? [],
      namedRanges: readNamedRanges(table?.settings),
    });
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

  const configColumnRaw = configColId ? (table?.columns ?? []).find((c) => c.id === configColId) ?? null : null;
  // A Link / Lookup / Rollup chosen in the type picker opens this dialog
  // BEFORE the type is written: the dialog reads the pending type, and the
  // type lands together with its configuration in one saveColumnConfig write.
  const configColumn = configColumnRaw && pendingRelType?.colId === configColumnRaw.id
    ? { ...configColumnRaw, type: pendingRelType.type as ColType }
    : configColumnRaw;

  // ── Sheet kernel derived state ──────────────────────────────────
  // Hooks, so they can sit above the early returns AND feed the active-cell
  // refs the formula bar's DOM observer reads between renders.
  const rowById = useMemo(() => new Map((rows ?? []).map((r) => [r.id, r] as const)), [rows]);

  /* ── Per-row heights for the kernel (Sheets' row resize) ─────────
   * One Map of ONLY the rows carrying a custom "$rh". Rebuilt with a
   * single-key O(n) scan whenever `rows` changes, the page already runs
   * several O(n) passes per commit (rowById above, filteredRows below),
   * but the RETURNED identity only changes when some height actually
   * changed, so an ordinary cell edit keeps the previous map and the
   * version below stays put. That version is the kernel contract's
   * "heights-version the page bumps": its geometry memo re-samples
   * rowHeight only on [rowIds, rowHeightsVersion], never per scroll. */
  const rowHeightsPrevRef = useRef<Map<string, number>>(new Map());
  const rowHeightsMap = useMemo(() => {
    const next = new Map<string, number>();
    for (const r of rows ?? []) {
      const h = readRowHeight(r.values[ROW_HEIGHT_KEY]);
      if (h !== undefined) next.set(r.id, h);
    }
    const prev = rowHeightsPrevRef.current;
    if (next.size === prev.size) {
      let same = true;
      for (const [id, h] of next) { if (prev.get(id) !== h) { same = false; break; } }
      if (same) return prev; // no height changed: keep the identity, keep the version
    }
    rowHeightsPrevRef.current = next;
    return next;
  }, [rows]);
  // Monotonic change signal derived from the map's identity. A ref bumped
  // inside useMemo (not state): the kernel must see the new version in the
  // SAME render that shows the new mirror, and an effect-based bump would
  // lag a paint. Strict-mode double-invocation only skips numbers, which a
  // change signal doesn't mind.
  const rowHeightsVersionRef = useRef(0);
  const rowHeightsVersion = useMemo(() => {
    void rowHeightsMap; // the map's identity IS the change being versioned
    return ++rowHeightsVersionRef.current;
  }, [rowHeightsMap]);
  /** Kernel prop. UNDEFINED while every row is default, so the kernel keeps
   *  its constant-height fast path and renders byte-identically to the
   *  pre-resize world. */
  const kernelRowHeight = useMemo(
    () => (rowHeightsMap.size === 0 ? undefined : (rowId: string) => rowHeightsMap.get(rowId)),
    [rowHeightsMap],
  );

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
    // Every column filter must hold (lib/sheet-filters cellPassesFilter). A
    // select column matches a chosen option exactly; a number or date
    // column its range; any other its shown text CONTAINS the needle. A
    // formula cell is matched on what it SHOWS, dark mid-stream like search.
    const live = filters.filter(filterIsActive);
    if (live.length > 0) {
      const typeOf = new Map(cols.map((c) => [c.id, c.type]));
      list = list.filter((r) => live.every((f) => {
        const v = r.values[f.colId];
        const shown = isFormulaCell(v)
          ? (streamProgress ? "" : String(engineHost.display(f.colId, r.id) ?? ""))
          : String(Array.isArray(v) ? v.join(" ") : v ?? "");
        return cellPassesFilter(f, v, shown, typeOf.get(f.colId));
      }));
    }
    return list;
  }, [rows, table?.columns, search, filters, engineHost, engineVersion, streamProgress]);

  const sortedRows = useMemo(() => {
    void engineVersion; // computed sort keys change when the host mutates
    if (!sortState) return filteredRows;
    const cols = table?.columns ?? [];
    const col = cols.find((c) => c.id === sortState.colId);
    if (!col) return filteredRows;
    // Sorting reads COMPUTED values but reorders only the display list,
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

  // Conditional-formatting v2: each color-scale / data-bar column's numeric
  // min/max over ALL rows (formula cells via the engine), so cellStyleFor can
  // paint each cell relative to the column. Recomputes when values change.
  const condRanges = useMemo(() => {
    void engineVersion;
    const out = new Map<string, { lo: number; hi: number }>();
    const cols = table?.columns ?? [];
    const list = rows ?? [];
    for (const c of cols) {
      if (!c.condFormat) continue;
      const isFormulaCol = c.type === "formula";
      const values = list.map((r) => {
        const v = r.values[c.id];
        return isFormulaCol || isFormulaCell(v) ? engineHost.value(c.id, r.id) : v;
      });
      const range = numericRange(values);
      if (range) out.set(c.id, range);
    }
    return out;
  }, [table?.columns, rows, engineHost, engineVersion]);

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
          // Lookup/rollup are computed display-time from linked tables, the
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

  // Identity-stable row-id list for the kernel: a fresh array per render
  // would re-run the kernel's geometry/index memos on every keystroke.
  const sortedRowIds = useMemo(() => sortedRows.map((r) => r.id), [sortedRows]);
  // The gutter's row numbers are the STORAGE positions, the same numbers the
  // name box and every A1 reference use (see barCell below). Under a filter
  // or sort the gutter used to renumber the visible rows 1, 2, 3, so real
  // rows 6 and 8 read "1" and "2" beside a name box that said D8.
  const rowNumberById = useMemo(() => rowNumbersById(rows ?? []), [rows]);
  const rowNumberOf = useCallback((rowId: string) => rowNumberById.get(rowId), [rowNumberById]);

  // ── Active-cell tracking for the formula bar ────────────────────
  // The sheet kernel owns selection internally (and this wave does not touch
  // it), so the bar reads the active cell from the DOM the kernel renders:
  // exactly one gridcell carries the active-outline class. A MutationObserver
  // follows it through clicks, keys, and post-paste selection moves. When the
  // active row scrolls out of the virtual window its node unmounts and the
  // last known cell is kept, scrolling away is not deselection.
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
      if (!cellEl) return; // active cell unmounted (scrolled away), keep the last one
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
  // The kernel also REPORTS its active cell (onActiveChange), which is the
  // source of truth when the active row is outside the virtual window and
  // has no DOM node to observe (a header-letter click while scrolled down).
  const onGridActiveChange = useCallback((cell: { rowId: string; c: number }) => {
    const colId = colIdsRef.current[cell.c];
    if (!colId) return;
    setActiveCell((prev) => (prev && prev.rowId === cell.rowId && prev.colId === colId ? prev : { rowId: cell.rowId, colId }));
  }, []);

  /* ── Find & Replace (Sheets' Cmd+F / Cmd+H) ──────────────────────
   * Page-local, never persisted: the card, its query and its highlights
   * exist only while this sheet is mounted, and closing the card clears
   * every tint (the match set below empties when findOpen drops).
   *
   * findQuery is the input's live value; findQueryDebounced is what the
   * scan actually runs on, ~150ms behind, the scan is a full
   * sortedRows × columns pass (computed cells read the engine host), and
   * re-running it on every keystroke of a fast typist would burn frames
   * for match sets nobody sees. */
  const [findOpen, setFindOpen] = useState(false);
  const [findShowReplace, setFindShowReplace] = useState(false);
  const [findQuery, setFindQuery] = useState("");
  const [findQueryDebounced, setFindQueryDebounced] = useState("");
  const [findReplace, setFindReplace] = useState("");
  // Index into findMatches of the CURRENT match (clamped at read time,
  // the list can shrink under it after a replace or an edit elsewhere).
  const [findIndex, setFindIndex] = useState(0);
  // Whether the user has NAVIGATED yet for this query: the first Enter
  // activates match 1 (already shown as current) instead of skipping to 2.
  const [findActivated, setFindActivated] = useState(false);
  // The honest replace note ("N skipped, …"), shown inside the card.
  const [findNotice, setFindNotice] = useState<string | null>(null);
  // The kernel's activeRequest prop: bumping the nonce makes (rowId, c)
  // the active cell exactly once. The kernel owns the active cell; this is
  // the page's only handle on it.
  const [findActiveRequest, setFindActiveRequest] = useState<{ rowId: string; c: number; nonce: number; seed?: string | null } | null>(null);
  const findNonceRef = useRef(0);
  const findInputRef = useRef<HTMLInputElement | null>(null);
  const findDebounceRef = useRef<number | null>(null);
  const setFindQueryLive = useCallback((v: string) => {
    setFindQuery(v);
    if (findDebounceRef.current !== null) window.clearTimeout(findDebounceRef.current);
    findDebounceRef.current = window.setTimeout(() => setFindQueryDebounced(v), 150);
  }, []);
  // A pending debounce must not fire into an unmounted page.
  useEffect(() => () => { if (findDebounceRef.current !== null) window.clearTimeout(findDebounceRef.current); }, []);
  // A new query means a new match list: the cursor restarts at the first
  // match, un-navigated, and any stale replace note stops applying.
  useEffect(() => { setFindIndex(0); setFindActivated(false); setFindNotice(null); }, [findQueryDebounced]);
  // Find state is per sheet, a query (and its rowId-keyed matches) from
  // the previous table must never survive into the next one.
  useEffect(() => {
    // The pending debounce timer must die too, firing after this reset
    // would resurrect the previous sheet's query into the fresh state.
    if (findDebounceRef.current !== null) { window.clearTimeout(findDebounceRef.current); findDebounceRef.current = null; }
    setFindOpen(false); setFindShowReplace(false); setFindQuery(""); setFindQueryDebounced("");
    setFindReplace(""); setFindIndex(0); setFindActivated(false); setFindNotice(null);
    setFindActiveRequest(null);
  }, [tableId]);

  /** The text find matches against for ONE cell, the page's single source
   *  for the scan AND for replace (surgery must run on exactly the text
   *  that matched). Literals read the same projection the search filter
   *  reads (raw stored text, arrays joined with a space, NOT the
   *  formatted display: search has always matched "0.07", not "7%", and
   *  find keeps that contract); computed cells (a formula column, a
   *  per-cell "=…" anywhere, lookup/rollup) read their computed display.
   *  Mid-stream the host is empty or one world behind, so computed cells
   *  go find-dark exactly as they go search-dark, but the whole scan is
   *  gated below anyway (a partial-set count is a lie). Reserved keys
   *  ($fmt/$rh) can never reach this function: callers iterate
   *  table.columns, and those keys are row-values riders, not columns. */
  const findCellText = useCallback((col: Column, r: ApiRow): string => {
    const v = r.values[col.id];
    if (col.type === "formula" || isFormulaCell(v)) {
      return streamProgress ? "" : String(engineHost.display(col.id, r.id) ?? "");
    }
    if (col.type === "lookup" || col.type === "rollup") {
      const rv = relationalValue(col, r);
      return rv == null ? "" : String(rv);
    }
    if (v === undefined || v === null) return "";
    return String(Array.isArray(v) ? v.join(" ") : v);
  }, [engineHost, relationalValue, streamProgress]);

  /** Every matched cell in DISPLAY order (sortedRows × columns, so
   *  next/prev walk the sheet the way the user reads it, left to right,
   *  top to bottom, under whatever sort and filter are live). One entry
   *  per CELL, not per occurrence. Empty while the card is closed (no
   *  scan, no tint), while the query is empty, and mid-stream (the card
   *  shows "Loading rows…" instead, counting matches over a partial row
   *  set would be a lie). Recomputes whenever the data world moves:
   *  sortedRows (rows, sort, filter, search) and engineVersion (computed
   *  values) are both dependencies. */
  const findMatches = useMemo<{ rowId: string; colId: string; c: number }[]>(() => {
    void engineVersion; // computed cell text changes when the host mutates in place
    if (!findOpen || streamProgress || findQueryDebounced === "") return [];
    const cols = table?.columns ?? [];
    const out: { rowId: string; colId: string; c: number }[] = [];
    for (const r of sortedRows) {
      for (let c = 0; c < cols.length; c++) {
        if (matchesFindQuery(findCellText(cols[c], r), findQueryDebounced)) {
          out.push({ rowId: r.id, colId: cols[c].id, c });
        }
      }
    }
    return out;
  }, [findOpen, streamProgress, findQueryDebounced, table?.columns, sortedRows, findCellText, engineVersion]);

  // "rowId:colId" keys for cellStyleFor's O(1) tint lookup; null while
  // nothing matches so the style path costs one falsy check per cell.
  const findMatchKeys = useMemo(
    () => (findMatches.length === 0 ? null : new Set(findMatches.map((m) => `${m.rowId}:${m.colId}`))),
    [findMatches],
  );
  const findCurrentIdx = findMatches.length === 0 ? 0 : Math.min(findIndex, findMatches.length - 1);
  const findCurrentKey = findMatches.length > 0
    ? `${findMatches[findCurrentIdx].rowId}:${findMatches[findCurrentIdx].colId}`
    : null;

  /* ── Co-presence (the 20s heartbeat; the title row's chip) ── */
  const presence = useTablePresence(tableId);

  /* ── ?new=1: a create door just made this table. Select the name so a
   * person can type it, then strip the flag (the one create recipe, spec
   * section 1 Naming canon). The latch sits inside the tick, so a StrictMode
   * double effect cannot run it twice or not at all. ── */
  const newLatchRef = useRef(false);
  const tableLoaded = !!table && rows !== null;
  useEffect(() => {
    if (!tableLoaded || searchParams.get("new") !== "1") return;
    const t = setTimeout(() => {
      if (newLatchRef.current) return;
      newLatchRef.current = true;
      titleInputRef.current?.focus();
      titleInputRef.current?.select();
      const next = new URLSearchParams(window.location.search);
      next.delete("new");
      const s = next.toString();
      router.replace(`${selfPath}${s ? `?${s}` : ""}`, { scroll: false });
    }, 0);
    return () => clearTimeout(t);
  }, [tableLoaded, searchParams, router, selfPath]);

  /* ── Pivot CONFIGURATION, per person per table (settings 7.3):
   * home.work.surface["table:{id}"].pivot, read on open, written 400ms
   * after the last change. The result is never stored. ── */
  const pivotInitial = useMemo<PivotConfig | null>(
    () => (table ? readPivotConfig(prefs.home, table.id, new Set(table.columns.map((c) => c.id))) : null),
    [prefs.home, table],
  );
  const pivotSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const savePivotConfig = useCallback((config: PivotConfig) => {
    if (!tableId) return;
    if (pivotSaveTimer.current) clearTimeout(pivotSaveTimer.current);
    pivotSaveTimer.current = setTimeout(() => {
      void patchPrefs(pivotPatch(prefs.home, tableId, config) as Parameters<typeof patchPrefs>[0]);
    }, 400);
  }, [tableId, patchPrefs, prefs.home]);

  /* ── Full screen (View > Full screen, Cmd+Shift+F; Esc restores) and
   * Cmd+Enter (the row drawer for the active row). ── */
  const activeRowForKeysRef = useRef<string | null>(null);
  activeRowForKeysRef.current = activeCell?.rowId ?? null;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.shiftKey && !e.altKey && e.key.toLowerCase() === "f") {
        e.preventDefault();
        setFullScreen((v) => !v);
        return;
      }
      if (e.key === "Escape" && fullScreenRef.current) {
        // The grid consumes the Escape that collapses a range (and the
        // editor's Escape never bubbles); a bare Escape in the grid leaves
        // full screen, as it does anywhere else outside a field or layer.
        if (e.defaultPrevented) return;
        const t = e.target as HTMLElement | null;
        if (t?.closest?.('input, textarea, [contenteditable]:not([contenteditable="false"]), [role="dialog"], [role="menu"]')) return;
        setFullScreen(false);
        return;
      }
      if (mod && !e.shiftKey && !e.altKey && e.key === "Enter") {
        const t = e.target as HTMLElement | null;
        if (t?.closest?.('input, textarea, [contenteditable]:not([contenteditable="false"])')) return;
        const rowId = activeRowForKeysRef.current;
        if (!rowId) return;
        e.preventDefault();
        openRowDrawerRef.current?.(rowId);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  const fullScreenRef = useRef(false);
  fullScreenRef.current = fullScreen;
  const openRowDrawerRef = useRef<((rowId: string) => void) | null>(null);
  openRowDrawerRef.current = setActiveRowId;
  // Entering or leaving full screen unmounts the menu bar (or the toolbar's
  // Exit button) that held focus, which drops it on <body>, and the arrows
  // stopped moving the cursor until the person clicked a cell. Hand focus
  // back to the grid, without scrolling, unless something real has it.
  //
  // The same rescue runs after any menu bar item (SheetMenuBar's
  // onAfterSelect): choosing an item unmounts the portal that held focus, so
  // Insert > Row below and then typing did nothing until a click.
  function refocusGridIfLost() {
    requestAnimationFrame(() => {
      const ae = document.activeElement;
      if (ae && ae !== document.body) return;
      gridWrapElRef.current?.querySelector<HTMLElement>('[role="grid"]')?.focus({ preventScroll: true });
    });
  }
  useEffect(() => {
    const t = requestAnimationFrame(() => {
      const ae = document.activeElement;
      if (ae && ae !== document.body) return;
      gridWrapElRef.current?.querySelector<HTMLElement>('[role="grid"]')?.focus({ preventScroll: true });
    });
    return () => cancelAnimationFrame(t);
  }, [fullScreen]);

  if (notFound) return <NotFoundView />;
  if (loadError) {
    return (
      <div className="os-chrome flex flex-1 items-center justify-center">
        <OsEmptyView variant="error" context="list" title="We could not load this table." action={{ label: "Retry", onClick: () => { setLoadError(null); void load(); } }} />
      </div>
    );
  }
  if (!table || rows === null) {
    return (
      <div className="os-chrome flex min-h-0 flex-1 flex-col gap-2 px-4 py-3" aria-busy="true">
        <div className="flex h-12 items-center gap-3"><span className="h-7 w-7 rounded-md bg-skeleton os-skeleton-pulse" /><span className="h-5 w-56 rounded bg-skeleton os-skeleton-pulse" /></div>
        <div className="flex-1 overflow-hidden rounded-lg border border-line bg-[var(--os-surface)]">
          {/* The grid's own skeleton: a header row and 20 rows at the 32px grid row height. */}
          <div className="h-8 border-b border-line bg-[var(--os-table-head-bg)]" aria-hidden />
          <SkeletonRows rows={20} rowHeight={`${SHEET_ROW_H}px`} />
        </div>
        <p className="m-0 text-sm text-ink-2">Opening the table</p>
      </div>
    );
  }

  const activeRow = activeRowId ? rows.find((r) => r.id === activeRowId) : null;

  // ── Toolbar plumbing (Sheets chrome) ────────────────────────────

  /** Column ids the kernel's current selection intersects, read from the
   *  DOM the kernel renders (aria-selected on gridcells), selection state
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

  /** THE TOOLBAR SPLIT. Every number-format action ($ / % / .0 / .00 /
   *  123) lands here first and is routed into one of two worlds:
   *
   *    OPEN columns (short_text): PER-CELL, like Sheets. The patch goes
   *    into each selected cell's "$fmt" style (nf / dp) through
   *    formatCells, one undo command across the whole range. The column
   *    is never retyped, so pressing $ on ONE cell formats ONE cell and
   *    the rest of the column still takes text. The exceptions are the
   *    123 menu's Date and Checkbox: those are not number formats but
   *    EDITORS (a date picker, a tick box), and a cell can't carry an
   *    editor, so they stay column-level and retype the open column.
   *    That is the point of choosing them.
   *
   *    LEGACY typed columns (number / currency / percent / date /
   *    checkbox): COLUMN-level, exactly as before. Their type IS their
   *    editor and their col.format is their rendering; a per-cell nf
   *    there would fight the column's own format for the same digits.
   *
   *  A selection spanning both worlds applies both halves; each half is
   *  its own undo command (they persist through different routes). */
  const routeNumberFormat = (
    label: string,
    cellPatch: (row: ApiRow, col: Column) => StylePatch | null,
    columnPatch: (col: Column) => { before: Partial<Column>; after: Partial<Column> } | null,
  ): boolean => {
    const targets = formatTargets();
    if (!targets) return false;
    const cols = targets.colIds.map((id) => table.columns.find((c) => c.id === id)).filter((c): c is Column => !!c);
    const openCols = cols.filter((c) => isOpenColumnType(c.type));
    const legacyPatches = cols
      .filter((c) => !isOpenColumnType(c.type))
      .flatMap((c) => { const p = columnPatch(c); return p ? [{ colId: c.id, ...p }] : []; });
    if (openCols.length === 0 && legacyPatches.length === 0) return false;
    if (openCols.length > 0) {
      // Same gate as the style pills: a per-cell write is a read-modify-
      // write of rows the stream may not have delivered yet. The legacy
      // half below is a columns write and needs no rows, so it proceeds.
      if (streamProgress) toast("Rows are still loading, try again in a moment");
      else {
        const byId = new Map(openCols.map((c) => [c.id, c]));
        void formatCells(
          { rowIds: targets.rowIds, colIds: openCols.map((c) => c.id) },
          label,
          (row, colId) => cellPatch(row, byId.get(colId)!),
        );
      }
    }
    if (legacyPatches.length > 0) applyColumnPatches(legacyPatches, label);
    return true;
  };

  /** Toolbar $ / % and the 123 menu: the kind as a per-cell nf/dp on open
   *  cells (plain removes both), the kind as col.type + col.format on
   *  legacy columns. Date / Checkbox retype EVERY selected column, open
   *  ones included (see routeNumberFormat). */
  const applyKindToSelection = (kind: NumberFormatKind) => {
    if (kind === "date" || kind === "checkbox") {
      const eligible = selectionColumnIds().filter((id) => {
        const c = table.columns.find((x) => x.id === id);
        return !!c && kindForColType(c.type) !== undefined;
      });
      if (eligible.length === 0) { toast("Select a cell first"); return; }
      applyNumberFormat(eligible, kind);
      return;
    }
    const cell: StylePatch = kind === "plain"
      ? { nf: undefined, dp: undefined }
      : { nf: kind, dp: defaultDp(kind) };
    const patch = formatPatchFor(kind);
    const ok = routeNumberFormat(
      `format as ${kind}`,
      () => cell,
      (c) => kindForColType(c.type) === undefined
        ? null // legacy/relational types the menu doesn't offer: the popover shows them read-only
        : { before: { type: c.type, format: c.format }, after: { type: patch.type as ColType, format: patch.format } },
    );
    if (!ok) toast("Select a cell first");
  };

  /** Toolbar decimal steppers. Open cells step their OWN dp (a cell with
   *  an nf from its nf's default, a bare number becomes an nf-number so
   *  the digits have a format to live in; text and blanks are skipped,
   *  there are no digits to step). Legacy columns step col.format as
   *  before, and only when they render numerically. */
  const stepColumnDecimals = (delta: 1 | -1) => {
    const ok = routeNumberFormat(
      delta > 0 ? "increase decimals" : "decrease decimals",
      (row, col) => {
        const style = readCellStyle(row.values, col.id);
        const v = row.values[col.id];
        const nf = style?.nf ?? (typeof v === "number" ? "number" : undefined);
        if (!nf) return null;
        // A bare number (no nf yet) steps from the decimals it SHOWS,
        // String(5) has 0, String(2.5) has 1, not from the nf default of
        // 2, or "decrease" on a plain 5 would add a decimal (5.0).
        const shown = typeof v === "number" ? (String(v).split(".")[1]?.length ?? 0) : 0;
        const start = style?.dp ?? (style?.nf ? defaultDp(nf) : shown);
        return { nf, dp: Math.min(10, Math.max(0, start + delta)) };
      },
      (c) => c.type === "number" || c.type === "currency" || c.type === "percent" || c.format?.style !== undefined
        ? { before: { format: c.format }, after: { format: adjustDecimals(c.format, c.type, delta) } }
        : null,
    );
    if (!ok) toast("Select cells in a numeric column first");
  };

  /** The cells a per-cell format action targets: the kernel's settled
   *  range (ORDERED display rowIds × the inclusive column span, via
   *  onSelectionChange), else the active cell, the kernel reports null
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

  /** Apply one style patch to the selection (colour, fill, align, the
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
  // Window-level Cmd+B/I/U (declared in the hooks zone above) calls through
  // this ref, filled here, after the function exists.
  formatKeyRef.current = toggleStyleFlag;

  // ── Find & Replace plumbing (state + scan in the hooks zone above) ──

  /** Cmd/Ctrl+F (withReplace=false) / Cmd/Ctrl+H (true), and re-presses
   *  while the card is already open: re-focus the query and select it, so
   *  typing replaces the old search (Sheets' reopen behaviour). The rAF
   *  waits out the mount render on first open. */
  const openFind = (withReplace: boolean) => {
    setFindOpen(true);
    if (withReplace) setFindShowReplace(true);
    requestAnimationFrame(() => { findInputRef.current?.focus(); findInputRef.current?.select(); });
  };
  // Window Cmd+F/H calls through this ref. A columnless table renders the
  // "Start sheet" branch, not the card, leave the browser's find alone
  // there rather than swallowing the shortcut into an invisible state.
  // Null (native browser find) when the card can't render: a columnless
  // table shows the start branch, and the row-detail modal would hide the
  // card under its backdrop while autoFocus steals the modal's focus.
  findKeyRef.current = table.columns.length === 0 || activeRowId ? null : openFind;

  /** Escape / the X. The GRID selection is untouched on purpose, the
   *  kernel's own Escape (which collapses the anchor) only runs while the
   *  grid has focus, and it never does while the card's input owns the
   *  key. Focus is handed back to the grid so arrows work immediately,
   *  the same hand-back the formula bar commit does. */
  const closeFind = () => {
    setFindOpen(false);
    setFindNotice(null);
    gridWrapElRef.current?.querySelector<HTMLElement>('[role="grid"]')?.focus({ preventScroll: true });
  };

  /** Next (+1) / previous (-1) with wrap-around; the landed-on match
   *  becomes the ACTIVE cell via the kernel's activeRequest (nonce bump =
   *  apply once). The first forward step activates the CURRENT match
   *  (shown as "1 of M") rather than skipping past it. */
  const findStep = (dir: 1 | -1) => {
    const total = findMatches.length;
    if (total === 0) return;
    const next = !findActivated && dir === 1 ? findCurrentIdx : (findCurrentIdx + dir + total) % total;
    setFindActivated(true);
    setFindIndex(next);
    const m = findMatches[next];
    setFindActiveRequest({ rowId: m.rowId, c: m.c, nonce: ++findNonceRef.current });
  };

  /** What Replace writes into ONE matched cell, or "skip", the honest
   *  outcome the card counts. Computed and relational cells and shapes
   *  with no text encoding (REPLACE_SKIP_TYPES) skip statically; a
   *  per-cell "=…" formula in an otherwise open column skips by its
   *  stored shape. The surgery runs on EXACTLY the text that matched
   *  (findCellText), then re-enters storage by column type:
   *   - open columns take the plain entry grammar (autoTypeEntry), the
   *     same chokepoint paste and fill use, replacing the "x" out of
   *     "5x" stores the NUMBER 5. Plain, not rich, deliberately: a
   *     replace result is mechanical surgery, not a symbol the user typed
   *     to format the cell, so "5%" landing here stays text exactly as a
   *     pasted "5%" does.
   *   - every other literal type rides coercePaste, so the stored shape
   *     stays honest (numbers parse, dates must be ISO, selects must name
   *     an option), an unreadable result SKIPS the cell rather than
   *     planting a string a number column would silently missort. */
  const replacementFor = (col: Column, r: ApiRow): PasteCoercion => {
    if (REPLACE_SKIP_TYPES.has(col.type) || isFormulaCell(r.values[col.id])) return { kind: "skip" };
    const replaced = replaceAllOccurrences(findCellText(col, r), findQueryDebounced, findReplace);
    if (isOpenColumnType(col.type)) {
      const value = replaced === "" ? null : autoTypeEntry(replaced);
      if (col.validation && value != null) {
        const vr = validateValue(col.validation, value);
        if (!vr.ok) return { kind: "skip" };
      }
      return { kind: "write", value };
    }
    return coercePaste(col, replaced);
  };

  const skippedNote = (n: number) => `${n} skipped: computed cells, or results that don't fit the column's type`;

  /** Replace the CURRENT match: one guarded row PATCH (the same write an
   *  editor commit makes, one undoable command, 409-guarded because we
   *  know the exact stored value the user is looking at). A skipped
   *  current match steps forward so repeated presses walk the sheet.
   *  After the write lands the mirror changes, the scan re-runs, and the
   *  shrunken list leaves findIndex pointing at the next match. When the
   *  REPLACEMENT still contains the query ("x" → "xx") the cell keeps
   *  matching and stays current, Sheets keeps finding it too. */
  const runReplaceCurrent = () => {
    if (findMatches.length === 0) return;
    const m = findMatches[findCurrentIdx];
    const col = table.columns.find((c) => c.id === m.colId);
    const r = rowById.get(m.rowId);
    if (!col || !r) return; // a frame behind a delete: the scan will re-run
    const res = replacementFor(col, r);
    setFindActivated(true);
    // Show the cell the action lands on (or walks past) either way.
    setFindActiveRequest({ rowId: m.rowId, c: m.c, nonce: ++findNonceRef.current });
    if (res.kind === "skip") {
      setFindNotice(skippedNote(1));
      const total = findMatches.length;
      if (total > 1) setFindIndex((findCurrentIdx + 1) % total);
      return;
    }
    setFindNotice(null);
    void patchRow(m.rowId, { [m.colId]: res.value }, { label: "replace", guard: true });
    // When the REPLACEMENT still contains the query ("x" → "xx") the cell
    // keeps matching and would stay current forever, repeated Enter would
    // grow it exponentially instead of walking the sheet. Advance past it
    // the way Sheets does; the rescan keeps indices aligned because the
    // still-matching cell keeps its slot.
    const newText = res.kind === "write" && res.value != null ? String(res.value) : "";
    if (matchesFindQuery(newText, findQueryDebounced) && findMatches.length > 1) {
      setFindIndex((findCurrentIdx + 1) % findMatches.length);
    }
  };

  /** Replace ALL matches: ONE writeValuesBatchStrict (host + mirror +
   *  chunked batch route in one queued job) and ONE undo command over
   *  every touched row, exactly the clearCells shape. Skipped cells are
   *  counted and reported in the card, never silently dropped. */
  const runReplaceAll = async () => {
    if (findMatches.length === 0) return;
    const byRow = new Map<string, Record<string, unknown>>();
    const befores = new Map<string, Record<string, unknown>>();
    let skipped = 0;
    let replaced = 0;
    for (const m of findMatches) {
      const col = table.columns.find((c) => c.id === m.colId);
      const r = rowById.get(m.rowId);
      if (!col || !r) continue; // a frame behind a delete, not a skip worth reporting
      const res = replacementFor(col, r);
      if (res.kind === "skip") { skipped += 1; continue; }
      const values = byRow.get(m.rowId) ?? {};
      values[m.colId] = res.value;
      byRow.set(m.rowId, values);
      const b = befores.get(m.rowId) ?? {};
      b[m.colId] = r.values[m.colId] ?? null; // absent restores as null, patchRow's rule
      befores.set(m.rowId, b);
      replaced += 1;
    }
    if (replaced === 0) {
      setFindNotice(skipped > 0 ? skippedNote(skipped) : null);
      return;
    }
    const updates = [...byRow].map(([id, values]) => ({ id, values }));
    const beforeUpdates = [...befores].map(([id, values]) => ({ id, values }));
    try {
      await writeValuesBatchStrict(updates);
      pushUndo({
        label: `replace all (${replaced} cell${replaced === 1 ? "" : "s"})`,
        undo: () => writeValuesBatchStrict(beforeUpdates),
        redo: () => writeValuesBatchStrict(updates),
      });
      setFindNotice(`Replaced ${replaced} cell${replaced === 1 ? "" : "s"}${skipped > 0 ? ` · ${skippedNote(skipped)}` : ""}`);
    } catch { toast("Couldn't replace. Reloading."); void load(); }
  };

  // The card's counter line: mid-stream honesty beats a partial count.
  const findCounter = streamProgress
    ? "Loading rows…"
    : findQueryDebounced === ""
      ? null
      : `${findMatches.length === 0 ? 0 : findCurrentIdx + 1} of ${findMatches.length}`;

  /** Σ button: open the active cell's editor seeded with "=SUM(" through
   *  the kernel's own type-to-replace path, a real "=" keydown dispatched
   *  at the grid (the exact mechanism typing uses; React's root listener
   *  routes dispatched events like trusted ones), with sigmaSeedRef
   *  upgrading that one-char seed to "=SUM(" in kernelEditor. The formula
   *  editor opens seeded, caret at the end, autocomplete taking over. */
  const insertSumSeed = () => {
    const gridEl = gridWrapElRef.current?.querySelector<HTMLElement>('[role="grid"]');
    if (!gridEl || !activeCell) { toast("Select a cell first"); return; }
    const col = table.columns.find((c) => c.id === activeCell.colId);
    if (!col || col.type === "formula" || col.type === "lookup" || col.type === "rollup") {
      toast("This cell is computed by its column. Pick another cell.");
      return;
    }
    sigmaSeedRef.current = "=SUM(";
    gridEl.focus({ preventScroll: true });
    gridEl.dispatchEvent(new KeyboardEvent("keydown", { key: "=", bubbles: true, cancelable: true }));
    // The kernel consumed the seed synchronously (the dispatch re-rendered
    // the editor); anything later must never see a stale Σ seed.
    window.setTimeout(() => { sigmaSeedRef.current = null; }, 0);
  };

  // ── Sheet kernel plumbing (Tables Phase 1) ──────────────────────

  // Conditional formatting v2, icon set: a value's tertile prefixes the cell
  // with a coloured glyph. Wraps renderCellContent (below) so it rides on top of
  // every column type, and only the DISPLAY, never the copied/stored value.
  const displayCell = (rowId: string, colId: string): React.ReactNode => {
    const content = renderCellContent(rowId, colId);
    const c = table.columns.find((x) => x.id === colId);
    if (c?.condFormat?.type !== "icon_set") return content;
    const range = condRanges.get(colId);
    const r = rowById.get(rowId);
    if (!range || !r) return content;
    const cv = r.values[colId];
    const isFormulaC = c.type === "formula" || isFormulaCell(cv);
    if (streamProgress && isFormulaC) return content;
    const raw = isFormulaC ? engineHost.value(colId, r.id) : cv;
    const num = typeof raw === "number" ? raw
      : typeof raw === "string" && raw.trim() !== "" && Number.isFinite(Number(raw)) ? Number(raw)
      : null;
    if (num === null) return content;
    const icon = iconSetIcon(num, range.lo, range.hi, c.condFormat.set);
    if (!icon) return content;
    return (
      <span className="inline-flex min-w-0 items-center gap-1.5">
        <span aria-hidden style={{ color: icon.color, fontSize: "10px", lineHeight: 1 }}>{icon.char}</span>
        <span className="min-w-0">{content}</span>
      </span>
    );
  };

  const renderCellContent = (rowId: string, colId: string): React.ReactNode => {
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
      // formats. Everything else keeps engine display verbatim, its
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
      // An OPEN column's per-cell formula honours the cell's own $/% format
      // (Sheets formats formula results): route the computed number through
      // the same open-cell formatter literals use.
      if (isOpenColumnType(c.type)) {
        const cellFmt = readCellStyle(r.values, c.id);
        if (cellFmt?.nf) {
          const computed = engineHost.value(c.id, r.id);
          if (typeof computed === "number") return <span>{formatOpenCell(computed, cellFmt)}</span>;
        }
      }
      return fv.includes("\n") ? <span style={{ whiteSpace: "pre-wrap" }}>{fv}</span> : <span>{fv}</span>;
    }
    switch (c.type) {
      case "lookup": case "rollup": {
        const rv = relationalValue(c, r);
        if (rv == null) return null;
        const text = String(rv);
        // Same pre-wrap rule as stored strings: autofit measures this text.
        return text.includes("\n") ? <span style={{ whiteSpace: "pre-wrap" }}>{text}</span> : text;
      }
      case "checkbox": return v ? <Check style={{ width: 14, height: 14, color: "var(--os-brand)" }} /> : null;
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
      // typing), long_text, url, email. In an OPEN column a number renders
      // through the cell's own nf/dp ("$5.00", "5%") when the user asked
      // for one, else as plain String(n): Sheets shows "1000", not
      // "1,000", until asked. Right-alignment for that number is
      // cellStyleFor's job.
      default: {
        if (v == null || v === "") return null;
        // Multi-line text must carry its OWN white-space: the kernel's
        // display wrapper is truncate (nowrap), and a cell-level style
        // cannot cascade past it, the span's wins for its text.
        if (typeof v === "string" && v.includes("\n")) {
          return <span style={{ whiteSpace: "pre-wrap" }}>{v}</span>;
        }
        return isOpenColumnType(c.type) ? formatOpenCell(v, readCellStyle(r.values, c.id)) : String(v);
      }
    }
  };

  /** Inline style for one cell: the cell's own "$fmt" styles (bold /
   *  italic / underline / strike / colour / fill / align) with the
   *  conditional-formatting rule background (Phase 4) layered on top.
   *  Precedence is Sheets': a matching RULE background beats the cell's
   *  manual fill, text styles always apply. Rules read the RAW value
   *  (computed for formula cells), formatting never feeds back into
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
    // Numeric-typed columns and computed numbers right-align too (Sheets:
    // every number sits flush right). Only a value that IS a number: a stray
    // "abc" in a Number column keeps reading as text, and a formula that
    // returns text stays left. Rating is excluded, its stars are not digits.
    else if (c && !style?.a) {
      const v = r.values[colId];
      if (c.type === "formula" || isFormulaCell(v)) {
        if (!streamProgress && typeof engineHost.value(c.id, rowId) === "number") css.textAlign = "right";
      } else if (NUMERIC_ALIGN_TYPES.has(c.type) && (typeof v === "number" || (typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v))))) {
        css.textAlign = "right";
      }
    }
    // Multi-line content (Shift/Cmd+Enter breaks): wrap and top-align so a
    // taller row (resizable) reveals the lines instead of center-clipping.
    if (typeof r.values[colId] === "string" && (r.values[colId] as string).includes("\n")) {
      css.whiteSpace = "pre-wrap";
      css.alignItems = "flex-start";
    }
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
    // Conditional formatting v2, color scale (heat-map) or data bar, painted
    // relative to the column's numeric range. Wins over a v1 rule if both set.
    if (c?.condFormat) {
      const range = condRanges.get(c.id);
      const cv = r.values[c.id];
      const isFormulaC = c.type === "formula" || isFormulaCell(cv);
      if (range && !(streamProgress && isFormulaC)) {
        const raw = isFormulaC ? engineHost.value(c.id, r.id) : cv;
        const num = typeof raw === "number" ? raw
          : typeof raw === "string" && raw.trim() !== "" && Number.isFinite(Number(raw)) ? Number(raw)
          : null;
        if (num !== null && Number.isFinite(num)) {
          if (c.condFormat.type === "color_scale") {
            const col = colorScaleColor(num, range.lo, range.hi, c.condFormat);
            if (col) css.backgroundColor = col;
          } else if (c.condFormat.type === "data_bar") {
            const bar = dataBarBackground(num, range.lo, range.hi, c.condFormat);
            if (bar) css.backgroundImage = bar;
          }
        }
      }
    }
    // Find & Replace tint, merged LAST on purpose: find is a transient
    // MODE, and while its card is open the match highlight overrides both
    // the cell's manual fill and any rule background, the whole point of
    // the mode is seeing the matches; closing the card restores every
    // fill (findMatchKeys empties with it). The CURRENT match sets the
    // `background` SHORTHAND as well: the kernel deliberately drops
    // backgroundColor on the ACTIVE cell (its white ground keeps the
    // outline legible), but the navigated-to match IS the active cell and
    // must stay visibly green under the cursor, as in Sheets, the
    // shorthand is the one property that survives that drop. The specific
    // backgroundColor rides along (inserted after, so it wins wherever
    // both apply) for the frozen-column path, whose opaque-fill rule reads
    // backgroundColor, not the shorthand.
    if (findMatchKeys) {
      const key = `${rowId}:${colId}`;
      if (findMatchKeys.has(key)) {
        if (key === findCurrentKey) {
          delete css.backgroundColor;
          css.background = FIND_CURRENT_BG;
          css.backgroundColor = FIND_CURRENT_BG;
        } else {
          css.backgroundColor = FIND_MATCH_BG;
        }
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
   *  way the editors read and write it, bare numbers, ISO dates, and
   *  TRUE/FALSE for a checkbox (the token coercePaste takes back).
   *
   *  An open cell's per-cell nf/dp is NOT applied here either, for the same
   *  reason: this text feeds paste, the fill handle's series and the
   *  formula bar, all of which re-enter through the PLAIN autoTypeEntry
   *  grammar (a pasted TSV carries no format), so "5%" / "$5.00" here would
   *  come back as TEXT: a fill-down from one currency cell would plant
   *  text cells that SUM reads as #VALUE!. The raw 0.05 / 5 round-trips as
   *  the number it is. The formatted text lives in displayCell and the
   *  formatted CSV export. */
  const cellText = (col: Column, r: ApiRow): string => {
    const v = r.values[col.id];
    // A computed cell copies its DISPLAY value. Copying the SOURCE would be
    // the in-grid ideal, but "=A1+B2" pasted into Excel would resolve against
    // EXCEL's A1, cross-app source transfer is a later feature, and the
    // display value at least round-trips as the literal the user saw.
    // A spilled cell (from =SEQUENCE/=UNIQUE/=SORT/=FILTER…) has an empty
    // store but a computed value the engine holds; render THAT, not "".
    if (col.type === "formula" || isFormulaCell(v) || engineHost.isSpilledCell(col.id, r.id)) {
      // Streaming honesty gate: copy copies what the user sees, and during
      // a stream that is the pending mark, never a stale computed value.
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
   *  null/undefined/"" (or an empty list) is empty; a formula cell, a
   *  per-cell "=…" in any column, or any cell of a formula column, is
   *  NON-empty even when it evaluates to "", because Sheets stops on a
   *  formula (the cell has content). Numbers and booleans are content
   *  (an unchecked checkbox is FALSE, not blank). Computed relational
   *  columns answer with the same text the clipboard reads, so what copies
   *  as "" also jumps as empty. */
  // Cmd+Arrow across a long column calls this per cell: O(1) column lookup.
  // Plain Map, not useMemo, this sits after the component's early returns
  // where hooks are illegal; a few dozen columns per render is nothing.
  const colByIdForEmpty = new Map(table.columns.map((c) => [c.id, c]));
  const isCellEmpty = (rowId: string, colId: string): boolean => {
    const r = rowById.get(rowId);
    if (!r) return true;
    const v = r.values[colId];
    if (isFormulaCell(v)) return false;
    const c = colByIdForEmpty.get(colId);
    if (c?.type === "formula") return false;
    // A spilled array value is content, so Cmd+Arrow stops on it.
    if (engineHost.isSpilledCell(colId, r.id)) return false;
    if (c && (c.type === "lookup" || c.type === "rollup")) return cellText(c, r) === "";
    if (Array.isArray(v)) return v.length === 0;
    return v == null || v === "";
  };

  /** Write a matrix anchored at topLeft, walking DOWN the current display
   *  order (sortedRows), the grid may be sorted or filtered, and Phase 1
   *  keys everything by rowId for exactly this reason.
   *
   *  Column mapping: matrix column k targets display column topLeft.c + k
   *  INCLUDING read-only ones, so the pasted block keeps its shape; the
   *  read-only ones simply emit no write. Columns past the last one are
   *  clipped, a paste never creates columns. Rows past the last one are
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
          // Paste auto-grow: a multi-line string landing in this row rides
          // its "$rh" growth in the SAME update, same batch write, same
          // undo command (befores below key off these values, so the old
          // height is captured with the old cells). Growth-only, like the
          // editor commit: a paste never shrinks a taller row.
          Object.assign(values, growHeightPatch(target.values, Object.values(values)));
          updatesByRow.set(target.id, { ...(updatesByRow.get(target.id) ?? {}), ...values });
        }
      } else {
        // A brand-new row has nothing to clear, so nulls are dropped.
        const kept = Object.fromEntries(Object.entries(values).filter(([, v]) => v !== null));
        // Appended rows grow from the default height (no prior "$rh" to
        // respect) so a pasted multi-line block reads whole immediately.
        inserts.push({ values: { ...kept, ...growHeightPatch(undefined, Object.values(kept)) } });
      }
    }

    const updates = [...updatesByRow].map(([id, values]) => ({ id, values }));
    // A row carrying ONLY the "$rh" rider cannot exist (the rider is added
    // exactly when a pasted string landed), so this emptiness gate needs no
    // reserved-key filter, but the CELL count below does: the height rider
    // is geometry, not a pasted cell, and counting it would lie in the toast.
    const realInserts = inserts.some((i) => Object.keys(i.values).length > 0) ? inserts : [];
    const countCells = (values: Record<string, unknown>) => Object.keys(values).filter((k) => !isReservedKey(k)).length;
    const written =
      updates.reduce((n, u) => n + countCells(u.values), 0) +
      realInserts.reduce((n, i) => n + countCells(i.values), 0);

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
      // ONE setCells pass for the whole paste/fill before the paint, this
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
          const res = await fetchWithRetry(`/api/tables/${tableId}/rows/batch`, {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ updates: updates.slice(i, i + BATCH_MAX_OPS) }),
          });
          if (!res.ok) throw new Error();
          for (const mid of await readBatchMissingIds(res)) missingRows.add(mid);
        }
        if (oneShot && (updates.length > 0 || realInserts.length > 0)) {
          // Updates alone are idempotent and ride the retry (the common paste
          // into existing rows); a call that also INSERTS rows keeps a plain
          // fetch, because a repeat after a lost response would add them
          // twice. Its failure is surfaced by the catch below either way.
          const send = realInserts.length === 0 ? fetchWithRetry : fetch;
          const res = await send(`/api/tables/${tableId}/rows/batch`, {
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
          // ids from there, a guessed id would break every rowId-keyed thing
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
      // The pasted values into existing rows join the unsaved ledger, so the
      // reload below (which reconciles whatever part of a split paste did
      // commit) puts them back on screen, marked Not saved, with Retry.
      // Setting a cell is idempotent, so a re-send is safe. Rows the paste
      // would have ADDED past the end have no id to keep them under; the
      // clipboard still holds them.
      for (const u of updates) noteWriteFailed(rowLedgerKey(u.id), u.values);
      toast(realInserts.length > 0
        ? "Couldn't paste. The pasted cells are kept as Not saved; the rows past the end were not added."
        : "Couldn't paste. The pasted cells are kept as Not saved.", {
        tone: "danger",
        // Unkeyed when rows were dropped: a later successful Retry saves the
        // cells but never adds those rows, so that note must not vanish.
        key: realInserts.length > 0 ? undefined : SAVE_FAILED_TOAST,
        action: { label: "Retry", onClick: () => void retryFailedWrites() },
      });
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

  /** Double-click on the resize grip: fit the column to its widest MOUNTED
   *  cell (Sheets' autofit, approximated over the virtual window, the
   *  unmounted tail cannot be measured without materializing it, and the
   *  480px cap bounds the error). DOM walk, not canvas measureText: each
   *  mounted cell's ".truncate" display node is already laid out in that
   *  cell's OWN font, per-cell bold/italic/size from "$fmt" included,
   *  so scrollWidth is the browser's own single-line measurement, where a
   *  canvas would have to re-derive every cell's font string and drift.
   *  scrollWidth reports local (pre-zoom) px, the same space col.width
   *  lives in. Persists through the SAME path the drag's release uses
   *  (persistColumns; deliberately NO undo entry, width drags never made
   *  one, and autofit matches them). */
  const autoFitColumn = (colId: string) => {
    const wrap = gridWrapElRef.current;
    const idx = table.columns.findIndex((c) => c.id === colId);
    if (!wrap || idx < 0) return;
    let widest = 0;
    // aria-colindex is 1-based over the data columns (the gutter carries
    // none), the same mapping the active-cell observer reads back.
    wrap.querySelectorAll<HTMLElement>(`[role="gridcell"][aria-colindex="${idx + 1}"] > div.truncate`)
      .forEach((el) => { widest = Math.max(widest, el.scrollWidth); });
    // + the cell's px-2 padding (16) + right border + a rounding px; then
    // the contract clamp: 40 keeps the grip grabbable on an empty column,
    // 480 keeps one long URL from swallowing the viewport.
    const w = Math.min(480, Math.max(40, widest + 18));
    setColumnWidthLocal(colId, w);
    // Functional read-then-persist (the startResize release discipline):
    // the persist must see the width the line above just installed.
    setTable((prev) => { if (prev) void persistColumns(prev.columns); return prev; });
  };

  /** Double-click on a ROW boundary (kernel onRowAutofit): Sheets' row
   *  autofit, set each target row to EXACTLY the height its content
   *  needs. Measured from the mirror, not the DOM (autoFitColumn's DOM
   *  walk exists for fonts; height is pure line arithmetic, and unmounted
   *  columns still count): per cell the DISPLAYED text's line count,
   *  breaks come only from explicit "\n", there is no soft wrap. A
   *  single-line row stores null, i.e. returns to the DEFAULT height:
   *  that IS Sheets' behavior, and it is why this is a different gesture
   *  from the commit/paste auto-grow, a double-click is explicit intent
   *  to FIT, so it shrinks as readily as it grows. Selection-aware like
   *  resizeRowsTo (every selected row when the boundary belongs to the
   *  selection, each to ITS OWN content), ONE undo command. */
  const autofitRows = (rowId: string) => {
    const sel = gridSelection;
    const targets = sel && sel.rowIds.length > 1 && sel.rowIds.includes(rowId) ? sel.rowIds : [rowId];
    // The sync mirror, not render-scope rows: the kernel's dblclick handler
    // may outlive the render that created it by a beat (resizeRowsTo's rule).
    const live = new Map((rowsRef.current ?? []).map((r) => [r.id, r]));
    // undefined = unmeasurable (skip the row); null = default; number = fit.
    const fitOf = (r: ApiRow): number | null | undefined => {
      let lines = 1;
      for (const c of table.columns) {
        const v = r.values[c.id];
        if (c.type === "formula" || isFormulaCell(v)) {
          // Streaming honesty gate (displayCell's rule): mid-stream the
          // host still holds the pre-stream world, so this row's computed
          // text cannot be measured, skip the row rather than fit it to
          // a value the user isn't even shown.
          if (streamProgress) return undefined;
          lines = Math.max(lines, lineCountOf(String(engineHost.display(c.id, r.id) ?? "")));
        } else {
          // cellText preserves a string value's "\n" and renders every
          // non-string type on one line, exactly the display's line count.
          lines = Math.max(lines, lineCountOf(cellText(c, r)));
        }
      }
      return lines <= 1 ? null : fitHeightFor(lines);
    };
    // Already at the fit ⇒ no write, no history entry (the formatCells
    // no-op rule); junk stored heights read as default, so fitting a
    // single-line row over junk is also a no-op, readers never saw it.
    const changed: { id: string; px: number | null }[] = [];
    for (const id of targets) {
      const row = live.get(id);
      if (!row) continue;
      const px = fitOf(row);
      if (px === undefined) continue;
      if ((readRowHeight(row.values[ROW_HEIGHT_KEY]) ?? null) !== px) changed.push({ id, px });
    }
    if (changed.length === 0) return;
    if (changed.length === 1) {
      // Single row: the normal row PATCH captures the old "$rh" as before.
      void patchRow(changed[0].id, { [ROW_HEIGHT_KEY]: changed[0].px }, { label: "autofit row" });
      return;
    }
    // Group autofit: ONE batch, ONE undo command; befores keep each row's
    // raw stored value (junk included) so undo restores exactly what was.
    const befores = changed.map(({ id }) => ({ id, values: { [ROW_HEIGHT_KEY]: live.get(id)!.values[ROW_HEIGHT_KEY] ?? null } }));
    const afters = changed.map(({ id, px }) => ({ id, values: { [ROW_HEIGHT_KEY]: px } }));
    void (async () => {
      try {
        await writeValuesBatchStrict(afters);
        pushUndo({
          label: `autofit ${changed.length} rows`,
          undo: () => writeValuesBatchStrict(befores),
          redo: () => writeValuesBatchStrict(afters),
        });
      } catch { toast("Couldn't autofit rows"); void load(); }
    })();
  };

  /** The column header (Phase 5, spec-tables-forms "Column headers").
   *  An UNNAMED column renders its letter, centred, exactly as before. A
   *  NAMED column renders the name, left aligned, with the letter in small
   *  type before it so A1 references stay readable. A type glyph precedes
   *  the label when the type is not Text; a Lock follows it when the column
   *  is protected. The 16px chevron (hover, keyboard focus, always on a
   *  coarse pointer) opens the column menu, as do right click and Alt+Down
   *  on the focused header. Double click, Enter or F2 swaps the label for the
   *  inline name input. The label doubles as the drag-to-reorder handle and
   *  the right edge stays the resize grip. */
  const kernelHeader = (colId: string) => {
    const c = table.columns.find((x) => x.id === colId);
    if (!c) return null;
    const colIndex = table.columns.findIndex((x) => x.id === colId);
    const letter = columnLetter(colIndex);
    const named = c.label.trim() !== "";
    const TypeIcon = c.type !== "short_text" ? COLUMN_TYPE_ICON[c.type] : undefined;
    if (renamingColId === c.id) {
      return (
        <div className="flex h-7 items-center px-0.5">
          <HeaderRenameInput
            initial={c.label}
            placeholder={letter}
            onCommit={(v) => { setRenamingColId(null); commitRename(c.id, v); focusHeaderCell(c.id); }}
            onCancel={() => { setRenamingColId(null); focusHeaderCell(c.id); }}
          />
        </div>
      );
    }
    return (
      <div
        className="relative flex h-7 items-center gap-1"
        style={{ opacity: dragColId === c.id ? 0.5 : 1 }}
        onDragOver={(e) => { if (dragColId) e.preventDefault(); }}
        onDrop={(e) => { e.preventDefault(); if (dragColId) moveColumn(dragColId, c.id); setDragColId(null); }}
      >
        <span
          title={`${named ? `${c.label} · ` : ""}Column ${letter}${c.protected ? " · protected (read-only)" : ""} · drag to reorder · double-click to rename`}
          draggable
          onDragStart={() => setDragColId(c.id)}
          onDragEnd={() => setDragColId(null)}
          className={`flex min-w-0 flex-1 cursor-grab items-center gap-1 ${named ? "justify-start pl-1" : "justify-center"}`}
        >
          {named ? <span className="shrink-0 text-micro font-medium normal-case tracking-normal text-ink-3">{letter}</span> : null}
          {TypeIcon ? <TypeIcon className="h-3 w-3 shrink-0 text-ink-3" aria-label={columnTypeLabel(c.type)} /> : null}
          {named
            ? <span className="min-w-0 truncate text-sm font-medium text-ink">{c.label}</span>
            : <span className="text-xs font-medium text-ink-2">{letter}</span>}
          {c.protected ? <Lock className="h-3 w-3 shrink-0 text-ink-3" aria-label="Protected column" /> : null}
        </span>
        <button
          type="button"
          tabIndex={-1}
          aria-label={`Column ${named ? c.label : letter} menu`}
          title="Column menu"
          className="flex h-4 w-4 shrink-0 items-center justify-center rounded text-ink-2 opacity-0 hover:bg-hover group-hover/colhead:opacity-100 group-focus-visible/colhead:opacity-100 [@media(pointer:coarse)]:opacity-100"
          onClick={(e) => {
            e.stopPropagation();
            const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
            setHeaderMenu({ colId: c.id, x: rect.left, y: rect.bottom + 2 });
          }}
        >
          <ChevronDown className="h-3.5 w-3.5" aria-hidden />
        </button>
        <span
          data-no-select
          onMouseDown={(e) => startResize(e, c.id)}
          onDoubleClick={(e) => { e.preventDefault(); e.stopPropagation(); autoFitColumn(c.id); }}
          title="Drag to resize · double-click to fit"
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
      toast("This cell is computed by its column. Edit the column instead.");
      return;
    }
    const trimmed = raw.trim();
    if (trimmed.startsWith("=")) {
      if (trimmed === "=") return; // a lone "=" is an abandoned edit, not a formula
      try {
        // Trimmed, because the host classifies by FIRST character, " =A1"
        // would slip through as a literal.
        const res = (engineHostRef.current ?? engineHost).setCell(colId, rowId, trimmed);
        // The setCell above IS the host drive, incremental, only the
        // transitive dependents recomputed, so patchRow skips its own
        // pass (hostApplied). Computed values are never sent to the
        // server. res.previous, the engine's authoritative overwritten
        // value, seeds the undo command.
        bumpEngine();
        void patchRow(rowId, { [colId]: res.stored }, { before: { [colId]: res.previous }, label: "formula edit", hostApplied: true, guard: true });
      } catch {
        toast("Couldn't save formula");
      }
      return;
    }
    // A literal typed into an OPEN cell (formula bar, or replacing a formula
    // from the grid editor) is an EDITOR entry, not a paste: it takes the
    // rich grammar, so "5%" in the bar formats the cell exactly as "5%" in
    // the cell would. (The bar shows the stored 0.05, see cellText; a bare
    // re-entry keeps the cell's format.)
    if (isOpenColumnType(col.type)) {
      void patchRow(rowId, openEntryValues(rowId, colId, raw), { guard: true });
      return;
    }
    // Every other literal is coerced with the same rules as paste, so the
    // stored shape matches the column type.
    const res = coercePaste(col, raw);
    if (res.kind === "skip") {
      toast("That value doesn't fit this column. Nothing was saved.");
      return;
    }
    // Guarded (Phase 5c): this path knows the exact stored value it is
    // replacing, see patchRow's guard note for the full opt-in policy.
    void patchRow(rowId, { [colId]: res.value }, { guard: true });
  };

  /** Text editors commit through here so "=…" becomes a stored formula even
   *  when the editor was opened plain (F2 first, "=" typed after), the
   *  seed path below only catches type-to-replace. */
  /** Sheets auto-fit: a committed multi-line value grows its row to show
   *  every line (never shrinks, other cells may need the height; manual
   *  taller resizes are respected). 17px per line tracks the display's
   *  13px/leading-tight; the first line rides the default row.
   *
   *  Split into pure pieces because THREE gestures share the arithmetic and
   *  must agree on it: the editor commit (below), the paste path's per-row
   *  growth rider (applyMatrix), and the boundary double-click's autofit
   *  (autofitRows), one drifting constant would make a typed row and a
   *  pasted row disagree about the same content's height. */
  // Display lines come ONLY from explicit "\n" breaks (there is no soft
  // wrap), so anything that isn't a string is one line by construction.
  const lineCountOf = (v: unknown): number =>
    typeof v === "string" && v.includes("\n") ? v.split("\n").length : 1;
  const fitHeightFor = (lines: number): number =>
    Math.min(ROW_HEIGHT_MAX, SHEET_ROW_H + (lines - 1) * 17 + 4);
  /** Growth-only "$rh" rider for values landing on a row: the max line
   *  count across the landing cells decides the needed height, and the
   *  patch is empty unless that BEATS the row's stored height, the guard
   *  reads the stored "$rh" itself (not the values object: that read was a
   *  bug that always answered "default" and let a short multi-line commit
   *  shrink a manually-taller row). */
  const growHeightPatch = (curValues: Record<string, unknown> | undefined, vs: unknown[]): Record<string, unknown> => {
    let lines = 1;
    for (const v of vs) lines = Math.max(lines, lineCountOf(v));
    if (lines <= 1) return {};
    const cur = readRowHeight(curValues?.[ROW_HEIGHT_KEY]) ?? SHEET_ROW_H;
    const needed = fitHeightFor(lines);
    return needed > cur ? { [ROW_HEIGHT_KEY]: needed } : {};
  };
  const autoGrowFor = (rowId: string, v: unknown): Record<string, unknown> =>
    growHeightPatch((rowsRef.current ?? []).find((r) => r.id === rowId)?.values, [v]);

  const commitEditorValue = (rowId: string, colId: string, v: unknown) => {
    if (typeof v === "string" && v.trimStart().startsWith("=")) {
      commitCellText(rowId, colId, v);
      return;
    }
    // Data validation (reject-mode): refuse an entry that breaks the
    // column's rule and leave the old value. Validate the would-be STORED
    // value (open columns type "5" → 5), never the raw keystrokes.
    const vcol = table.columns.find((c) => c.id === colId);
    if (vcol?.validation) {
      // Validate the value that will actually be STORED. Open columns store
      // the RICH parse (resolveOpenEntry), validating the plain autoType
      // answer could diverge (e.g. "5%" stores 0.05 but plainly reads 5).
      const candidate = isOpenColumnType(vcol.type) && typeof v === "string"
        ? resolveOpenEntry(v, readCellStyle((rowsRef.current ?? []).find((r) => r.id === rowId)?.values, colId)).value
        : v;
      const res = validateValue(vcol.validation, candidate);
      if (!res.ok) { toast(res.reason); return; }
    }
    // Entry-time typing (lib/sheet-entry): in an OPEN column the plain
    // editor's "5" is stored as the number 5: Sheets' rule, and the only
    // way SUM(A1:A3) over a fresh sheet can ever be non-zero, because the
    // engine deliberately reads numeric TEXT as a number in numeric-typed
    // columns only. Every other type stores what its editor produced.
    const col = table.columns.find((c) => c.id === colId);
    if (col && isOpenColumnType(col.type) && typeof v === "string") {
      // Guarded (Phase 5c): see patchRow's guard note for the opt-in policy.
      // autoGrowFor rides the SAME patch: one write, one undo entry, and
      // the reserved-key filter keeps "$rh" out of the expect map.
      void patchRow(rowId, { ...openEntryValues(rowId, colId, v), ...autoGrowFor(rowId, v) }, { guard: true });
      return;
    }
    // Legacy note: a cell that still holds the STRING "5" (typed before this
    // rule existed) re-committed untouched becomes the number 5. That is a
    // real write on purpose (it upgrades the text to the number the user
    // always meant) and it cannot false-409: patchRow builds `expect` from
    // the STORED value ("5"), which is exactly what the server still holds.
    // Guarded (Phase 5c): see patchRow's guard note for the opt-in policy.
    void patchRow(rowId, { [colId]: v, ...autoGrowFor(rowId, v) }, { guard: true });
  };

  /** The row patch for a plain-editor commit on an OPEN cell: the typed
   *  value, plus the row's whole "$fmt" map when the entry carried a
   *  symbol that changes the cell's nf ("5%", "$5"). Both ride ONE row
   *  write so the server, the conflict guard and undo each see one atomic
   *  change (undo restores value AND format together). Reads the sync
   *  mirror, not render-scope state: the map is a read-modify-write and
   *  must start from the row as it is NOW. */
  const openEntryValues = (rowId: string, colId: string, text: string): Record<string, unknown> => {
    const row = (rowsRef.current ?? []).find((r) => r.id === rowId);
    const entry = resolveOpenEntry(text, readCellStyle(row?.values, colId));
    // A cleared entry stores null, the empty cell every reader and the
    // paste path already agree on, not an empty string.
    const values: Record<string, unknown> = { [colId]: entry.value === "" ? null : entry.value };
    if (entry.fmt && row) {
      // null, never a dropped key, when the map empties: the server merge
      // is shallow and cannot delete (formatCells' rule).
      values[CELL_STYLE_KEY] = withCellStyle(row.values, colId, entry.fmt)[CELL_STYLE_KEY] ?? null;
    }
    return values;
  };

  const kernelEditor = (rowId: string, colId: string, opts: { seed: string | null; commit: () => void; move: (dr: number, dc: number) => void }) => {
    const r = rowById.get(rowId);
    const c = table.columns.find((x) => x.id === colId);
    if (!r || !c) return null;
    // A formula cell always edits as its SOURCE (never the computed value,
    // the user must see what their edit replaces), and a "=" seed opens the
    // formula editor in ANY editable cell: number/date/choice editors cannot
    // even type "=", so the formula editor takes over for them.
    // Raw stored shape FIRST: during a multi-chunk stream (or a refetch's
    // stale window) the host doesn't know this table's cells yet, and a
    // plain editor opened on an unrecognized formula cell would commit a
    // literal over it, silent destruction. The {"=": ...} shape is
    // stream-independent truth; the host only ADDS formula-column fills.
    const rawStored = r.values[colId];
    const rawFormula = isFormulaCell(rawStored);
    const hasFormula = rawFormula || engineHost.isFormulaCell(colId, rowId);
    // A spilled cell borrows its value from a neighbouring array formula and
    // has no content of its own, read-only, like Sheets/Excel. To change it,
    // edit the array's anchor (top-left) cell.
    if (!hasFormula && engineHost.isSpilledCell(colId, rowId)) return null;
    const formulaSeed = opts.seed != null && opts.seed.trimStart().startsWith("=");
    if (hasFormula || formulaSeed) {
      // cellSource returns "=SRC" (with the "=") for any computed cell. ANY
      // seed wins over the source, type-to-replace on a formula cell starts
      // from what was typed, exactly like the plain editors, while the
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
      // per cell so every re-render of this session passes the SAME seed,
      // see sigmaSessionRef for why it must never flap back to "=".
      if (formulaSeed && sigmaSeedRef.current) sigmaSessionRef.current = { rowId, colId, seed: sigmaSeedRef.current };
      const sigma = sigmaSessionRef.current;
      const seed = formulaSeed && sigma && sigma.rowId === rowId && sigma.colId === colId ? sigma.seed : opts.seed;
      return (
        <SheetEditorHost seed={seed} commit={() => { sigmaSessionRef.current = null; opts.commit(); }} move={opts.move}>
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
      <CellEditor column={c} value={r.values[c.id]} cellStyle={readCellStyle(r.values, c.id)} onChange={(v) => commitEditorValue(r.id, c.id, v)} />
    );
    return <SheetEditorHost seed={opts.seed} commit={opts.commit} move={opts.move}>{inner}</SheetEditorHost>;
  };

  // ── Formula bar plumbing (Tables Phase 3) ───────────────────────
  const activeColDef = activeCell ? table.columns.find((c) => c.id === activeCell.colId) : undefined;
  const activeCellRow = activeCell ? rowById.get(activeCell.rowId) : undefined;
  // The toolbar's B/I/U/S/colour/align pills reflect the ACTIVE cell's
  // stored style (Sheets lights the pill when the cursor sits on bold).
  const activeStyle = activeCell ? readCellStyle(activeCellRow?.values, activeCell.colId) : undefined;
  // The $ / % pills, the 123 menu's check and the stepper tooltips read
  // the ACTIVE cell's number format the way the toolbar would write it:
  // the cell's own nf/dp on an open column (a bare open cell is "plain"),
  // the column's type/format on a legacy typed column.
  const activeOpen = !!activeColDef && isOpenColumnType(activeColDef.type);
  const activeKind: NumberFormatKind | undefined = !activeColDef
    ? undefined
    : activeOpen
      ? (activeStyle?.nf ?? "plain")
      : (activeColDef.format?.style ?? kindForColType(activeColDef.type));
  const activeDp: number | undefined = activeOpen
    ? (activeStyle?.nf ? (activeStyle.dp ?? defaultDp(activeStyle.nf)) : undefined)
    : activeKind === "number" || activeKind === "currency" || activeKind === "percent"
      ? (activeColDef?.format?.decimals ?? (activeKind === "percent" ? 0 : 2))
      : undefined;
  const stepTitle = (base: string, delta: 1 | -1) =>
    activeDp === undefined ? base : `${base} (${activeDp} → ${Math.min(10, Math.max(0, activeDp + delta))})`;
  const fmtDisabled = streamProgress !== null;
  // One predicate for the gutter-drag gate AND the row-insert menu items.
  const rowInsertBlocked = !!sortState || filterActive || !!search.trim() || streamProgress !== null;
  // The "Filter · N" chip: every column filter that narrows, plus the search.
  const filterCount = activeFilterCount(filters, search);
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
  // The tooltip names what the disabled format controls wait for.
  const FMT_STREAM_TITLE = streamProgress
    ? `Loading rows, ${streamProgress.loaded.toLocaleString()}${streamProgress.total !== null ? ` of ${streamProgress.total.toLocaleString()}` : ""}`
    : "";
  let barCell: FormulaBarCell | null = null;
  if (activeCell && activeColDef && activeCellRow) {
    const colIndex = table.columns.findIndex((c) => c.id === activeCell.colId);
    // The address row number is the UNSORTED index, the row an A1 ref in a
    // formula would actually resolve to, not the display-sorted position.
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
      const spilledCell = engineHost.isSpilledCell(activeCell.colId, activeCell.rowId);
      barCell = {
        address: `${columnLetter(colIndex)}${rowNumber}`,
        source: src ?? cellText(activeColDef, activeCellRow),
        readOnly: activeColDef.type === "formula" || computedCol || pickerCol || spilledCell || !!activeColDef.protected,
        readOnlyReason: activeColDef.type === "formula"
          ? "This column computes its formula. Edit it from the column menu (Edit formula)."
          : computedCol
            ? "This column is computed. Configure it from the column menu."
            : spilledCell
              ? "This cell is spilled from an array formula. Edit the array's top-left cell."
              : activeColDef.protected
                ? "This column is protected. Unprotect it from the column menu to edit."
                : "This column edits through its picker in the grid.",
      };
    }
  }

  /* ── The sheet's chrome: role, menus, toolbar popovers ─────────────── */

  // Read implies write on a table until the access engine lands Can view
  // (docs/plans/tables.md 3a), so every reader is at least Can edit; the
  // creator and Owners/Admins hold Full access (lib/object-manage).
  const shareRole = table.canManage ? "FULL" : "EDIT";
  const tableName = table.name || UNTITLED_TABLE_NAME;
  const colIndexOf = (colId: string | undefined) => (colId ? table.columns.findIndex((c) => c.id === colId) : -1);
  const activeColIdx = colIndexOf(activeCell?.colId);
  const activeColumn = activeColIdx >= 0 ? table.columns[activeColIdx] : undefined;
  const activeDisplayIdx = activeCell ? sortedRows.findIndex((r) => r.id === activeCell.rowId) : -1;
  const needCell = "Select a cell first";

  /** Run one of the kernel's own shortcuts (fill, clear, cut, copy, paste):
   *  focus the grid and dispatch the keydown it already answers, so a menu
   *  row and its shortcut can never do two different things. */
  const sendGridKey = (key: string, mods: { meta?: boolean; shift?: boolean } = {}) => {
    const gridEl = gridWrapElRef.current?.querySelector<HTMLElement>('[role="grid"]');
    if (!gridEl) return;
    gridEl.focus({ preventScroll: true });
    const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);
    gridEl.dispatchEvent(new KeyboardEvent("keydown", {
      key, bubbles: true, cancelable: true, shiftKey: !!mods.shift,
      metaKey: !!mods.meta && isMac, ctrlKey: !!mods.meta && !isMac,
    }));
  };

  /** A function seed in the active cell (Insert > Function), the Σ path. */
  const insertFunctionSeed = (fn: string) => {
    const gridEl = gridWrapElRef.current?.querySelector<HTMLElement>('[role="grid"]');
    if (!gridEl || !activeCell) { toast(needCell); return; }
    const col = table.columns.find((c) => c.id === activeCell.colId);
    if (!col || COMPUTED_TYPES.has(col.type)) { toast("This cell is computed by its column. Pick another cell."); return; }
    sigmaSeedRef.current = `=${fn}(`;
    gridEl.focus({ preventScroll: true });
    gridEl.dispatchEvent(new KeyboardEvent("keydown", { key: "=", bubbles: true, cancelable: true }));
    window.setTimeout(() => { sigmaSeedRef.current = null; }, 0);
  };

  const copyText = (text: string, done: string) => {
    void navigator.clipboard?.writeText(text).then(() => toast(done), () => toast("Couldn't copy", { tone: "danger" }));
  };
  // The share form: the door from Work (never a Space's slug), canonical elsewhere.
  const copySheetLink = () => copyText(copyObjectLink("table", table.id), "Link copied");

  const makeCopy = async () => {
    const r = await fetch(`/api/tables/${table.id}/duplicate`, { method: "POST" }).catch(() => null);
    const d = r && r.ok ? await r.json().catch(() => null) : null;
    const id = (d?.data ?? d)?.id as string | undefined;
    if (!id) { toast("Couldn't copy the table", { tone: "danger" }); return; }
    notifyTablesChanged();
    router.push(objectHrefNow("table", id, place?.spaceSlug));
  };
  const newTable = async () => {
    try {
      const t = await createNewTable({ spaceId: table.spaceId ?? null });
      notifyTablesChanged();
      bumpRowVersion("tables");
      // newTableHref's ?new=1 on the address of the section the sheet is in.
      router.push(`${objectHrefNow("table", t.id, place?.spaceSlug)}?new=1`);
    } catch { toast("Couldn't create the table", { tone: "danger" }); }
  };
  const trashTable = async () => {
    const ok = await confirm({
      title: `Move "${tableName}" to Trash?`,
      description: "Its rows go with it. You can restore it from Trash.",
      destructive: true,
      confirmLabel: "Move to Trash",
    });
    if (!ok) return;
    const r = await fetch(`/api/tables/${table.id}`, { method: "DELETE" }).catch(() => null);
    if (!r || !r.ok) {
      const d = r ? await r.json().catch(() => ({})) : {};
      toast(r?.status === 403 && typeof d?.error === "string" ? d.error : "Couldn't move the table to Trash", { tone: "danger" });
      return;
    }
    notifyTablesChanged();
    toast("Moved to Trash", { action: { label: "View Trash", onClick: () => router.push("/trash?type=table") } });
    router.push(inWork && place ? place.closeHref : "/tables");
  };
  const deleteSelectedRows = () => {
    const ids = gridSelection?.rowIds?.length ? gridSelection.rowIds : activeCell ? [activeCell.rowId] : [];
    if (ids.length === 0) { toast(needCell); return; }
    if (ids.length > 1) void bulkDeleteRows(ids); else void deleteRow(ids[0]);
  };
  const deleteSelectedColumns = async () => {
    const ids = selectionColumnIds();
    if (ids.length === 0) { toast(needCell); return; }
    for (const id of ids) await deleteColumn(id);
  };
  const promptRowHeight = async () => {
    if (!activeCell) { toast(needCell); return; }
    const raw = await promptDialog({ title: "Row height", description: "In pixels, 16 to 400.", defaultValue: String(SHEET_ROW_H) });
    if (raw == null) return;
    const h = Math.round(Number(raw));
    if (!Number.isFinite(h) || h < 16 || h > 400) { toast("Enter a height from 16 to 400"); return; }
    resizeRowsTo(activeCell.rowId, h);
  };
  const setViewPref = (key: "gridlines" | "formulaBar", value: boolean) => {
    void patchPrefs({ home: { tables: { [key]: value } } } as Parameters<typeof patchPrefs>[0]);
  };
  const openColumnTypeForActive = () => {
    if (!activeColumn) { toast(needCell); return; }
    const hdr = gridWrapElRef.current?.querySelector<HTMLElement>(`[role="columnheader"][data-col-index="${activeColIdx}"]`);
    const rect = hdr?.getBoundingClientRect();
    setTypePicker({ colId: activeColumn.id, top: rect ? rect.bottom + 4 : 160, left: rect ? rect.left : 160 });
  };
  const clearFormatting = () => formatSelection("clear formatting", { b: undefined, i: undefined, u: undefined, s: undefined, c: undefined, bg: undefined, a: undefined });
  const swatchLeading = (hex: string) => <span className="h-4 w-4 rounded-sm border border-line" style={{ background: hex }} aria-hidden />;

  /** Pivot > Insert as a new table: the result, written to a real table
   *  (POST /api/tables with its columns, then the rows in batch chunks),
   *  offered to open. The only way a pivot result is ever stored. */
  const insertPivotAsTable = async (result: { headers: string[]; rows: (string | number)[][] }) => {
    const cols = result.headers.map((h, i) => ({ id: `p${i}${newId()}`, type: i === 0 ? "short_text" : "number", label: h }));
    const created = await fetch("/api/tables", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: `${tableName} pivot`.slice(0, 200), columns: cols, ...(table.spaceId ? { spaceId: table.spaceId } : {}) }),
    }).catch(() => null);
    const d = created && created.ok ? await created.json().catch(() => null) : null;
    const newTableId = (d?.data ?? d)?.id as string | undefined;
    if (!newTableId) { toast("Couldn't create the table", { tone: "danger" }); return; }
    const inserts = result.rows.map((r) => ({ values: Object.fromEntries(r.map((v, i) => [cols[i].id, v]).filter(([, v]) => v !== "")) }));
    for (let i = 0; i < inserts.length; i += BATCH_MAX_OPS) {
      const res = await fetch(`/api/tables/${newTableId}/rows/batch`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ inserts: inserts.slice(i, i + BATCH_MAX_OPS) }),
      }).catch(() => null);
      if (!res || !res.ok) { toast("The table was created but some rows did not save", { tone: "danger", action: { label: "Open table", onClick: () => router.push(objectHrefNow("table", newTableId)) } }); notifyTablesChanged(); return; }
    }
    notifyTablesChanged();
    toast("Pivot saved as a new table", { tone: "success", action: { label: "Open table", onClick: () => router.push(objectHrefNow("table", newTableId)) } });
  };

  const menus: SheetMenuSpec[] = [
    {
      key: "file", label: "File", items: [
        { label: "New table", icon: Plus, onSelect: () => void newTable() },
        { label: "Make a copy", icon: Copy, onSelect: () => void makeCopy() },
        { label: "Import a CSV…", icon: Upload, onSelect: () => setCsvOpen(true) },
        { label: "Download", icon: Download, submenu: [
          { label: "CSV, formatted values", onSelect: () => exportCsv(true) },
          { label: "CSV, raw values", onSelect: () => exportCsv(false) },
        ] },
        { label: "Print", icon: Printer, shortcut: "⌘P", onSelect: () => window.print() },
        { separator: true },
        ...(table.canManage ? [{ label: "Move to Space…", icon: FolderInput, onSelect: () => { setSheetMenuMode("move"); setSheetMoreOpen(true); } }] : []),
        { label: "Rename", icon: Pencil, onSelect: () => { titleInputRef.current?.focus(); titleInputRef.current?.select(); } },
        { label: "About…", icon: Info, onSelect: () => setAboutOpen(true) },
        ...(table.canManage ? [{ separator: true } as const, { label: "Move to Trash", icon: Trash2, destructive: true, onSelect: () => void trashTable() }] : []),
      ],
    },
    {
      key: "edit", label: "Edit", items: [
        { label: "Undo", icon: Undo2, shortcut: "⌘Z", disabled: !undoStack.canUndo() || undoStack.busy(), onSelect: () => void runUndo() },
        { label: "Redo", icon: Redo2, shortcut: "⇧⌘Z", disabled: !undoStack.canRedo() || undoStack.busy(), onSelect: () => void runRedo() },
        { separator: true },
        { label: "Cut", icon: Scissors, shortcut: "⌘X", onSelect: () => sendGridKey("x", { meta: true }) },
        { label: "Copy", icon: Copy, shortcut: "⌘C", onSelect: () => sendGridKey("c", { meta: true }) },
        { label: "Paste", icon: ClipboardPaste, shortcut: "⌘V", onSelect: () => sendGridKey("v", { meta: true }) },
        { separator: true },
        { label: "Fill down", icon: ArrowDownToLine, shortcut: "⌘D", onSelect: () => sendGridKey("d", { meta: true }) },
        { label: "Fill right", icon: ArrowRightToLine, shortcut: "⌘R", onSelect: () => sendGridKey("r", { meta: true }) },
        { separator: true },
        { label: "Find and replace", icon: Search, shortcut: "⌘F", onSelect: () => openFind(true) },
        { separator: true },
        { label: "Clear cells", icon: Eraser, shortcut: "⌫", onSelect: () => sendGridKey("Delete") },
        { label: "Delete rows", icon: Rows3, onSelect: deleteSelectedRows },
        { label: "Delete columns", icon: Columns3, onSelect: () => void deleteSelectedColumns() },
      ],
    },
    {
      key: "view", label: "View", items: [
        { label: "Freeze", icon: Snowflake, submenu: [
          { label: "No rows", checked: !freeze?.rows, onSelect: () => persistFreeze({ rows: undefined }) },
          { label: "1 row", checked: freeze?.rows === 1, onSelect: () => persistFreeze({ rows: 1 }) },
          ...(activeDisplayIdx >= 1 && activeDisplayIdx + 1 < sortedRows.length ? [{ label: `Up to row ${activeDisplayIdx + 1}`, checked: freeze?.rows === activeDisplayIdx + 1, onSelect: () => persistFreeze({ rows: activeDisplayIdx + 1 }) }] : []),
          { separator: true },
          { label: "No columns", checked: !freeze?.cols, onSelect: () => persistFreeze({ cols: undefined }) },
          { label: "1 column", checked: freeze?.cols === 1, onSelect: () => persistFreeze({ cols: 1 }) },
          ...(activeColIdx >= 1 && activeColIdx + 1 < table.columns.length ? [{ label: `Up to column ${columnLetter(activeColIdx)}`, checked: freeze?.cols === activeColIdx + 1, onSelect: () => persistFreeze({ cols: activeColIdx + 1 }) }] : []),
        ] },
        { label: "Gridlines", icon: Grid3x3, checked: showGridlines, onSelect: () => setViewPref("gridlines", !showGridlines) },
        { label: "Formula bar", icon: PanelTop, checked: showFormulaBar, onSelect: () => setViewPref("formulaBar", !showFormulaBar) },
        { separator: true },
        { label: "Zoom", icon: ZoomIn, submenu: ZOOM_LEVELS.map((z) => ({ label: `${z}%`, checked: zoom === z, onSelect: () => changeZoom(z) })) },
        { label: fullScreen ? "Exit full screen" : "Full screen", icon: Maximize2, shortcut: "⇧⌘F", onSelect: () => setFullScreen((v) => !v) },
      ],
    },
    {
      key: "insert", label: "Insert", items: [
        { label: "Row above", icon: Rows3, disabled: rowInsertBlocked, title: rowInsertBlocked ? "Clear the sort, filter and search to insert rows" : undefined, onSelect: () => { if (activeCell) insertRowNear(activeCell.rowId, "above"); else if (rows.length === 0) startEmptyGrid({ r: 0, c: 0, seed: null }); else toast(needCell); } },
        { label: "Row below", icon: Rows3, disabled: rowInsertBlocked, title: rowInsertBlocked ? "Clear the sort, filter and search to insert rows" : undefined, onSelect: () => { if (activeCell) insertRowNear(activeCell.rowId, "below"); else if (rows.length === 0) startEmptyGrid({ r: 0, c: 0, seed: null }); else toast(needCell); } },
        { separator: true },
        { label: "Column left", icon: Columns3, onSelect: () => { if (activeColumn) insertColumnNear(activeColumn.id, "left"); else void addColumn(); } },
        { label: "Column right", icon: Columns3, onSelect: () => { if (activeColumn) insertColumnNear(activeColumn.id, "right"); else void addColumn(); } },
        { separator: true },
        { label: "Function", icon: FunctionSquare, submenu: [
          ...["SUM", "AVERAGE", "COUNT", "MAX", "MIN"].map((fn) => ({ label: fn, onSelect: () => insertFunctionSeed(fn) })),
          { separator: true as const },
          { label: "More functions…", onSelect: () => setFunctionsOpen(true) },
        ] },
        { separator: true },
        { label: "Named range…", icon: Tag, onSelect: () => setNamedRangesOpen(true) },
      ],
    },
    {
      key: "format", label: "Format", items: [
        { label: "Number", icon: Hash, submenu: NUMBER_FORMAT_CHOICES.map((t) => ({ label: t.label, checked: activeKind === t.kind, onSelect: () => applyKindToSelection(t.kind) })) },
        { label: "Text", icon: Type, submenu: [
          { label: "Bold", shortcut: "⌘B", checked: !!activeStyle?.b, disabled: fmtDisabled, title: FMT_STREAM_TITLE || undefined, onSelect: () => toggleStyleFlag("b") },
          { label: "Italic", shortcut: "⌘I", checked: !!activeStyle?.i, disabled: fmtDisabled, title: FMT_STREAM_TITLE || undefined, onSelect: () => toggleStyleFlag("i") },
          { label: "Underline", shortcut: "⌘U", checked: !!activeStyle?.u, disabled: fmtDisabled, title: FMT_STREAM_TITLE || undefined, onSelect: () => toggleStyleFlag("u") },
          { label: "Strikethrough", checked: !!activeStyle?.s, disabled: fmtDisabled, title: FMT_STREAM_TITLE || undefined, onSelect: () => toggleStyleFlag("s") },
        ] },
        { label: "Alignment", icon: AlignLeft, submenu: [
          { label: "Left", checked: activeStyle?.a === "l", disabled: fmtDisabled, onSelect: () => formatSelection("align left", { a: "l" }) },
          { label: "Centre", checked: activeStyle?.a === "c", disabled: fmtDisabled, onSelect: () => formatSelection("align center", { a: "c" }) },
          { label: "Right", checked: activeStyle?.a === "r", disabled: fmtDisabled, onSelect: () => formatSelection("align right", { a: "r" }) },
        ] },
        { label: "Text colour", icon: Baseline, submenu: [
          ...TEXT_SWATCHES.map((sw) => ({ label: sw.name, leading: swatchLeading(sw.hex), checked: activeStyle?.c?.toUpperCase() === sw.hex, disabled: fmtDisabled, onSelect: () => formatSelection(`text color ${sw.name.toLowerCase()}`, { c: sw.hex }) })),
          { separator: true },
          { label: "Reset", disabled: fmtDisabled, onSelect: () => formatSelection("reset text color", { c: undefined }) },
        ] },
        { label: "Fill colour", icon: PaintBucket, submenu: [
          ...FILL_SWATCHES.map((sw) => ({ label: sw.name, leading: swatchLeading(sw.hex), checked: activeStyle?.bg?.toUpperCase() === sw.hex, disabled: fmtDisabled, onSelect: () => formatSelection(`fill ${sw.name.toLowerCase()}`, { bg: sw.hex }) })),
          { separator: true },
          { label: "Reset", disabled: fmtDisabled, onSelect: () => formatSelection("reset fill", { bg: undefined }) },
        ] },
        { separator: true },
        { label: "Conditional formatting…", icon: Palette, onSelect: () => { if (activeColumn) setRulesColId(activeColumn.id); else toast(needCell); } },
        { label: "Data validation…", icon: ShieldCheck, onSelect: () => { if (activeColumn) setValidationColId(activeColumn.id); else toast(needCell); } },
        { separator: true },
        { label: "Column width…", icon: Columns3, onSelect: () => { if (activeColumn) void promptColumnWidth(activeColumn.id); else toast(needCell); } },
        { label: "Row height…", icon: Rows3, onSelect: () => void promptRowHeight() },
        { separator: true },
        { label: "Clear formatting", icon: Eraser, disabled: fmtDisabled, title: FMT_STREAM_TITLE || undefined, onSelect: clearFormatting },
      ],
    },
    {
      key: "data", label: "Data", items: [
        { label: "Sort table", icon: ArrowUpDown, submenu: activeColumn ? [
          { label: `A to Z by ${columnDisplayName(activeColumn.label, activeColIdx)}`, onSelect: () => persistSort({ colId: activeColumn.id, dir: "asc" }) },
          { label: `Z to A by ${columnDisplayName(activeColumn.label, activeColIdx)}`, onSelect: () => persistSort({ colId: activeColumn.id, dir: "desc" }) },
        ] : [{ label: needCell, disabled: true, title: "Sorting sorts by the active cell's column" }] },
        ...(sortState ? [{ label: "Clear sort", icon: X, onSelect: () => persistSort(null) }] : []),
        { separator: true },
        { label: "Filter", icon: Filter, checked: filterOpen, onSelect: () => setFilterOpen((o) => !o) },
        { separator: true },
        { label: "Column type", icon: FileSpreadsheet, onSelect: openColumnTypeForActive },
        ...(activeColumn ? [activeColumn.protected
          ? { label: "Unprotect column", icon: Lock, onSelect: () => applyColumnPatches([{ colId: activeColumn.id, before: { protected: true }, after: { protected: false } }], `unprotect "${activeColumn.label}"`) }
          : { label: "Protect column", icon: Lock, onSelect: () => applyColumnPatches([{ colId: activeColumn.id, before: { protected: activeColumn.protected }, after: { protected: true } }], `protect "${activeColumn.label}"`) }] : []),
        { separator: true },
        { label: "Pivot table…", icon: Table2, onSelect: () => setPivotOpen(true) },
        ...(aiEntitled ? [{ label: "Ask your data…", icon: Sparkles, onSelect: () => setAskOpen(true) }] : []),
        { separator: true },
        { label: "Trash…", icon: Trash2, onSelect: () => setTrashOpen(true) },
      ],
    },
  ];

  const tbButton = (key: "zoom" | "numfmt" | "text" | "fill" | "more" | "link") => (el: HTMLButtonElement | null) => { tbAnchor.current[key] = el; };
  const tbAnchorRef = (key: string) => ({ current: tbAnchor.current[key] ?? null });
  // A public link only opens while the workspace allows public links; a
  // stale isPublic under an Off workspace offers no glyph and no embed code.
  const linkIsLive = !!table.isPublic && table.publicLinksAllowed !== false;
  const autosaveStatus = saveFailed ? "error" : savingCols ? "saving" : lastSavedAt ? "saved" : "idle";
  const moveOpen = sheetMoreOpen;

  return (
    // h-full, not flex-1: the shell's <main> is a block scroller, not a flex
    // column, so flex-1 is inert there and the root would grow to the whole
    // grid's height (32,000px at 1,000 rows). Then <main> scrolls instead of
    // the grid: the chrome and the column letters scroll away and every row
    // mounts. A definite height (HEAD's .dtbl height:100%) keeps SheetGrid's
    // own scroller bounded. Print unlocks it again (os.css print block).
    <div className={cn("sheet-root os-chrome flex h-full min-h-0 flex-col bg-app", fullScreen && "sheet-root--full")}>
      {/* In Work the WorkPlacementProvider declares the crumb (Work > Space > table). */}
      {!inWork ? <Breadcrumb items={[...(spaceBack && spaceBack.fallbackHref !== "/tables" ? [{ label: spaceBack.label, href: spaceBack.fallbackHref }] : []), { label: tableName }]} /> : null}

      {/* ── Title row 40 (SheetChrome title row; hidden in full screen) ── */}
      {!fullScreen ? (
        <header className="flex h-10 shrink-0 items-center gap-2 px-4 print:hidden">
          <BackButton
            fallbackHref={inWork && place ? place.back.href : spaceBack?.fallbackHref ?? "/tables"}
            label={inWork && place ? place.back.label : spaceBack?.label ?? "Tables"}
          />
          <EntityTile size="md" name={tableName} fallback="table" {...NEUTRAL_TILE} />
          <input
            ref={titleInputRef}
            className="h-8 min-w-[120px] max-w-[420px] flex-1 truncate rounded-md border border-transparent bg-transparent px-1.5 text-title font-semibold text-ink hover:border-line focus:border-brand focus:outline-none"
            type="text"
            value={table.name}
            onChange={(e) => setTable({ ...table, name: e.target.value })}
            onKeyDown={(e) => {
              if (e.key === "Enter") (e.target as HTMLInputElement).blur();
              else if (e.key === "Escape") {
                // Esc reverts to the name the field held when it took focus.
                e.preventDefault();
                const before = titleBeforeEditRef.current;
                if (before !== null) setTable((prev) => (prev ? { ...prev, name: before } : prev));
                titleBeforeEditRef.current = null;
                (e.target as HTMLInputElement).blur();
              }
            }}
            onFocus={(e) => { titleBeforeEditRef.current = e.target.value; }}
            onBlur={(e) => {
              if (titleBeforeEditRef.current === null) return; // Esc already reverted
              const name = e.target.value.trim() || UNTITLED_TABLE_NAME;
              if (name !== e.target.value) setTable((prev) => (prev ? { ...prev, name } : prev));
              // An untouched focus/blur costs nothing: no PATCH, no refetch.
              if (name === titleBeforeEditRef.current) return;
              // The sidebar and /tables both list this name: tell them.
              void patchTable({ name }).then((ok) => { if (ok) notifyTablesChanged(); else toast("Couldn't rename the table", { tone: "danger" }); });
            }}
            placeholder={UNTITLED_TABLE_NAME}
            aria-label="Table name"
          />
          <AutosaveIndicator
            status={autosaveStatus}
            lastSavedAt={lastSavedAt}
            onRetry={saveFailed ? () => void retryFailedWrites() : undefined}
          />
          {tableId ? <TableFavoriteButton tableId={tableId} /> : null}
          <span className="flex-1" />
          <CoPresenceChip others={presence} />
          {linkIsLive ? (
            <span className="inline-flex text-ink-2" title="Public link is on"><Globe className="h-3 w-3" strokeWidth={1.5} aria-label="Public link is on" /></span>
          ) : null}
          {/* Under 900px Share moves into the title-row "..." (its Share… row). */}
          <ShareOrRoleChip role={shareRole} onOpen={(mode) => setShareMode(mode)} className="max-[900px]:hidden" />
          <button
            ref={sheetMoreRef}
            type="button"
            onClick={() => { setSheetMenuMode("menu"); setSheetMoreOpen((o) => !o); }}
            aria-label="Table actions"
            aria-haspopup="menu"
            aria-expanded={sheetMoreOpen}
            className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-line-strong text-ink-2 hover:bg-hover hover:text-ink"
          >
            <MoreHorizontal className="h-4 w-4" />
          </button>
        </header>
      ) : null}
      {moveOpen ? (
        <MorePortal anchorRef={sheetMoreRef} width={280} open placement="below" onClose={() => setSheetMoreOpen(false)}>
          <TableRowMenu
            key={sheetMenuMode}
            table={{ id: table.id, name: table.name, spaceId: table.spaceId ?? null, spaceSlug: place?.spaceSlug ?? null, spaceName: spaceBack && spaceBack.fallbackHref !== "/tables" ? spaceBack.label : null, isPublic: !!table.isPublic, canManage: !!table.canManage, publicLinksAllowed: table.publicLinksAllowed !== false }}
            context="sheet"
            initialMode={sheetMenuMode}
            onClose={() => setSheetMoreOpen(false)}
            onShare={() => setShareMode(table.canManage ? "share" : "who")}
            onRenameInline={() => { titleInputRef.current?.focus(); titleInputRef.current?.select(); }}
            // A Move re-reads the table; in Work the route refreshes too, so
            // the gate re-places it (new crumb, new tree branch) while the
            // sheet, and any Not saved cell, stays mounted.
            onChanged={(kind) => { if (kind === "moved") { void load(); if (inWork) router.refresh(); } }}
          />
        </MorePortal>
      ) : null}

      {/* ── Menu bar 36 (SheetMenuBar; one Menu button under 900px) ── */}
      {!fullScreen ? <SheetMenuBar menus={menus} className="print:hidden" onAfterSelect={refocusGridIfLost} /> : null}

      {/* ── Toolbar 44: every control is traced to a handler ── */}
      {/* The toolbar is its own size container: its width is the sheet's,
          not the window's, so with the rail and a 260px sidebar a 1280px
          window leaves it 952px, and the last button (Display and About)
          slid past the edge with no visible scrollbar. It sheds groups the
          Format menu also carries, widest last: alignment under 980px, the
          Copy link label under 870px, text styles and colours under 800px.
          The hidden-scrollbar overflow stays as the last fallback. */}
      <div className="@container flex h-11 shrink-0 items-center gap-0.5 overflow-x-auto px-4 os-no-scrollbar print:hidden" role="toolbar" aria-label="Table toolbar">
        <button type="button" className={TB} onClick={() => void runUndo()} disabled={!undoStack.canUndo() || undoStack.busy()} title={undoStack.canUndo() ? `Undo ${undoStack.peekUndoLabel()}` : "Nothing to undo"} aria-label="Undo"><Undo2 /></button>
        <button type="button" className={TB} onClick={() => void runRedo()} disabled={!undoStack.canRedo() || undoStack.busy()} title={undoStack.canRedo() ? `Redo ${undoStack.peekRedoLabel()}` : "Nothing to redo"} aria-label="Redo"><Redo2 /></button>
        <span className={TB_SEP} aria-hidden />
        <button ref={tbButton("zoom")} type="button" className={cn(TB, "px-2 tabular-nums")} onClick={() => setToolbarMenu((m) => (m === "zoom" ? null : "zoom"))} aria-haspopup="menu" aria-expanded={toolbarMenu === "zoom"} title="Zoom" aria-label={`Zoom ${zoom}%`}>
          {zoom}%<ChevronDown className="!h-3 !w-3" />
        </button>
        <span className={cn(TB_SEP, "max-[900px]:hidden")} aria-hidden />
        {/* Number formats: per cell on open columns, per column on typed ones. */}
        <button type="button" className={TB} onClick={() => applyKindToSelection("currency")} title="Format as currency" aria-label="Format as currency" aria-pressed={activeKind === "currency"}><DollarSign /></button>
        <button type="button" className={TB} onClick={() => applyKindToSelection("percent")} title="Format as percent" aria-label="Format as percent" aria-pressed={activeKind === "percent"}><Percent /></button>
        <button type="button" className={TB} onClick={() => stepColumnDecimals(-1)} title={stepTitle("Decrease decimal places", -1)} aria-label="Decrease decimal places">.0</button>
        <button type="button" className={TB} onClick={() => stepColumnDecimals(1)} title={stepTitle("Increase decimal places", 1)} aria-label="Increase decimal places">.00</button>
        <button ref={tbButton("numfmt")} type="button" className={TB} onClick={() => setToolbarMenu((m) => (m === "numfmt" ? null : "numfmt"))} aria-haspopup="menu" aria-expanded={toolbarMenu === "numfmt"} title="Number format" aria-label="Number format">
          123<ChevronDown className="!h-3 !w-3" />
        </button>
        <span className={cn(TB_SEP, "max-[900px]:hidden")} aria-hidden />
        {/* Per-cell text styles: B I U S, colours, align. They light from the
            ACTIVE cell's stored style; each action is one undo across the
            range. Mid-stream they wait for the rows (a style write is a
            read-modify-write of rows the stream may not have delivered). */}
        <span className="contents max-[900px]:hidden @max-[800px]:hidden">
          <button type="button" className={TB} onClick={() => toggleStyleFlag("b")} disabled={fmtDisabled} title={fmtDisabled ? FMT_STREAM_TITLE : "Bold (⌘B)"} aria-label="Bold" aria-pressed={!!activeStyle?.b}><Bold /></button>
          <button type="button" className={TB} onClick={() => toggleStyleFlag("i")} disabled={fmtDisabled} title={fmtDisabled ? FMT_STREAM_TITLE : "Italic (⌘I)"} aria-label="Italic" aria-pressed={!!activeStyle?.i}><Italic /></button>
          <button type="button" className={TB} onClick={() => toggleStyleFlag("u")} disabled={fmtDisabled} title={fmtDisabled ? FMT_STREAM_TITLE : "Underline (⌘U)"} aria-label="Underline" aria-pressed={!!activeStyle?.u}><Underline /></button>
          <button type="button" className={TB} onClick={() => toggleStyleFlag("s")} disabled={fmtDisabled} title={fmtDisabled ? FMT_STREAM_TITLE : "Strikethrough"} aria-label="Strikethrough" aria-pressed={!!activeStyle?.s}><Strikethrough /></button>
          <button ref={tbButton("text")} type="button" className={cn(TB, "flex-col gap-0")} onClick={() => setToolbarMenu((m) => (m === "text" ? null : "text"))} disabled={fmtDisabled} title={fmtDisabled ? FMT_STREAM_TITLE : "Text colour"} aria-label="Text colour" aria-haspopup="menu" aria-expanded={toolbarMenu === "text"}>
            <Baseline /><span className="-mt-0.5 h-[3px] w-4 rounded-sm" style={{ background: activeStyle?.c ?? "transparent" }} aria-hidden />
          </button>
          <button ref={tbButton("fill")} type="button" className={cn(TB, "flex-col gap-0")} onClick={() => setToolbarMenu((m) => (m === "fill" ? null : "fill"))} disabled={fmtDisabled} title={fmtDisabled ? FMT_STREAM_TITLE : "Fill colour"} aria-label="Fill colour" aria-haspopup="menu" aria-expanded={toolbarMenu === "fill"}>
            <PaintBucket /><span className="-mt-0.5 h-[3px] w-4 rounded-sm" style={{ background: activeStyle?.bg ?? "transparent" }} aria-hidden />
          </button>
          <span className="contents @max-[980px]:hidden">
          <span className={TB_SEP} aria-hidden />
          <button type="button" className={TB} onClick={() => formatSelection("align left", { a: "l" })} disabled={fmtDisabled} title={fmtDisabled ? FMT_STREAM_TITLE : "Align left"} aria-label="Align left" aria-pressed={activeStyle?.a === "l"}><TextAlignStart /></button>
          <button type="button" className={TB} onClick={() => formatSelection("align center", { a: "c" })} disabled={fmtDisabled} title={fmtDisabled ? FMT_STREAM_TITLE : "Align centre"} aria-label="Align centre" aria-pressed={activeStyle?.a === "c"}><TextAlignCenter /></button>
          <button type="button" className={TB} onClick={() => formatSelection("align right", { a: "r" })} disabled={fmtDisabled} title={fmtDisabled ? FMT_STREAM_TITLE : "Align right"} aria-label="Align right" aria-pressed={activeStyle?.a === "r"}><TextAlignEnd /></button>
          </span>
          <span className={TB_SEP} aria-hidden />
        </span>
        <button
          type="button"
          onClick={() => setFilterOpen((o) => !o)}
          aria-pressed={filterOpen || !!search || filterActive}
          title="Filter rows"
          className={cn(TB, "gap-1.5 px-2.5")}
        >
          <Filter />
          <span>{filterCount > 0 ? `Filter · ${filterCount}` : "Filter"}</span>
        </button>
        <button type="button" className={cn(TB, "max-[900px]:hidden")} onClick={insertSumSeed} title="Insert SUM in the active cell" aria-label="Insert SUM"><Sigma /></button>
        <span className="min-w-2 flex-1" aria-hidden />
        {/* Right end: Copy link, fused to Copy embed code when a public link is on. */}
        {fullScreen ? (
          // Full screen hides the menu bar (its View row is the usual way
          // out), so the toolbar carries a visible exit for touch and for
          // anyone who does not know Escape or the shortcut.
          <button type="button" onClick={() => setFullScreen(false)} className="me-1 inline-flex h-9 shrink-0 items-center gap-1.5 rounded-md px-2.5 text-sm font-medium text-ink-2 hover:bg-hover hover:text-ink" title="Exit full screen (Esc)">
            <Minimize2 className="h-4 w-4" strokeWidth={1.5} aria-hidden /> Exit full screen
          </button>
        ) : null}
        <span className="inline-flex h-9 shrink-0 items-stretch overflow-hidden rounded-md border border-line-strong">
          <button type="button" onClick={copySheetLink} className="inline-flex items-center gap-1.5 px-2.5 text-sm font-medium text-ink hover:bg-hover" title="Copy a link to this table" aria-label="Copy link">
            <Link2 className="h-4 w-4" strokeWidth={1.5} aria-hidden /> <span className="@max-[870px]:hidden">Copy link</span>
          </button>
          {linkIsLive ? (
            <button ref={tbButton("link")} type="button" onClick={() => setToolbarMenu((m) => (m === "link" ? null : "link"))} className="inline-flex w-7 items-center justify-center border-s border-line-strong text-ink-2 hover:bg-hover" aria-label="More link options" aria-haspopup="menu" aria-expanded={toolbarMenu === "link"}>
              <ChevronDown className="h-3.5 w-3.5" />
            </button>
          ) : null}
        </span>
        <button ref={tbButton("more")} type="button" onClick={() => setToolbarMenu((m) => (m === "more" ? null : "more"))} className="ms-1 inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-line-strong text-ink-2 hover:bg-hover hover:text-ink" aria-label="Display and About" aria-haspopup="menu" aria-expanded={toolbarMenu === "more"}>
          <MoreHorizontal className="h-4 w-4" />
        </button>
      </div>

      {toolbarMenu ? (
        <MorePortal anchorRef={tbAnchorRef(toolbarMenu)} width={toolbarMenu === "text" || toolbarMenu === "fill" ? 232 : 240} open placement="below" onClose={() => setToolbarMenu(null)}>
          {toolbarMenu === "zoom" ? (
            <MenuList aria-label="Zoom">
              {ZOOM_LEVELS.map((z) => <MenuItem key={z} label={`${z}%`} selected={zoom === z} onClick={() => { changeZoom(z); setToolbarMenu(null); }} />)}
            </MenuList>
          ) : toolbarMenu === "numfmt" ? (
            <MenuList aria-label="Number format">
              {NUMBER_FORMAT_CHOICES.map((t) => <MenuItem key={t.kind} label={t.label} selected={activeKind === t.kind} role="menuitemradio" onClick={() => { applyKindToSelection(t.kind); setToolbarMenu(null); }} />)}
            </MenuList>
          ) : toolbarMenu === "text" || toolbarMenu === "fill" ? (
            <MenuList aria-label={toolbarMenu === "text" ? "Text colours" : "Fill colours"} className="p-2">
              <div className="grid grid-cols-5 gap-1.5 p-1">
                {(toolbarMenu === "text" ? TEXT_SWATCHES : FILL_SWATCHES).map((sw) => {
                  const on = (toolbarMenu === "text" ? activeStyle?.c : activeStyle?.bg)?.toUpperCase() === sw.hex;
                  return (
                    <button
                      key={sw.hex}
                      type="button"
                      className={cn("h-7 w-7 rounded-md border border-line", on && "ring-2 ring-brand ring-offset-1")}
                      style={{ background: sw.hex }}
                      title={sw.name}
                      aria-label={`${toolbarMenu === "text" ? "Text colour" : "Fill colour"} ${sw.name}`}
                      aria-pressed={on}
                      onClick={() => {
                        if (toolbarMenu === "text") formatSelection(`text color ${sw.name.toLowerCase()}`, { c: sw.hex });
                        else formatSelection(`fill ${sw.name.toLowerCase()}`, { bg: sw.hex });
                        setToolbarMenu(null);
                      }}
                    />
                  );
                })}
              </div>
              <MenuItem icon={X} label="Reset" onClick={() => { if (toolbarMenu === "text") formatSelection("reset text color", { c: undefined }); else formatSelection("reset fill", { bg: undefined }); setToolbarMenu(null); }} />
            </MenuList>
          ) : toolbarMenu === "link" ? (
            <MenuList aria-label="Link options">
              <MenuItem icon={Code2} label="Copy embed code" onClick={() => { copyText(embedSnippet("table", table.id, tableName), "Embed code copied"); setToolbarMenu(null); }} />
            </MenuList>
          ) : (
            <MenuList aria-label="Display and About">
              <MenuItem icon={Grid3x3} label="Gridlines" selected={showGridlines} role="menuitemcheckbox" onClick={() => setViewPref("gridlines", !showGridlines)} />
              <MenuItem icon={PanelTop} label="Formula bar" selected={showFormulaBar} role="menuitemcheckbox" onClick={() => setViewPref("formulaBar", !showFormulaBar)} />
              <MenuItem icon={Rows3} label="Row height…" onClick={() => { setToolbarMenu(null); void promptRowHeight(); }} />
              <MenuItem icon={fullScreen ? Minimize2 : Maximize2} label={fullScreen ? "Exit full screen" : "Full screen"} shortcut="⇧⌘F" onClick={() => { setToolbarMenu(null); setFullScreen((v) => !v); }} />
              <MenuSeparator />
              <MenuItem icon={Info} label="About…" onClick={() => { setToolbarMenu(null); setAboutOpen(true); }} />
            </MenuList>
          )}
        </MorePortal>
      ) : null}

      {/* ── Formula bar 36 (View > Formula bar hides it) ── */}
      {table.columns.length > 0 && showFormulaBar ? (
        <div className="shrink-0 px-4 print:hidden">
          <FormulaBar
            cell={barCell}
            onCommit={(raw) => {
              if (!activeCell) return;
              setReadOnlyNote(null);
              commitCellText(activeCell.rowId, activeCell.colId, raw);
              // Hand the keyboard back to the grid, so Enter-commit flows
              // straight into navigation like an in-cell commit does.
              gridWrapElRef.current?.querySelector<HTMLElement>('[role="grid"]')?.focus({ preventScroll: true });
            }}
            onReadOnlyEdit={(reason) => setReadOnlyNote(reason)}
          />
          {readOnlyNote && barCell?.readOnly ? <p className="m-0 px-1 pt-1 text-sm text-danger-text" role="status">{readOnlyNote}</p> : null}
        </div>
      ) : null}

      {/* ── Body: the Filter panel left of the card, then the card ── */}
      <div className="flex min-h-0 flex-1 gap-4 px-4 pb-3 pt-2">
        <FilterPanel
          open={filterOpen}
          onClose={() => setFilterOpen(false)}
          objects="rows"
          activeCount={filterCount}
          onClearAll={() => { setSearch(""); persistFilters([]); }}
          search={{ value: search, onChange: setSearch, placeholder: "Search rows" }}
        >
          <FilterGroup label="Columns">
            {table.columns.map((c, ci) => {
              const current = filters.find((f) => f.colId === c.id) ?? null;
              const name = columnDisplayName(c.label, ci);
              return (
                <FilterRow
                  key={c.id}
                  label={name}
                  checked={!!current}
                  onCheckedChange={(next) => setColumnFilter(c.id, next ? emptyFilterFor(c.id, c.type) : null)}
                >
                  {current ? (
                    <ColumnFilterControl
                      name={name}
                      column={c}
                      filter={current}
                      onChange={(f) => setColumnFilter(c.id, f)}
                    />
                  ) : null}
                </FilterRow>
              );
            })}
          </FilterGroup>
          {search || filterActive ? <p className="m-0 px-1 pt-2 text-sm text-ink-2">{filteredRows.length.toLocaleString()} of {rows.length.toLocaleString()} rows</p> : null}
        </FilterPanel>

        <div className={cn("sheet-card relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-lg border border-line bg-[var(--os-surface)]", !showGridlines && "sheet-card--nogrid")}>
          {table.columns.length === 0 ? (
            /* A columnless table still opens as a spreadsheet: the quiet
               template and ONE text link (principle 11, spec section 2
               "Start sheet ... stays"), which applies the canonical seed.
               Single columns are the header "+" once the grid exists. The
               action says what it does (it adds 26 columns, not one), and
               the copy never says Sheet: the product word is Table. */
            <div className="flex flex-1 items-center justify-center">
              <OsEmptyView context="list" title="This table has no columns yet" hint="Starting it adds columns A to Z and 1,000 blank rows, the same as a new table." action={{ label: "Start the table", onClick: () => void startTable() }} />
            </div>
          ) : (
            <>
              {/* CSS zoom, not transform: zoom reflows layout, so the kernel's
                  virtualizer math (row offsets, viewport height) stays true. */}
              <div ref={attachGridWrap} className="sheet-grid-wrap flex min-h-0 flex-1 flex-col" style={{ zoom: zoom / 100 }}>
                <SheetGrid
                  columns={table.columns.map((c) => ({ id: c.id, label: c.label, width: c.width }))}
                  rowIds={sortedRowIds}
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
                  onHeaderRename={(colId) => setRenamingColId(colId)}
                  // Freeze panes are display-only: the kernel pins the first N
                  // display rows/columns; nothing here reaches the engine.
                  freeze={gridFreeze ?? undefined}
                  isCellEmpty={isCellEmpty}
                  // Per-row heights, answered from the mirror's "$rh". UNDEFINED
                  // while every row is default so the kernel keeps its fast path.
                  rowHeight={kernelRowHeight}
                  rowHeightsVersion={rowHeightsVersion}
                  onRowResize={resizeRowsTo}
                  onRowAutofit={autofitRows}
                  colResizeGuideId={resizingColId}
                  activeRequest={findActiveRequest ?? undefined}
                  // Row moving exists ONLY while display order IS storage order.
                  onRowMove={rowInsertBlocked ? undefined : moveRowByDrag}
                  onGrowRows={growRows}
                  // An empty table is typed into like Sheets' A1 (startEmptyGrid).
                  onEmptyStart={rows.length === 0 && !rowInsertBlocked ? startEmptyGrid : undefined}
                  rowNumberOf={rowNumberOf}
                  onSelectionChange={(sel) => setGridSelection(sel)}
                  onActiveChange={onGridActiveChange}
                  renderHeader={kernelHeader}
                  headerTrailing={
                    <button
                      type="button"
                      onClick={() => void addColumn()}
                      title="Add column"
                      aria-label="Add column"
                      className="inline-flex h-6 w-6 items-center justify-center rounded text-ink-3 hover:bg-hover hover:text-ink"
                    >
                      <Plus style={{ width: 15, height: 15 }} />
                    </button>
                  }
                  readOnlyCols={new Set(table.columns.filter((c) => c.type === "formula" || c.type === "lookup" || c.type === "rollup" || c.protected).map((c) => c.id))}
                />
              </div>
              {/* Find & Replace card (Cmd/Ctrl+F, Cmd/Ctrl+H): floats top-right
                  over the grid, OUTSIDE the grid div on purpose, so its Enter
                  and Escape never reach the kernel. */}
          {findOpen && (
            <div data-sheet-find className="absolute right-[26px] top-[34px] z-30 flex w-80 max-w-[calc(100%-40px)] flex-col gap-1.5 rounded-lg border border-line bg-raised px-2.5 py-2 shadow-[var(--os-shadow-pop)] print:hidden" role="dialog" aria-label="Find and replace">
              <div className="flex items-center gap-1.5">
                <input
                  ref={findInputRef}
                  className={FIND_INPUT}
                  type="text"
                  value={findQuery}
                  placeholder="Find in table"
                  autoFocus
                  onChange={(e) => setFindQueryLive(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") { e.preventDefault(); e.stopPropagation(); findStep(e.shiftKey ? -1 : 1); }
                    else if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); closeFind(); }
                  }}
                />
                {findCounter !== null && <span className="shrink-0 whitespace-nowrap px-0.5 text-xs tabular-nums text-ink-3">{findCounter}</span>}
                <button type="button" className={FIND_BTN} onClick={() => findStep(-1)} disabled={findMatches.length === 0} title="Previous match (Shift+Enter)" aria-label="Previous match"><ChevronUp /></button>
                <button type="button" className={FIND_BTN} onClick={() => findStep(1)} disabled={findMatches.length === 0} title="Next match (Enter)" aria-label="Next match"><ChevronDown /></button>
                <button type="button" className={`${FIND_BTN} ${findShowReplace ? "bg-brand-soft text-brand" : ""}`} onClick={() => setFindShowReplace((v) => !v)} title="More options" aria-label="More options"><MoreVertical /></button>
                <button type="button" className={FIND_BTN} onClick={closeFind} title="Close (Esc)" aria-label="Close find"><X /></button>
              </div>
              {findShowReplace && (
                <div className="flex items-center gap-1.5">
                  <input
                    className={FIND_INPUT}
                    type="text"
                    value={findReplace}
                    placeholder="Replace with"
                    onChange={(e) => setFindReplace(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") { e.preventDefault(); e.stopPropagation(); runReplaceCurrent(); }
                      else if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); closeFind(); }
                    }}
                  />
                  <button type="button" className={FIND_ACTION} onClick={runReplaceCurrent} disabled={findMatches.length === 0}>Replace</button>
                  <button type="button" className={FIND_ACTION} onClick={() => void runReplaceAll()} disabled={findMatches.length === 0}>Replace all</button>
                </div>
              )}
              {findNotice && <div className="text-xs text-ink-3">{findNotice}</div>}
            </div>
          )}
            </>
          )}
          <SheetStatusBar
            rows={rows.length}
            columns={table.columns.length}
            stream={streamProgress}
            stats={statsText}
            lastSavedAt={lastSavedAt}
            saveFailed={saveFailed}
            leading={table.columns.length === 0 ? null : (
              // The corner "+" under the gutter: one undoable block of
              // 1,000 blank rows. It lives in the status bar so it never
              // sits over the last visible row's number.
              <button
                type="button"
                className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-ink-2 hover:bg-hover hover:text-ink disabled:opacity-50 print:hidden"
                onClick={() => void addRowsBlock()}
                disabled={addingRows}
                title="Add 1,000 rows"
                aria-label="Add 1,000 rows"
              >
                {addingRows ? <Dots variant="pending" /> : <Plus className="h-3.5 w-3.5" />}
              </button>
            )}
          />
        </div>
      </div>

      {/* A row that left the display while its menu was open (deleted, or
        * filtered out from another surface) renders no menu, like a dead
        * column's: a move or freeze computed from index -1 would land at
        * the top. */}
      {rowMenu && rowMenuDisplayIdx >= 0 ? (
        <GridRowMenu
          rowId={rowMenu.rowId}
          displayIndex={rowMenuDisplayIdx}
          rowCount={sortedRows.length}
          spanCount={rowMenuSpan ? rowMenuSpan.length : null}
          point={{ x: rowMenu.x, y: rowMenu.y }}
          anchorRef={rowMenuAnchorRef}
          panelRef={rowMenuPanelRef}
          // Insert and move are gated exactly like the gutter drag: a storage
          // slot is only a display slot while nothing reorders the display
          // (sort, filter, search) and the whole table is resident (stream).
          structureBlocked={rowInsertBlocked}
          blockedReason="Clear the sort, filter and search to insert or move rows"
          canFreeze={rowMenuCanFreeze}
          frozenRows={freeze?.rows}
          onClose={() => setRowMenu(null)}
          onOpen={() => setActiveRowId(rowMenu.rowId)}
          onInsert={(where) => insertRowNear(rowMenu.rowId, where)}
          onMove={(dir) => moveRowByDrag(rowMenu.rowId, rowMenuDisplayIdx + dir)}
          onFreeze={() => persistFreeze({ rows: rowMenuDisplayIdx + 1 })}
          onUnfreeze={() => persistFreeze({ rows: undefined })}
          onClear={() => clearRows(rowMenuSpan ?? [rowMenu.rowId])}
          onDelete={() => { if (rowMenuSpan) void bulkDeleteRows(rowMenuSpan); else void deleteRow(rowMenu.rowId); }}
        />
      ) : null}

      {headerMenu ? (() => {
        // Resolve the column at render: a delete can outlive the menu by a
        // frame, and a dead colId must render nothing rather than a menu
        // whose every action would no-op or throw.
        const hc = table.columns.find((c) => c.id === headerMenu.colId);
        if (!hc) return null;
        const colIdx = table.columns.findIndex((c) => c.id === headerMenu.colId);
        const point = { x: headerMenu.x, y: headerMenu.y };
        return (
          <GridHeaderMenu
            column={hc}
            index={colIdx}
            columnCount={table.columns.length}
            letter={columnLetter(colIdx)}
            point={point}
            anchorRef={headerMenuAnchorRef}
            panelRef={headerMenuPanelRef}
            sortActive={!!sortState}
            frozenCols={freeze?.cols}
            onClose={() => setHeaderMenu(null)}
            onRename={() => setRenamingColId(hc.id)}
            onType={() => setTypePicker({ colId: hc.id, top: point.y, left: point.x })}
            // Sorting drives the SAME persisted sortState, written into the
            // first saved view exactly as before.
            onSort={(dir) => persistSort({ colId: hc.id, dir })}
            onClearSort={() => persistSort(null)}
            onInsert={(where) => insertColumnNear(hc.id, where)}
            onMove={(dir) => moveColumnBy(hc.id, dir)}
            onWidth={() => void promptColumnWidth(hc.id)}
            onFreeze={() => persistFreeze({ cols: colIdx + 1 })}
            onUnfreeze={() => persistFreeze({ cols: undefined })}
            onValidation={() => setValidationColId(hc.id)}
            onConditional={() => setRulesColId(hc.id)}
            onEditFormula={() => void editFormula(hc.id)}
            onConfigureRelation={() => setConfigColId(hc.id)}
            onEditOptions={() => setOptionsColId(hc.id)}
            onToggleProtect={() => applyColumnPatches(
              [{ colId: hc.id, before: { protected: hc.protected }, after: { protected: !hc.protected } }],
              hc.protected ? `unprotect "${hc.label}"` : `protect "${hc.label}"`,
            )}
            onClear={() => clearColumn(hc.id)}
            onDelete={() => void deleteColumn(hc.id)}
          />
        );
      })() : null}

      {typePicker ? (() => {
        const col = table.columns.find((c) => c.id === typePicker.colId);
        if (!col) return null;
        return (
          <ColumnTypePicker
            open
            value={col.type}
            anchorPoint={{ top: typePicker.top, left: typePicker.left }}
            onClose={() => setTypePicker(null)}
            onChange={(t) => { setTypePicker(null); void chooseColumnType(col.id, t); }}
          />
        );
      })() : null}

      {typeChange ? (() => {
        const col = table.columns.find((c) => c.id === typeChange.colId);
        if (!col) return null;
        const idx = table.columns.indexOf(col);
        const tc = typeChange;
        return (
          <ColumnTypeChangeDialog
            open
            columnName={columnDisplayName(col.label, idx)}
            fromLabel={columnTypeLabel(col.type)}
            toLabel={columnTypeLabel(tc.toType)}
            cells={tc.cells}
            onCancel={() => setTypeChange(null)}
            onChange={() => { setTypeChange(null); void applyColumnType(tc.colId, tc.toType); }}
            onKeepAndChange={() => { setTypeChange(null); void keepOldValuesThenChange(tc.colId, tc.toType); }}
          />
        );
      })() : null}

      {optionsColId ? (() => {
        const col = table.columns.find((c) => c.id === optionsColId);
        if (!col) return null;
        return (
          <SelectOptionsDialog
            open
            columnName={columnDisplayName(col.label, table.columns.indexOf(col))}
            initial={col.options ?? []}
            onCancel={() => setOptionsColId(null)}
            onSave={(options) => {
              setOptionsColId(null);
              applyColumnPatches([{ colId: col.id, before: { options: col.options }, after: { options } }], "edit options");
            }}
          />
        );
      })() : null}

      {rulesColId ? (() => {
        const colIdx = table.columns.findIndex((c) => c.id === rulesColId);
        const col = table.columns[colIdx];
        if (!col) return null;
        const colName = columnDisplayName(col.label, colIdx);
        return (
          <ConditionalRulesDialog
            column={col}
            columnName={colName}
            onClose={() => setRulesColId(null)}
            onSave={({ rules, condFormat }) => {
              applyColumnPatches(
                [{ colId: col.id, before: { rules: col.rules, condFormat: col.condFormat }, after: { rules, condFormat } }],
                `conditional formatting on "${colName}"`,
              );
              setRulesColId(null);
            }}
          />
        );
      })() : null}

      {validationColId ? (() => {
        const colIdx = table.columns.findIndex((c) => c.id === validationColId);
        const col = table.columns[colIdx];
        if (!col) return null;
        const colName = columnDisplayName(col.label, colIdx);
        return (
          <DataValidationDialog
            column={col}
            columnName={colName}
            onClose={() => setValidationColId(null)}
            onSave={(validation) => {
              applyColumnPatches([{ colId: col.id, before: { validation: col.validation }, after: { validation } }], `data validation on "${colName}"`);
              setValidationColId(null);
            }}
          />
        );
      })() : null}

      <RowDetailDrawer
        table={table}
        row={activeRow ?? null}
        rowNumber={activeRow ? rows.findIndex((r) => r.id === activeRow.id) + 1 : 0}
        onClose={() => {
          const closing = activeRowId;
          setActiveRowId(null);
          // Focus goes back to the row's gutter number (spec: Back and close).
          if (closing) window.setTimeout(() => gridWrapElRef.current?.querySelector<HTMLElement>(`[data-gutter-row="${CSS.escape(closing)}"]`)?.focus(), 0);
        }}
        onChange={(values) => {
          if (!activeRow) return;
          // "=..." typed into a drawer field becomes a stored formula through
          // the same path as the grid; an OPEN cell's text types on entry
          // (value + nf, the grid editor's rule); everything else is a literal.
          const literals: Record<string, unknown> = {};
          for (const [k, v] of Object.entries(values)) {
            const col = table.columns.find((c) => c.id === k);
            if (typeof v === "string" && v.trimStart().startsWith("=")) commitCellText(activeRow.id, k, v);
            else if (col && isOpenColumnType(col.type) && typeof v === "string") Object.assign(literals, openEntryValues(activeRow.id, k, v));
            else literals[k] = v;
          }
          if (Object.keys(literals).length > 0) void patchRow(activeRow.id, literals);
        }}
        formulaDisplay={(colId) => (activeRow ? (streamProgress ? "" : String(engineHost.display(colId, activeRow.id) ?? "")) : "")}
        formulaSource={(colId) => (activeRow && engineHost.isFormulaCell(colId, activeRow.id) ? String(engineHost.cellSource(colId, activeRow.id) ?? "") : "")}
        onCopyLink={() => { if (activeRow) copyText(`${copyObjectLink("table", table.id)}?row=${activeRow.id}`, "Link copied"); }}
        onDelete={() => { if (!activeRow) return; const id = activeRow.id; setActiveRowId(null); void deleteRow(id); }}
      />

      {configColumn && (
        <RelationConfigModal
          column={configColumn}
          tableColumns={table.columns}
          allTables={allTables.filter((t) => t.id !== tableId)}
          columnsByTable={columnsByTable}
          onSave={(patch) => {
            // A type chosen in the picker lands WITH its configuration.
            const typed = pendingRelType?.colId === configColumn.id ? { type: pendingRelType.type as ColType } : {};
            setPendingRelType(null);
            saveColumnConfig(configColumn.id, { ...(patch as Partial<Column>), ...typed });
          }}
          onClose={() => { setPendingRelType(null); setConfigColId(null); }}
        />
      )}

      <TableTrashDialog
        open={trashOpen}
        onOpenChange={setTrashOpen}
        tableId={tableId}
        columns={table.columns.map((c, i) => ({ id: c.id, label: columnDisplayName(c.label, i) }))}
        onChanged={() => { void load(); }}
      />

      {/* Ask your data exists only where the AI hub is entitled (spec: the
          row is absent, never disabled, otherwise). Headers are names with
          the letter as the fallback, so a sheet-born table still reads. */}
      {aiEntitled ? <AskDataDialog
        open={askOpen}
        onOpenChange={setAskOpen}
        tableId={tableId}
        columns={table.columns.map((c, i) => ({ id: c.id, label: columnDisplayName(c.label, i) }))}
        buildRows={() =>
          (rows ?? []).map((r) =>
            table.columns.map((c) => {
              const v = r.values[c.id];
              return c.type === "formula" || isFormulaCell(v) ? engineHost.value(c.id, r.id) : v;
            }),
          )
        }
      /> : null}

      <PivotDialog
        open={pivotOpen}
        onOpenChange={setPivotOpen}
        initialConfig={pivotInitial}
        onConfigChange={savePivotConfig}
        onInsertAsTable={insertPivotAsTable}
        columns={table.columns.map((c, i) => ({ id: c.id, label: columnDisplayName(c.label, i) }))}
        buildRecords={() =>
          (rows ?? []).map((r) => {
            const rec: Record<string, unknown> = {};
            for (const c of table.columns) {
              const v = r.values[c.id];
              rec[c.id] = c.type === "formula" || isFormulaCell(v) ? engineHost.value(c.id, r.id) : v;
            }
            return rec;
          })
        }
      />

      <FunctionReferenceDrawer
        open={functionsOpen}
        onClose={() => setFunctionsOpen(false)}
        canInsert
        onPick={(fn) => {
          setFunctionsOpen(false);
          // After the drawer has closed and handed focus back, so the seed
          // lands in the grid's editor rather than on the closing drawer.
          window.setTimeout(() => insertFunctionSeed(fn), 0);
        }}
      />
      <NamedRangesDialog
        open={namedRangesOpen}
        onOpenChange={setNamedRangesOpen}
        host={engineHost}
        onChanged={(ranges) => {
          // The host has already re-derived + recomputed; repaint, then mirror
          // the definitions to state + persist them to DataTable.settings.
          bumpEngine();
          const cur = tableRef.current;
          const nextSettings = { ...(cur?.settings ?? {}), namedRanges: ranges };
          if (cur) tableRef.current = { ...cur, settings: nextSettings };
          setTable((prev) => (prev ? { ...prev, settings: nextSettings } : prev));
          void patchTable({ settings: nextSettings });
        }}
      />

      <ObjectShareDialog
        open={shareMode !== null}
        mode={shareMode ?? "who"}
        onClose={() => setShareMode(null)}
        object={{
          kind: "table",
          id: table.id,
          name: tableName,
          isPublic: !!table.isPublic,
          canManage: !!table.canManage,
          publicLinksAllowed: table.publicLinksAllowed !== false,
          anchorName: spaceBack && spaceBack.fallbackHref !== "/tables" ? spaceBack.label : null,
        }}
        onPublicChange={(isPublic) => { setTable((prev) => (prev ? { ...prev, isPublic } : prev)); notifyTablesChanged(); }}
      />
      <TableAboutDialog
        open={aboutOpen}
        onClose={() => setAboutOpen(false)}
        name={table.name}
        description={table.description ?? null}
        canEdit
        onSave={async (next) => {
          const ok = await patchTable({ name: next.name, description: next.description });
          if (ok) { setTable((prev) => (prev ? { ...prev, name: next.name, description: next.description } : prev)); notifyTablesChanged(); }
          return ok;
        }}
      />
      <CsvImportDialog
        open={csvOpen}
        onClose={() => setCsvOpen(false)}
        table={{ id: table.id, name: tableName, columns: table.columns.map((c) => ({ id: c.id, label: c.label ?? "" })) }}
        spaceId={table.spaceId ?? null}
        onDone={({ tableId: written, created }) => { if (created) router.push(objectHrefNow("table", written)); else void load(); }}
      />
    </div>
  );
}

/** One ticked column's value control in the Filter panel (spec-tables-forms
 *  section 2 /tables/[id]): the Picker (the one popover list, multi) for
 *  select types, a from/to range for numbers and dates (the one DateField
 *  for dates, never a native date input), a debounced contains for text. */
function ColumnFilterControl({ name, column, filter, onChange }: {
  name: string;
  column: Column;
  filter: SheetColumnFilter;
  onChange: (next: SheetColumnFilter) => void;
}) {
  const [pickOpen, setPickOpen] = useState(false);
  if (filter.kind === "value") {
    const options = column.options ?? [];
    const summary = filter.values.length === 0
      ? "Any value"
      : filter.values.length === 1 ? filter.values[0] : `${filter.values.length} values`;
    return (
      <span className="relative block">
        <button
          type="button"
          onClick={() => setPickOpen((o) => !o)}
          aria-haspopup="listbox"
          aria-expanded={pickOpen}
          aria-label={`Values for ${name}`}
          className="flex h-8 w-full items-center gap-1 rounded-md border border-line-strong bg-raised px-2 text-left text-sm text-ink hover:bg-hover"
        >
          <span className="min-w-0 flex-1 truncate">{summary}</span>
          <ChevronDown className="h-3.5 w-3.5 shrink-0 text-ink-2" aria-hidden />
        </button>
        <Picker
          open={pickOpen}
          onClose={() => setPickOpen(false)}
          sections={[{ options: options.map((o) => ({ value: o, label: o })) }]}
          selected={filter.values}
          multi
          onSelect={(v) => onChange({
            ...filter,
            values: filter.values.includes(v) ? filter.values.filter((x) => x !== v) : [...filter.values, v],
          })}
          emptyLabel="This column has no options yet"
          ariaLabel={`Values for ${name}`}
          width={240}
        />
      </span>
    );
  }
  if (filter.kind === "range") {
    if (isDateFilterType(column.type)) {
      return (
        <div className="flex flex-col gap-1.5">
          <DateField size="sm" value={filter.min ?? null} placeholder="From" ariaLabel={`${name} from`} onChange={(v) => onChange({ ...filter, min: v ?? undefined })} />
          <DateField size="sm" value={filter.max ?? null} placeholder="To" ariaLabel={`${name} to`} onChange={(v) => onChange({ ...filter, max: v ?? undefined })} />
        </div>
      );
    }
    return (
      <div className="flex items-center gap-1.5">
        <DebouncedContains label={`${name} from`} placeholder="Min" inputMode="decimal" initial={filter.min ?? ""} onCommit={(v) => onChange({ ...filter, min: v || undefined })} />
        <span className="text-sm text-ink-2" aria-hidden>to</span>
        <DebouncedContains label={`${name} to`} placeholder="Max" inputMode="decimal" initial={filter.max ?? ""} onCommit={(v) => onChange({ ...filter, max: v || undefined })} />
      </div>
    );
  }
  return (
    <DebouncedContains
      label={`${name} contains`}
      initial={filter.value}
      onCommit={(v) => onChange({ ...filter, value: v })}
    />
  );
}

/** The Filter panel's "contains" input: typing filters after a 350ms pause,
 *  so the saved filter (views[0], a table PATCH) is written once per pause
 *  rather than once per keystroke. */
function DebouncedContains({ label, initial, onCommit, placeholder = "Contains", inputMode }: {
  label: string; initial: string; onCommit: (v: string) => void; placeholder?: string; inputMode?: "decimal";
}) {
  const [draft, setDraft] = useState(initial);
  const commitRef = useRef(onCommit);
  useEffect(() => { commitRef.current = onCommit; });
  useEffect(() => {
    if (draft === initial) return;
    const t = setTimeout(() => commitRef.current(draft), 350);
    return () => clearTimeout(t);
  }, [draft, initial]);
  return (
    <input
      type="search"
      aria-label={label}
      placeholder={placeholder}
      inputMode={inputMode}
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      className="h-8 w-full min-w-0 rounded-md border border-line-strong bg-raised px-2 text-sm text-ink placeholder:text-ink-3"
    />
  );
}

/** The row detail drawer (spec-tables-forms section 2 /tables/[id]): 520
 *  wide on the shared Drawer, at ?row=<id> so Copy link works; Esc and the
 *  close button remove the param and return focus to the row's gutter. One
 *  36px label and value row per column, the label the column NAME with the
 *  letter as the fallback, the value the column's own editor. Formula cells
 *  are read-only: the computed value, the source beneath. No Expand: a row
 *  has no page. */
function RowDetailDrawer({ table, row, rowNumber, onClose, onChange, formulaDisplay, formulaSource, onCopyLink, onDelete }: {
  table: ApiTable;
  row: ApiRow | null;
  rowNumber: number;
  onClose: () => void;
  onChange: (values: Record<string, unknown>) => void;
  formulaDisplay: (colId: string) => string;
  formulaSource: (colId: string) => string;
  onCopyLink: () => void;
  onDelete: () => void;
}) {
  const open = !!row;
  return (
    <Drawer
      open={open}
      onClose={onClose}
      ariaLabel={row ? `Row ${rowNumber}` : "Row"}
      layerId="table-row-drawer"
      header={
        <>
          <span className="min-w-0 flex-1 truncate text-sm text-ink-2">
            {table.name || UNTITLED_TABLE_NAME} <span aria-hidden>›</span> <span className="text-ink">Row {rowNumber}</span>
          </span>
          <button type="button" onClick={onCopyLink} className="inline-flex h-7 w-7 items-center justify-center rounded-md text-ink-2 hover:bg-hover hover:text-ink" aria-label="Copy link to this row" title="Copy link">
            <Link2 className="h-4 w-4" strokeWidth={1.5} />
          </button>
          <button type="button" onClick={onClose} className="inline-flex h-7 w-7 items-center justify-center rounded-md text-ink-2 hover:bg-hover hover:text-ink" aria-label="Close" title="Close (Esc)">
            <X className="h-4 w-4" strokeWidth={1.5} />
          </button>
        </>
      }
      footer={row ? (
        <div className="flex items-center px-4 py-2">
          <button type="button" onClick={onDelete} className="inline-flex h-8 items-center gap-1.5 rounded-md px-2 text-sm font-medium text-danger-text hover:bg-hover">
            <Trash2 className="h-4 w-4" strokeWidth={1.5} aria-hidden /> Delete row
          </button>
        </div>
      ) : null}
    >
      {row ? (
        <div className="flex flex-col px-4 py-2">
          {table.columns.map((c, ci) => {
            const computed = isFormulaCell(row.values[c.id]) || c.type === "formula" || c.type === "lookup" || c.type === "rollup";
            return (
              <div key={c.id} className="flex min-h-9 items-start gap-3 border-b border-line-soft py-1.5">
                <span className="w-36 shrink-0 truncate pt-1.5 text-sm text-ink-2" title={columnDisplayName(c.label, ci)}>
                  {c.label ? <span className="me-1 text-xs text-ink-3">{columnLetter(ci)}</span> : null}
                  {columnDisplayName(c.label, ci)}
                </span>
                <div className="min-w-0 flex-1">
                  {computed ? (
                    // The literal editor would show "[object Object]" and a blur
                    // would overwrite the formula with it: display only here.
                    <div className="pt-1.5">
                      <FormulaCell value={formulaDisplay(c.id)} />
                      {formulaSource(c.id) ? <div className="mt-0.5 truncate font-[family-name:var(--os-f-mono)] text-xs text-ink-2">{formulaSource(c.id)}</div> : null}
                    </div>
                  ) : (
                    <CellEditor column={c} value={row.values[c.id]} cellStyle={readCellStyle(row.values, c.id)} onChange={(v) => onChange({ [c.id]: v })} />
                  )}
                </div>
              </div>
            );
          })}
        </div>
      ) : null}
    </Drawer>
  );
}

/** The in-cell and drawer editor input: flush with the cell, no frame of
 *  its own (the cell outline is the frame). 14px with an inherited line
 *  height so an open editor keeps the row geometry. */
/** Find and replace card controls (Cmd/Ctrl+F, Cmd/Ctrl+H). */
const FIND_INPUT = "h-7 min-w-0 flex-1 rounded-md border border-line bg-app px-2 text-sm text-ink outline-none focus:border-brand focus:bg-raised";
const FIND_BTN = "inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-ink-2 hover:bg-hover hover:text-ink disabled:cursor-default disabled:opacity-35 disabled:hover:bg-transparent [&>svg]:h-3.5 [&>svg]:w-3.5";
const FIND_ACTION = "h-[26px] shrink-0 rounded-md border border-line bg-raised px-2.5 text-xs font-semibold text-ink-2 hover:bg-hover hover:text-ink disabled:cursor-default disabled:opacity-35";
const CELL_INPUT = "box-border w-full border-0 bg-transparent px-2.5 py-2 font-[inherit] text-base leading-[inherit] text-ink outline-none focus:bg-raised";
const CELL_INPUT_AREA = `${CELL_INPUT} min-h-8 resize-y`;

/** Chip, add-button and popover classes shared by the link, attachment and
 *  person cell editors. */
const CELL_CHIP = "inline-flex items-center gap-1 rounded px-1.5 py-px text-xs";
const CELL_CHIP_X = "border-0 bg-transparent p-0 leading-none text-ink-3 hover:text-ink";
const CELL_ADD = "border border-dashed border-line-strong bg-transparent px-1.5 py-px text-xs text-ink-2 hover:text-ink disabled:opacity-50";
const CELL_POP = "absolute left-0 top-full z-20 mt-1 overflow-y-auto rounded-lg border border-line bg-raised p-1 shadow-[var(--os-shadow-pop)]";
const CELL_POP_SEARCH = "mb-1 h-7 w-full rounded-md border border-line bg-raised px-2 text-xs text-ink outline-none focus:border-brand";
const CELL_POP_ROW = "flex w-full items-center gap-2 rounded-md border-0 bg-transparent px-2 py-1.5 text-left text-sm text-ink hover:bg-hover";

function LinkCell({ value, linked, onChange }: { value: unknown; linked: LinkedTable | undefined; onChange: (v: string[]) => void }) {
  const ids = Array.isArray(value) ? (value as string[]) : [];
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  if (!linked) {
    return <span className={`${CELL_INPUT} inline-block opacity-50`}>{ids.length ? `${ids.length} linked` : "Set target"}</span>;
  }
  const chosen = ids.map((id) => linked.rows.find((r) => r.id === id)).filter((r): r is ApiRow => !!r);
  const candidates = q.trim()
    ? linked.rows.filter((r) => rowTitle(r, linked.titleColId).toLowerCase().includes(q.trim().toLowerCase()))
    : linked.rows;
  const toggle = (id: string) => onChange(ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]);
  return (
    <span className="relative inline-flex flex-wrap items-center gap-1">
      {chosen.map((r) => (
        <span key={r.id} className={`${CELL_CHIP} bg-brand-soft font-medium text-brand`}>
          {rowTitle(r, linked.titleColId)}
          <button type="button" onClick={() => toggle(r.id)} className="border-0 bg-transparent p-0 leading-none text-brand" aria-label="Remove link">×</button>
        </span>
      ))}
      <button type="button" onClick={() => setOpen((o) => !o)} className={`${CELL_ADD} rounded border-brand text-brand hover:text-brand`}>+ link</button>
      {open ? (
        <div className={`${CELL_POP} min-w-60 max-h-[280px]`} onMouseLeave={() => setOpen(false)}>
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={`Search ${linked.name}…`} autoFocus className={CELL_POP_SEARCH} />
          {candidates.length === 0 ? <div className="p-2 text-xs text-ink-3">No records.</div> : candidates.slice(0, 100).map((r) => (
            <button key={r.id} type="button" onClick={() => toggle(r.id)} className={CELL_POP_ROW}>
              <span className="flex-1">{rowTitle(r, linked.titleColId)}</span>
              {ids.includes(r.id) ? <Check className="h-3.5 w-3.5 text-brand" /> : null}
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
    <span className="inline-flex flex-wrap items-center gap-1">
      <input ref={inputRef} type="file" multiple className="hidden" onChange={(e) => { void upload(e.target.files); e.target.value = ""; }} />
      {files.map((f, i) => (
        <span key={i} className={`${CELL_CHIP} bg-active`}>
          <a href={f.url} target="_blank" rel="noopener noreferrer" className="max-w-[120px] truncate text-ink no-underline">{f.name}</a>
          <button type="button" onClick={() => onChange(files.filter((_, n) => n !== i))} className={CELL_CHIP_X} aria-label={`Remove ${f.name}`}>×</button>
        </span>
      ))}
      <button type="button" onClick={() => inputRef.current?.click()} disabled={busy} aria-busy={busy} className={`${CELL_ADD} inline-flex items-center gap-1 rounded`}>{busy ? <Dots variant="pending" /> : "+"} file</button>
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
    <span className="relative inline-flex flex-wrap items-center gap-1">
      {chosen.map((u) => (
        <span key={u.id} className="inline-flex items-center gap-1 rounded-full bg-active py-px pl-0.5 pr-2 text-xs">
          <span className="inline-flex h-4 w-4 items-center justify-center overflow-hidden rounded-full bg-line text-rail font-semibold text-ink-2">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            {u.avatar ? <img src={u.avatar} alt="" className="h-full w-full object-cover" /> : userInitials(u)}
          </span>
          {userName(u)}
          <button type="button" onClick={() => toggle(u.id)} className={CELL_CHIP_X} aria-label={`Remove ${userName(u)}`}>×</button>
        </span>
      ))}
      <button type="button" onClick={() => setOpen((o) => !o)} className={`${CELL_ADD} rounded-full px-2`}>+ person</button>
      {open ? (
        <div className={`${CELL_POP} min-w-[220px] max-h-[260px]`} onMouseLeave={() => setOpen(false)}>
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search people…" autoFocus className={CELL_POP_SEARCH} />
          {candidates.length === 0 ? <div className="p-2 text-xs text-ink-3">No people.</div> : candidates.slice(0, 100).map((u) => (
            <button key={u.id} type="button" onClick={() => toggle(u.id)} className={CELL_POP_ROW}>
              <span className="flex-1">{userName(u)}</span>
              {ids.includes(u.id) ? <Check className="h-3.5 w-3.5 text-brand" /> : null}
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
    <span className={`${CELL_INPUT} inline-block ${isErr ? "text-danger-text" : "text-ink"} ${value === "" ? "opacity-40" : ""}`} title="Computed (read-only)">
      {value === "" ? "" : String(value)}
    </span>
  );
}

/** Hosts an existing cell editor inside the sheet kernel: autofocuses
 *  the first input, applies the type-to-replace seed, and commits back
 *  to the kernel when focus leaves the editor subtree. Existing editors
 *  save on blur, so commit-on-focus-exit preserves their semantics, and
 *  Escape has to suppress that save (see CellEditCancel) rather than just
 *  close, or cancelling would write the in-progress value. */
function SheetEditorHost({ children, seed, commit, move }: { children: React.ReactNode; seed: string | null; commit: () => void; move?: (dr: number, dc: number) => void }) {
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
        // Any other keystroke means the user is still editing, a stale cancel
        // must never swallow the commit that follows it.
        if (e.key !== "Escape") cancelRef.current = false;
        if (e.key === "Tab") {
          // Sheets: Tab commits the draft and moves right (Shift+Tab left).
          // The browser default moved FOCUS out of the editor instead, the
          // grid never advanced and lost focus, which read as "my text
          // disappeared". Blur first: that is what makes editors write.
          e.preventDefault();
          e.stopPropagation();
          const dc = e.shiftKey ? -1 : 1;
          (e.target as HTMLElement).blur?.();
          move?.(0, dc);
          return;
        }
        if (e.key === "Enter") {
          const wantsBreak = e.shiftKey || e.metaKey || e.ctrlKey || e.altKey;
          const ta = e.target instanceof HTMLTextAreaElement;
          if (wantsBreak && ta) {
            // Sheets: Shift/Cmd/Alt+Enter breaks the line INSIDE the cell.
            // Shift+Enter inserts natively; the others are inserted by
            // hand so all the combos behave identically.
            e.stopPropagation();
            if (!e.shiftKey) {
              e.preventDefault();
              const el = e.target as HTMLTextAreaElement;
              const at = el.selectionStart ?? el.value.length;
              const to = el.selectionEnd ?? at;
              el.value = `${el.value.slice(0, at)}\n${el.value.slice(to)}`;
              el.setSelectionRange(at + 1, at + 1);
              // Bubbling input keeps the autosize handler (and any
              // controlled consumer) honest about the manual edit.
              el.dispatchEvent(new Event("input", { bubbles: true }));
            }
            return;
          }
          if (wantsBreak) {
            // Single-line editors cannot hold a break: swallow the combo
            // so the browser does nothing surprising; the cell stays open.
            e.preventDefault();
            e.stopPropagation();
            return;
          }
          // Sheets: plain Enter commits and moves DOWN (the blur below is
          // what makes editors write their draft).
          e.stopPropagation();
          (e.target as HTMLElement).blur?.();
          move?.(1, 0);
          return;
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
 *  SheetEditorHost like every other editor, the host's Enter blurs into the
 *  commit below, and its Escape raises the cancel ref BEFORE that blur, so a
 *  cancelled edit never overwrites the formula it was showing. Autocomplete
 *  stays off in-cell (the cell clips its own overflow, so a dropdown would
 *  be unreadable); the formula bar carries it. */
function SheetFormulaEditor({ initial, baseline, onCommit }: {
  /** What the editor opens showing (the seed, else the source). */
  initial: string;
  /** The cell's pre-edit source, commit fires only when the draft differs
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

function CellEditor({ column, value, cellStyle, onChange }: {
  column: Column;
  value: unknown;
  /** The cell's stored "$fmt" style: an OPEN cell's nf/dp decides the
   *  edit-form it opens with and what counts as an unchanged commit. */
  cellStyle?: CellStyle;
  onChange: (v: unknown) => void;
}) {
  const t = column.type;
  // Escape cancels: the host raises this before blurring, so a blur that is
  // really a cancel must leave the stored value alone.
  const cancelled = useContext(CellEditCancel);
  // A list validation turns ANY column into a dropdown of allowed values
  // (Zoho/Sheets' data-validation pick-list), the primary reason to add
  // a list rule. multi_select keeps its own multi-checkbox editor.
  if (column.validation?.kind === "list" && t !== "multi_select") {
    const cur = value == null ? "" : String(value);
    const offList = cur !== "" && !column.validation.values.includes(cur);
    return (
      <select
        autoFocus
        defaultValue={cur}
        onChange={(e) => onChange(e.target.value || null)}
        className={CELL_INPUT}
      >
        <option value="">None</option>
        {/* Preserve an existing off-list value (imports/legacy) as a real
            option so the select never silently falls back to "" and wipes it. */}
        {offList ? <option value={cur}>{cur} (current)</option> : null}
        {column.validation.values.map((o) => <option key={o} value={o}>{o}</option>)}
      </select>
    );
  }
  if (t === "short_text" || t === "email" || t === "url") {
    // An open (short_text) column can hold a real NUMBER; React stringifies
    // it for defaultValue, so a bare `text !== value` would read "5" vs 5
    // as an edit and push a no-op write (plus a no-op undo entry) on every
    // untouched blur. Compare what the commit would STORE instead: the
    // RICH parse for an open column (value AND the nf it resolves to, so
    // "5", " 5" and "5.0" over a stored 5, and "5%" / "5.0%" over a stored
    // 0.05-percent, are all no-ops), the text itself elsewhere. What does
    // pass: "5" over a legacy STRING "5" (5 !== "5"), a deliberate upgrade
    // write, see commitEditorValue.
    const open = isOpenColumnType(t);
    const unchanged = (text: string) => {
      if (!open) return text === String(value ?? "");
      const entry = resolveOpenEntry(text, cellStyle);
      return entry.fmt === null && entry.value === (value ?? "");
    };
    // Open cells edit in Sheets' form: "5%" for an nf-percent cell, the
    // bare number for currency (the $ is format, not content).
    const initial = open ? openCellEditText(value, cellStyle) : ((value as string | number) ?? "");
    if (t === "short_text") {
      // A textarea, not an input: open cells hold multi-line content
      // (Shift/Cmd/Alt+Enter, the host inserts the break). Auto-grows to
      // its content; the kernel un-clips the editing cell so the growth
      // shows, Sheets' expanding-editor look.
      const autosize = (el: HTMLTextAreaElement) => {
        el.style.height = "auto";
        el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
      };
      return (
        <textarea
          rows={1}
          defaultValue={String(initial ?? "")}
          ref={(el) => { if (el) autosize(el); }}
          onInput={(e) => autosize(e.currentTarget)}
          onBlur={(e) => { if (cancelled?.current) return; if (!unchanged(e.target.value)) onChange(e.target.value); }}
          className={CELL_INPUT_AREA}
          // Flush with the cell: the grown cell (white ground + the active
          // outline) IS the editor's frame, any shadow/border here read as
          // a floating "note" pasted over the grid.
          style={{ background: "transparent", resize: "none", overflow: "hidden", lineHeight: "17px", padding: "2px 0" }}
        />
      );
    }
    return (
      <input
        type={t}
        defaultValue={String(initial ?? "")}
        onBlur={(e) => { if (cancelled?.current) return; if (!unchanged(e.target.value)) onChange(e.target.value); }}
        className={CELL_INPUT}
      />
    );
  }
  if (t === "long_text") {
    return (
      <textarea
        rows={1}
        defaultValue={(value as string) ?? ""}
        onBlur={(e) => { if (cancelled?.current) return; if (e.target.value !== (value ?? "")) onChange(e.target.value); }}
        className={CELL_INPUT_AREA}
      />
    );
  }
  if (t === "number") {
    return (
      <input
        type="number"
        defaultValue={(value as number | "") ?? ""}
        onBlur={(e) => { if (cancelled?.current) return; const n = e.target.value === "" ? null : Number(e.target.value); if (n !== (value ?? null)) onChange(n); }}
        className={CELL_INPUT}
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
          className={CELL_INPUT}
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
            <Star style={{ width: 15, height: 15, fill: i <= n ? "var(--os-warning-solid)" : "none", color: i <= n ? "var(--os-warning-solid)" : "var(--os-line-strong)" }} />
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
        className={CELL_INPUT}
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
      <select value={(value as string) ?? ""} onChange={(e) => onChange(e.target.value || null)} className={CELL_INPUT}>
        <option value="">None</option>
        {(column.options ?? []).map((o) => <option key={o} value={o}>{o}</option>)}
      </select>
    );
  }
  if (t === "multi_select") {
    const arr = Array.isArray(value) ? (value as string[]) : [];
    return (
      <div className="flex flex-wrap gap-2 px-2.5 py-1.5 text-sm [&>label]:inline-flex [&>label]:items-center [&>label]:gap-1 [&>label]:text-ink-2">
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
    return <span className={`${CELL_INPUT} inline-block opacity-50`} title={column.formula}>Computed in the grid</span>;
  }
  if (t === "link" || t === "attachment" || t === "person") {
    const n = Array.isArray(value) ? value.length : 0;
    return <span className={`${CELL_INPUT} inline-block opacity-50`}>{n ? `${n} item${n === 1 ? "" : "s"}, edit in the grid` : "Edit in the grid"}</span>;
  }
  return null;
}

function csvEscape(v: string): string {
  if (v.includes(",") || v.includes('"') || v.includes("\n")) {
    return `"${v.replace(/"/g, '""')}"`;
  }
  return v;
}
