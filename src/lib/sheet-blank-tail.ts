// Where appended rows land in a table (POST /api/tables/[id]/import): after
// the LAST row that holds data, reusing the blank rows behind it. A table is
// born with 1,000 blank rows, so appending at max(position) + 1 put every
// imported row below a thousand empty ones and the table looked empty.
//
// A row is blank when no non-reserved key holds a value. Reserved keys
// (values["$fmt"] styles, values["$rh"] height, every key starting "$") are
// layout, and a reused row KEEPS them: an import never wipes formatting.
// Empty means null, "", [] or {} (what the grid treats as an empty cell).
//
// Pure: the route loads rows and writes; this decides.

export function isBlankValues(values: unknown): boolean {
  if (!values || typeof values !== "object" || Array.isArray(values)) return true;
  for (const [k, v] of Object.entries(values as Record<string, unknown>)) {
    if (k.startsWith("$")) continue;
    if (v === null || v === undefined || v === "") continue;
    if (Array.isArray(v) && v.length === 0) continue;
    if (typeof v === "object" && !Array.isArray(v) && Object.keys(v as object).length === 0) continue;
    return false;
  }
  return true;
}

/** The blank rows after the last used one, in order (the ones an append reuses). */
export function blankTail<T extends { values: unknown }>(rowsInOrder: readonly T[]): T[] {
  let lastUsed = -1;
  for (let i = rowsInOrder.length - 1; i >= 0; i--) {
    if (!isBlankValues(rowsInOrder[i].values)) { lastUsed = i; break; }
  }
  return rowsInOrder.slice(lastUsed + 1);
}

/** A reused row's reserved keys, which the written values are merged over. */
export function reservedKeysOf(values: unknown): Record<string, unknown> {
  if (!values || typeof values !== "object" || Array.isArray(values)) return {};
  return Object.fromEntries(Object.entries(values as Record<string, unknown>).filter(([k]) => k.startsWith("$")));
}
