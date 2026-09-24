// Column naming and typing for the sheet (spec-tables-forms section 2
// /tables/[id], "Naming a column" and "Typing a column").
//
// THE ENGINE IS SACRED (docs/plans/tables.md section 2 decision 1): nothing
// here changes the DataTable.columns or DataTableRow.values shapes. A type is
// the existing `type` string on a column, a name is the existing `label`, and
// a type change NEVER rewrites a stored cell. What this module decides is what
// the person is told before a type change: how many non-empty cells would read
// differently under the new type (the confirm's count), and which options a
// select column should start with so the values already there stay valid.
//
// The number-format subset (Plain text, Number, Currency, Percent, Date,
// Checkbox) keeps living in sheet-format-actions.ts, which the toolbar's 123
// menu uses; the picker below is a superset and borrows its starter formats so
// the two surfaces cannot drift.
//
// Pure: no React, no fetch.

import { isFormulaCell } from "./sheet-engine";
import { formatPatchFor, kindForColType } from "./sheet-format-actions";
import type { ColumnFormat } from "./sheet-format";

export type ColumnTypeValue =
  | "short_text" | "long_text" | "number" | "currency" | "percent" | "date" | "checkbox"
  | "select" | "multi_select" | "rating"
  | "person" | "url" | "attachment" | "formula" | "link" | "lookup" | "rollup"
  | "email";

export interface ColumnTypeChoice {
  value: ColumnTypeValue;
  label: string;
  /** Rendered only after "Show more" (design system 5.1: Show more after 10). */
  more: boolean;
}

/** The seventeen types, in the spec's order, split at ten. */
export const COLUMN_TYPE_CHOICES: readonly ColumnTypeChoice[] = [
  { value: "short_text", label: "Text", more: false },
  { value: "long_text", label: "Long text", more: false },
  { value: "number", label: "Number", more: false },
  { value: "currency", label: "Currency", more: false },
  { value: "percent", label: "Percent", more: false },
  { value: "date", label: "Date", more: false },
  { value: "checkbox", label: "Checkbox", more: false },
  { value: "select", label: "Single select", more: false },
  { value: "multi_select", label: "Multiple select", more: false },
  { value: "rating", label: "Rating", more: false },
  { value: "person", label: "Person", more: true },
  { value: "url", label: "Link", more: true },
  { value: "attachment", label: "Attachment", more: true },
  { value: "formula", label: "Formula", more: true },
  { value: "link", label: "Link to another table", more: true },
  { value: "lookup", label: "Lookup", more: true },
  { value: "rollup", label: "Rollup", more: true },
];

/** Email is a legacy type the picker does not offer; it still has a name. */
const EXTRA_LABELS: Record<string, string> = { email: "Email" };

export function columnTypeLabel(type: string): string {
  return COLUMN_TYPE_CHOICES.find((c) => c.value === type)?.label ?? EXTRA_LABELS[type] ?? "Text";
}

/** Types whose cells are computed from elsewhere: stored values are ignored. */
export const COMPUTED_TYPES: ReadonlySet<string> = new Set(["formula", "lookup", "rollup"]);
/** Types that need a follow-up dialog before they mean anything. */
export const RELATION_TYPES: ReadonlySet<string> = new Set(["link", "lookup", "rollup"]);

function isBlank(v: unknown): boolean {
  return v === undefined || v === null || v === "" || (Array.isArray(v) && v.length === 0);
}

function numericLike(v: unknown): boolean {
  if (typeof v === "number") return Number.isFinite(v);
  if (typeof v === "string") {
    const t = v.trim().replace(/[$,%\s]/g, "");
    return t !== "" && Number.isFinite(Number(t));
  }
  return false;
}

function dateLike(v: unknown): boolean {
  if (typeof v === "number") return Number.isFinite(v);
  if (typeof v !== "string") return false;
  return Number.isFinite(Date.parse(v.trim()));
}

/**
 * Does a stored value still read as itself under `toType`? Blank always does,
 * and a per-cell formula ({ "=": ... }) does in every non-computed type (the
 * engine still evaluates it). Under a computed type every stored value is
 * hidden behind the computation, so nothing non-blank "fits".
 */
export function cellFitsType(v: unknown, toType: string, options?: readonly string[]): boolean {
  if (isBlank(v)) return true;
  if (COMPUTED_TYPES.has(toType)) return false;
  if (isFormulaCell(v)) return true;
  switch (toType) {
    case "number": case "currency": case "percent":
      return numericLike(v);
    case "rating":
      return typeof v === "number" ? Number.isInteger(v) && v >= 0 && v <= 5 : false;
    case "date":
      return dateLike(v);
    case "checkbox":
      return typeof v === "boolean" || v === "true" || v === "false";
    case "select":
      return typeof v === "string" && (!options || options.includes(v));
    case "multi_select":
      // The grid draws a multi-select cell only from a list; a plain string
      // stored there renders blank, so it does not fit.
      return Array.isArray(v) && (!options || v.every((x) => typeof x === "string" && options.includes(x)));
    case "person": case "attachment": case "link":
      return Array.isArray(v);
    case "short_text": case "long_text": case "url": case "email":
      // Text shows any scalar as itself; a list (multi-select, people) or an
      // object would print as a joined or blank string.
      return typeof v !== "object";
    default:
      return true;
  }
}

/** How many non-empty cells would read differently after the change. */
export function countTypeChangeLosses(values: Iterable<unknown>, toType: string, options?: readonly string[]): number {
  let n = 0;
  for (const v of values) if (!cellFitsType(v, toType, options)) n += 1;
  return n;
}

/** The options a new select column starts with: the distinct text already in
 *  it, in first-seen order, capped so a free-text column does not become a
 *  thousand-option menu. Existing values therefore stay valid. */
export function derivedSelectOptions(values: Iterable<unknown>, cap = 50): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const v of values) {
    const list = Array.isArray(v) ? v : [v];
    for (const x of list) {
      if (typeof x !== "string" && typeof x !== "number") continue;
      const s = String(x).trim();
      if (!s || seen.has(s)) continue;
      seen.add(s);
      out.push(s);
      if (out.length >= cap) return out;
    }
  }
  return out;
}

/**
 * The column patch a type choice writes, in ONE columns write so one undo
 * restores it. Number-ish types borrow the 123 menu's starter format, so
 * picking Currency here and picking $ in the toolbar produce the same column.
 */
export function typeChangePatch(
  from: { type: string; format?: ColumnFormat; options?: string[] },
  toType: ColumnTypeValue,
  values: Iterable<unknown> = [],
): { type: ColumnTypeValue; format?: ColumnFormat; options?: string[] } {
  const kind = kindForColType(toType);
  const patch: { type: ColumnTypeValue; format?: ColumnFormat; options?: string[] } = { type: toType };
  if (kind) {
    // Keep a format the person already chose when the kind does not change
    // what it means (Number to Number is a no-op; Number to Currency re-seeds).
    patch.format = kindForColType(from.type) === kind ? from.format : formatPatchFor(kind).format;
  } else {
    patch.format = undefined;
  }
  if ((toType === "select" || toType === "multi_select") && !(from.options && from.options.length)) {
    patch.options = derivedSelectOptions(values);
  }
  return patch;
}

/** A column name as typed: trimmed, capped, with brackets removed because a
 *  name is referenced as [Name] inside formulas and "]" would end the ref. */
export function cleanColumnName(raw: string): string {
  return raw.replace(/[[\]]/g, "").trim().slice(0, 120);
}
