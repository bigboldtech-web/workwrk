// The sheet's column filters (spec-tables-forms section 2 /tables/[id], the
// Filter side panel: "one 36px checkbox row per column with a value control
// beneath (a value picker for select types, a range for numbers and dates, a
// text contains for text)", and the toolbar chip "Filter · N").
//
// Several columns filter at once and every filter must hold (AND), the way a
// Google Sheets filter view reads. Each filter is one of three kinds, chosen
// by the column's type:
//   value     select and multi-select columns: the row holds one of the
//             chosen options (any of them; a multi-select cell matches when
//             it holds at least one)
//   range     number, currency, percent, rating and date columns: the shown
//             value lies between min and max, either end optional
//   contains  everything else: the shown text contains the needle
//
// PERSISTENCE. The filters ride DataTable.views[0].config, the same slot the
// sort and freeze use, as `filters: SheetColumnFilter[]`. The old single
// `filter: { colId, value }` is still READ (a table saved before this shape
// keeps its filter), and the first filter is still WRITTEN there when it has
// the old shape's meaning, so a client from the previous release still
// applies that one filter (it shows more rows, never fewer) for one
// release. Nothing in the engine or in DataTableRow.values changes
// (docs/plans/tables.md section 2 decision 1).
//
// Pure: no React, no fetch.

export type SheetColumnFilter =
  | { colId: string; kind: "value"; values: string[] }
  | { colId: string; kind: "range"; min?: string; max?: string }
  | { colId: string; kind: "contains"; value: string };

export type SheetFilterKind = SheetColumnFilter["kind"];

const VALUE_TYPES = new Set(["select", "multi_select"]);
const NUMBER_TYPES = new Set(["number", "currency", "percent", "rating"]);
const DATE_TYPES = new Set(["date"]);

/** Which control a column's filter uses, from its type. */
export function filterKindFor(type: string | undefined): SheetFilterKind {
  if (type && VALUE_TYPES.has(type)) return "value";
  if (type && (NUMBER_TYPES.has(type) || DATE_TYPES.has(type))) return "range";
  return "contains";
}

/** Is a range filter over dates (the DateField) rather than numbers? */
export function isDateFilterType(type: string | undefined): boolean {
  return !!type && DATE_TYPES.has(type);
}

/** A filter with nothing chosen yet: it is shown (the row is ticked) but matches every row. */
export function emptyFilterFor(colId: string, type: string | undefined): SheetColumnFilter {
  const kind = filterKindFor(type);
  if (kind === "value") return { colId, kind, values: [] };
  if (kind === "range") return { colId, kind };
  return { colId, kind, value: "" };
}

/** Does this filter narrow anything? A half-set one (ticked, no value) does not. */
export function filterIsActive(f: SheetColumnFilter): boolean {
  if (f.kind === "value") return f.values.length > 0;
  if (f.kind === "range") return !!(f.min?.trim() || f.max?.trim());
  return f.value.trim().length > 0;
}

/** The "Filter · N" count: the column filters that narrow, plus the search. */
export function activeFilterCount(filters: readonly SheetColumnFilter[], search: string): number {
  return filters.filter(filterIsActive).length + (search.trim() ? 1 : 0);
}

type ColumnLike = { id: string; type?: string; options?: string[] };

/**
 * Read the persisted filters, keeping only what the panel can SHOW: the
 * column must still exist, its filter kind must still match its type, and a
 * value filter keeps only options the column still has. Otherwise the filter
 * would hide rows while the panel shows nothing ticked, an invisible filter
 * with no way to clear it.
 */
export function readSavedFilters(
  config: { filters?: unknown; filter?: unknown } | null | undefined,
  columns: readonly ColumnLike[],
): SheetColumnFilter[] {
  const byId = new Map(columns.map((c) => [c.id, c]));
  const out: SheetColumnFilter[] = [];
  const seen = new Set<string>();
  const push = (f: SheetColumnFilter | null) => {
    if (!f || seen.has(f.colId) || !filterIsActive(f)) return;
    seen.add(f.colId);
    out.push(f);
  };
  const list = Array.isArray(config?.filters) ? config!.filters : null;
  if (list) {
    for (const raw of list) push(normalise(raw, byId));
  } else if (config?.filter && typeof config.filter === "object") {
    // The previous release's one filter: { colId, value }.
    const legacy = config.filter as { colId?: unknown; value?: unknown };
    if (typeof legacy.colId === "string" && typeof legacy.value === "string") {
      const col = byId.get(legacy.colId);
      if (col) {
        push(filterKindFor(col.type) === "value"
          ? normalise({ colId: col.id, kind: "value", values: [legacy.value] }, byId)
          : { colId: col.id, kind: "contains", value: legacy.value });
      }
    }
  }
  return out;
}

