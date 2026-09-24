// Readers for the Tables hub's personal preferences (spec-tables-forms
// section 2), one field at a time with its default beside it. See the
// shallow-merge note in src/lib/preferences-schema.ts: never spread the
// namespace, or an org default for a key the user never set is lost.
//
// Also the two per-table stores that are NOT preferences-schema keys:
//   zoom   per device, localStorage `workwrk:tables:zoom:{tableId}` (settings
//          7.3 names "one sheet's zoom" as allowed ephemera). The key used to
//          be `workwrk:sheet-zoom:{tableId}`; the reader falls back to it so
//          nobody's saved zoom resets the day the name changes.
//   pivot  the last pivot CONFIGURATION per person per table, at
//          home.work.surface["table:{tableId}"].pivot (settings 7.3). The
//          result is never stored.

function isRecord(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

export const TABLES_LIST_COLUMNS = ["location", "rows", "owner", "updated"] as const;
export type TablesListColumn = (typeof TABLES_LIST_COLUMNS)[number];
export const FORMS_LIST_COLUMNS = ["goesTo", "responses", "status", "owner", "updated"] as const;
export type FormsListColumn = (typeof FORMS_LIST_COLUMNS)[number];

function readColumns<K extends string>(stored: unknown, keys: readonly K[]): Record<K, boolean> {
  const out = Object.fromEntries(keys.map((k) => [k, true])) as Record<K, boolean>;
  if (!isRecord(stored)) return out;
  for (const k of keys) if (typeof stored[k] === "boolean") out[k] = stored[k] as boolean;
  return out;
}

export function readTablesColumns(home: unknown): Record<TablesListColumn, boolean> {
  const t = isRecord(home) ? home.tables : undefined;
  return readColumns(isRecord(t) ? t.columns : undefined, TABLES_LIST_COLUMNS);
}

export function readFormsColumns(home: unknown): Record<FormsListColumn, boolean> {
  const f = isRecord(home) ? home.forms : undefined;
  return readColumns(isRecord(f) ? f.columns : undefined, FORMS_LIST_COLUMNS);
}

/** View > Gridlines on the sheet. Default on. */
export function readSheetGridlines(home: unknown): boolean {
  const t = isRecord(home) ? home.tables : undefined;
  const v = isRecord(t) ? t.gridlines : undefined;
  return typeof v === "boolean" ? v : true;
}

/** View > Formula bar on the sheet. Default on. */
export function readSheetFormulaBar(home: unknown): boolean {
  const t = isRecord(home) ? home.tables : undefined;
  const v = isRecord(t) ? t.formulaBar : undefined;
  return typeof v === "boolean" ? v : true;
}

/** The form builder's Display > Show help text. Default on. */
export function readFormsShowHelpText(home: unknown): boolean {
  const f = isRecord(home) ? home.forms : undefined;
  const v = isRecord(f) ? f.showHelpText : undefined;
  return typeof v === "boolean" ? v : true;
}

/** The form builder's Display > Show field numbers. Default off. */
export function readFormsShowFieldNumbers(home: unknown): boolean {
  const f = isRecord(home) ? home.forms : undefined;
  const v = isRecord(f) ? f.showFieldNumbers : undefined;
  return typeof v === "boolean" ? v : false;
}

/* ── zoom ─────────────────────────────────────────────────────────── */

export const ZOOM_LEVELS = [75, 90, 100, 125, 150] as const;

export function zoomKey(tableId: string): string {
  return `workwrk:tables:zoom:${tableId}`;
}
export function legacyZoomKey(tableId: string): string {
  return `workwrk:sheet-zoom:${tableId}`;
}

/** A stored zoom string, or null. 100 for anything absent or off the ladder. */
export function parseZoom(raw: string | null | undefined): number {
  const v = Number(raw);
  return (ZOOM_LEVELS as readonly number[]).includes(v) ? v : 100;
}

/** Read the zoom for a table: the new key, else the old key, else 100. Never throws. */
export function readZoom(storage: Pick<Storage, "getItem"> | null | undefined, tableId: string): number {
  if (!storage) return 100;
  try {
    const fresh = storage.getItem(zoomKey(tableId));
    if (fresh !== null) return parseZoom(fresh);
    return parseZoom(storage.getItem(legacyZoomKey(tableId)));
  } catch {
    return 100;
  }
}

/* ── pivot configuration ──────────────────────────────────────────── */

/** The Pivot dialog's own vocabulary (lib/sheet-pivot PivotAgg, pivot-chart ChartType). */
export type PivotConfigAgg = "sum" | "count" | "avg" | "min" | "max";
export type PivotConfigChart = "bar" | "line" | "pie";

export interface PivotConfig {
  /** Rows (group by), in order. */
  rowFields: string[];
  /** Columns (pivot into), or "" for none. */
  colField: string;
  valueField: string;
  agg: PivotConfigAgg;
  view: "table" | "chart";
  chartType: PivotConfigChart;
}

const AGGS: PivotConfigAgg[] = ["sum", "count", "avg", "min", "max"];
const CHARTS: PivotConfigChart[] = ["bar", "line", "pie"];

export function pivotSurfaceKey(tableId: string): string {
  return `table:${tableId}`;
}

/**
 * The stored configuration, or null. Column ids that no longer exist in the
 * table read as unset (the column was deleted since), so a reopened pivot
 * never points at a ghost.
 */
export function readPivotConfig(home: unknown, tableId: string, liveColumnIds: ReadonlySet<string>): PivotConfig | null {
  const work = isRecord(home) ? home.work : undefined;
  const surface = isRecord(work) ? work.surface : undefined;
  const slot = isRecord(surface) ? surface[pivotSurfaceKey(tableId)] : undefined;
  const p = isRecord(slot) ? slot.pivot : undefined;
  if (!isRecord(p)) return null;
  const live = (v: unknown): string => (typeof v === "string" && liveColumnIds.has(v) ? v : "");
  const rows = Array.isArray(p.rowFields) ? p.rowFields.map(live).filter(Boolean) : [];
  return {
    rowFields: rows,
    colField: live(p.colField),
    valueField: live(p.valueField),
    agg: AGGS.includes(p.agg as PivotConfigAgg) ? (p.agg as PivotConfigAgg) : "sum",
    view: p.view === "chart" ? "chart" : "table",
    chartType: CHARTS.includes(p.chartType as PivotConfigChart) ? (p.chartType as PivotConfigChart) : "bar",
  };
}

/**
 * The PATCH /api/preferences body that stores one table's pivot. The whole
 * `surface` record is sent with this table's slot replaced, because the
 * record is merged one level deep: sending only this key keeps every other
 * surface's options.
 */
export function pivotPatch(home: unknown, tableId: string, config: PivotConfig): { home: { work: { surface: Record<string, unknown> } } } {
  const work = isRecord(home) ? home.work : undefined;
  const surface = isRecord(work) && isRecord(work.surface) ? work.surface : {};
  const key = pivotSurfaceKey(tableId);
  const prev = isRecord(surface[key]) ? (surface[key] as Record<string, unknown>) : {};
  return { home: { work: { surface: { ...surface, [key]: { ...prev, pivot: config } } } } };
}
