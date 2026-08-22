/**
 * Sheet number-format actions — the SINGLE source for the "123" menu.
 *
 * Google Sheets' mental model is Format → Number → Currency: one choice
 * sets how the column is typed AND how it renders. Both surfaces that
 * offer that menu (the toolbar's 123 button and the column header's "…"
 * popover) import this module so their kind→(type, format) mapping cannot
 * drift. Pure module: no React, no fetch — the caller owns persistence
 * (one persistColumns write per choice, so one undo entry).
 *
 * Formatting is column-level in v1 (ColumnFormat rides on the column's
 * Json); per-cell format is the known next step, so toolbar callers apply
 * these patches to the columns intersecting the selection.
 */

import type { ColumnFormat } from "./sheet-format";

export type NumberFormatKind = "plain" | "number" | "currency" | "percent" | "date" | "checkbox";

/** Menu order + labels, shared so both menus list the kinds identically. */
export const NUMBER_FORMAT_CHOICES: { kind: NumberFormatKind; label: string }[] = [
  { kind: "plain", label: "Plain text" },
  { kind: "number", label: "Number" },
  { kind: "currency", label: "Currency" },
  { kind: "percent", label: "Percent" },
  { kind: "date", label: "Date" },
  { kind: "checkbox", label: "Checkbox" },
];

/** The column type each kind maps onto — also used in reverse to show
 *  which kind is currently active for a column. */
const KIND_TO_TYPE: Record<NumberFormatKind, string> = {
  plain: "short_text",
  number: "number",
  currency: "currency",
  percent: "percent",
  date: "date",
  checkbox: "checkbox",
};

/** Which 123-menu kind a column's current type corresponds to; undefined
 *  for legacy/relational types the menu doesn't offer. */
export function kindForColType(colType: string): NumberFormatKind | undefined {
  for (const [kind, type] of Object.entries(KIND_TO_TYPE) as [NumberFormatKind, string][]) {
    if (type === colType) return kind;
  }
  return undefined;
}

/** The one patch a 123-menu choice applies: col.type plus a sensible
 *  starter col.format, together (callers persist both in ONE write so a
 *  single undo restores both). `format: undefined` means "clear any
 *  stored format" — plain/checkbox columns render raw. */
export function formatPatchFor(kind: NumberFormatKind): { type: string; format: ColumnFormat | undefined } {
  switch (kind) {
    case "number":
      return { type: "number", format: { decimals: 2, thousands: true } };
    case "currency":
      return { type: "currency", format: { style: "currency", currency: "USD", decimals: 2, thousands: true } };
    case "percent":
      // Percent columns store 12 to mean "12%" (see sheet-format), so whole
      // percents are the natural default precision.
      return { type: "percent", format: { style: "percent", decimals: 0 } };
    case "date":
      return { type: "date", format: { dateFormat: "iso" } };
    case "checkbox":
      return { type: "checkbox", format: undefined };
    case "plain":
      return { type: "short_text", format: undefined };
  }
}

/** Toolbar's increase/decrease-decimals: clamp 0..10 (the ColumnFormat
 *  contract sheet-format enforces on read). When no decimals are set yet
 *  the first press steps from the style's sensible default — 0 for
 *  percent-rendered columns, 2 for number/currency — matching what the
 *  123 menu would have seeded. */
export function adjustDecimals(format: ColumnFormat | undefined, colType: string, delta: 1 | -1): ColumnFormat {
  // format.style can override the column type's rendering (a number column
  // displayed as percent), so resolve the style the way the renderer does.
  const resolved = format?.style ?? colType;
  const start = format?.decimals ?? (resolved === "percent" ? 0 : 2);
  const decimals = Math.min(10, Math.max(0, start + delta));
  return { ...(format ?? {}), decimals };
}