function normalise(raw: unknown, byId: Map<string, ColumnLike>): SheetColumnFilter | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.colId !== "string") return null;
  const col = byId.get(r.colId);
  if (!col) return null;
  const kind = filterKindFor(col.type);
  if (r.kind !== kind) return null;
  if (kind === "value") {
    const options = new Set(col.options ?? []);
    const values = Array.isArray(r.values)
      ? r.values.filter((v): v is string => typeof v === "string" && options.has(v))
      : [];
    return { colId: col.id, kind, values };
  }
  if (kind === "range") {
    const min = typeof r.min === "string" && r.min.trim() ? r.min : undefined;
    const max = typeof r.max === "string" && r.max.trim() ? r.max : undefined;
    return { colId: col.id, kind, ...(min !== undefined ? { min } : {}), ...(max !== undefined ? { max } : {}) };
  }
  return { colId: col.id, kind, value: typeof r.value === "string" ? r.value : "" };
}

/**
 * What to write into views[0].config: `filters` (only the ones that narrow)
 * and the legacy `filter`, set from the first filter when it has the old
 * shape's meaning (one select value, or a contains on a non-select column),
 * so the previous release's reader still applies that one (more rows, never fewer).
 * `undefined` drops a key from the PATCH body's JSON.
 */
export function filtersToConfig(filters: readonly SheetColumnFilter[]): {
  filters: SheetColumnFilter[] | undefined;
  filter: { colId: string; value: string } | undefined;
} {
  const live = filters.filter(filterIsActive);
  if (live.length === 0) return { filters: undefined, filter: undefined };
  const first = live[0];
  const filter = first.kind === "value" && first.values.length === 1
    ? { colId: first.colId, value: first.values[0] }
    : first.kind === "contains"
      ? { colId: first.colId, value: first.value }
      : undefined;
  return { filters: live.map((f) => ({ ...f })), filter };
}

/** Parse a shown number: "1,234.5", "$12", "45%" and " 7 " all read. */
export function parseShownNumber(text: string): number | null {
  const cleaned = text.replace(/[,\s$€£¥₹%]/g, "");
  if (!cleaned) return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

/** A date's comparable day key (YYYY-MM-DD), from a stored or shown value. */
export function dayKeyOf(text: string): string | null {
  const t = text.trim();
  if (!t) return null;
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(t);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const ms = Date.parse(t);
  if (Number.isNaN(ms)) return null;
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/**
 * Does one row pass one filter? `raw` is the stored cell (for the value
 * filter's exact match), `shown` the text the person sees in the cell (a
 * formula's computed value, a number's plain text), `type` the column type.
 */
export function cellPassesFilter(
  f: SheetColumnFilter,
  raw: unknown,
  shown: string,
  type: string | undefined,
): boolean {
  if (!filterIsActive(f)) return true;
  if (f.kind === "value") {
    if (Array.isArray(raw)) return raw.some((v) => f.values.includes(String(v)));
    return f.values.includes(String(raw ?? ""));
  }
  if (f.kind === "contains") return shown.toLowerCase().includes(f.value.trim().toLowerCase());
  if (isDateFilterType(type)) {
    const k = dayKeyOf(shown) ?? dayKeyOf(String(raw ?? ""));
    if (k === null) return false;
    const lo = f.min?.trim() ? dayKeyOf(f.min) : null;
    const hi = f.max?.trim() ? dayKeyOf(f.max) : null;
    if (lo && k < lo) return false;
    if (hi && k > hi) return false;
    return true;
  }
  const n = parseShownNumber(shown) ?? (typeof raw === "number" ? raw : null);
  if (n === null) return false;
  const lo = f.min?.trim() ? parseShownNumber(f.min) : null;
  const hi = f.max?.trim() ? parseShownNumber(f.max) : null;
  if (lo !== null && n < lo) return false;
  if (hi !== null && n > hi) return false;
  return true;
}
