// The Table view's comfort settings, as geometry: pinned columns, row height
// and conditional row tints (gap 14, List comfort). Pure, so the rules the
// renderer lays out by are the rules a test can pin.
//
//   Pinned columns (View.config.pinnedColumns): while any column is pinned,
//   the leading checkbox cell, Name and the pinned columns stay put while the
//   rest scroll sideways, like a frozen spreadsheet pane. Pinning nothing is
//   exactly today's table: nothing is sticky and nothing moves.
//   Row height (View.config.rowHeight): three steps derived from the viewer's
//   density token, so a person's density preference still counts.
//   Row tints (Board.settings.rowColorRules): the product palette, mixed into
//   the surface so they read in both themes and never shout over the row.
//
// Pure: type-only imports.

import type { RowColor, RowHeight } from "@/lib/list-comfort";
import { MAX_PINNED_COLUMNS } from "@/lib/list-comfort";

/**
 * The window CustomEvent a List settings panel dispatches after a save, with
 * `detail: { boardId }`, so a List page showing that List re-reads its
 * defaults and colour rules without a reload.
 */
export const LIST_SETTINGS_CHANGED = "workwrk:list-settings-changed";

/**
 * The table's column order with pinned columns brought forward.
 *
 * `keys` is the table's own order and starts with "name". Name always stays
 * first. Pinned keys follow it in TABLE order (not the order they were
 * pinned in, so pinning never shuffles what it keeps), then everything else.
 * A key the table does not show (hidden, deleted, unknown) is ignored, and at
 * most MAX_PINNED_COLUMNS are honoured.
 *
 * `stickyCount` counts Name plus the pinned columns, and is 0 when nothing is
 * pinned: then no cell is sticky, which is today's table.
 */
export function orderColumnsForPinning(
  keys: readonly string[],
  pinned: readonly string[],
): { ordered: string[]; stickyCount: number } {
  const wanted = new Set(pinned.filter((k) => k !== "name"));
  const pinnedInOrder = keys.filter((k) => k !== "name" && wanted.has(k)).slice(0, MAX_PINNED_COLUMNS);
  if (pinnedInOrder.length === 0) return { ordered: [...keys], stickyCount: 0 };
  const pinnedSet = new Set(pinnedInOrder);
  const hasName = keys.includes("name");
  const rest = keys.filter((k) => k !== "name" && !pinnedSet.has(k));
  return {
    ordered: [...(hasName ? ["name"] : []), ...pinnedInOrder, ...rest],
    stickyCount: (hasName ? 1 : 0) + pinnedInOrder.length,
  };
}

/**
 * The `left` offset of each sticky cell: 0 for the first (the leading
 * checkbox cell), then the running total of the widths before it.
 */
export function stickyOffsets(widths: readonly number[]): number[] {
  const out: number[] = [];
  let left = 0;
  for (const w of widths) {
    out.push(left);
    left += w;
  }
  return out;
}

/**
 * A row's height for a view's Row height setting.
 *
 * Default is the density token itself, untouched, so a view with no setting
 * renders exactly as before. Compact takes 8px off (never below 28, the
 * smallest target a pointer can hit), Tall adds 16 and lets a title wrap.
 */
export function rowHeightStyle(h?: RowHeight | null): string {
  if (h === "compact") return "max(28px, calc(var(--os-row-h, 44px) - 8px))";
  if (h === "tall") return "calc(var(--os-row-h, 44px) + 16px)";
  return "var(--os-row-h, 44px)";
}

/**
 * A row tint per palette colour: 14% of a semantic solid mixed into the
 * surface. Tokens only, so dark mode (which rebinds every one of them) gets a
 * tint that is dark too. Orange has no token of its own, so it is the halfway
 * mix of the danger and warning solids.
 */
export const ROW_COLOR_TINT: Record<RowColor, string> = {
  red: "color-mix(in srgb, var(--os-danger-solid) 14%, var(--os-surface))",
  orange: "color-mix(in srgb, color-mix(in srgb, var(--os-danger-solid) 50%, var(--os-warning-solid)) 14%, var(--os-surface))",
  yellow: "color-mix(in srgb, var(--os-warning-solid) 14%, var(--os-surface))",
  green: "color-mix(in srgb, var(--os-success-solid) 14%, var(--os-surface))",
  blue: "color-mix(in srgb, var(--os-brand) 14%, var(--os-surface))",
  grey: "color-mix(in srgb, var(--os-ink-3) 14%, var(--os-surface))",
};

/** The solid swatch each colour is picked from in the rules panel. */
export const ROW_COLOR_SWATCH: Record<RowColor, string> = {
  red: "var(--os-danger-solid)",
  orange: "color-mix(in srgb, var(--os-danger-solid) 50%, var(--os-warning-solid))",
  yellow: "var(--os-warning-solid)",
  green: "var(--os-success-solid)",
  blue: "var(--os-brand)",
  grey: "var(--os-ink-3)",
};

/** The words a colour is named by, in the rules panel and to a screen reader. */
export const ROW_COLOR_LABEL: Record<RowColor, string> = {
  red: "Red",
  orange: "Orange",
  yellow: "Yellow",
  green: "Green",
  blue: "Blue",
  grey: "Grey",
};
