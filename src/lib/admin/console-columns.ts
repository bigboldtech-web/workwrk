// The bridge between a Staff console table's column settings (TableCard's
// { shown, hidden } choice) and the list the console keeps per staff member
// in PlatformAdmin.consolePrefs (companies.columns, audit.columns: the keys
// that show, or null for the table's defaults). Pure, client-safe, tested.

import type { ColumnChoice } from "@/components/ui/table-card";

/**
 * The TableCard choice for a stored list. `null` is the defaults: every
 * column on except `offByDefault` (Sign-in domain on Companies; Email and
 * Source on Staff activity).
 */
export function choiceFromStored(
  allKeys: readonly string[],
  stored: readonly string[] | null | undefined,
  offByDefault: readonly string[] = [],
): ColumnChoice {
  if (!stored) return { shown: [], hidden: [...offByDefault] };
  const on = new Set(stored);
  return {
    shown: allKeys.filter((k) => on.has(k)),
    hidden: allKeys.filter((k) => !on.has(k)),
  };
}

/**
 * The list to store for a TableCard choice. The popover's "Reset" (an empty
 * choice) and a choice that equals the defaults both store null, so the
 * defaults can change later without a stale copy pinning the old ones.
 */
export function storedFromChoice(
  allKeys: readonly string[],
  next: ColumnChoice,
  offByDefault: readonly string[] = [],
): string[] | null {
  if (next.shown.length === 0 && next.hidden.length === 0) return null;
  const hidden = new Set(next.hidden);
  const visible = allKeys.filter((k) => !hidden.has(k));
  const defaults = allKeys.filter((k) => !offByDefault.includes(k));
  const same = visible.length === defaults.length && visible.every((k, i) => k === defaults[i]);
  return same ? null : visible;
}
