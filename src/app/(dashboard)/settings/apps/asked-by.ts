// Who asked for a connector, as one row hint on Apps & modules > Requests >
// Connector requests (settings-cleanup Phase 2, B5: a row hint is one line).
// The first three names and "and N more"; everyone's name is behind the
// row's Show more. Pure: imported by the page and its test.

/** How many askers a connector row names before "and N more". */
export const ASKED_BY_SHOWN = 3;

/**
 * "Ana", "Ana and Ben", "Ana, Ben and Chris", or "Ana, Ben, Chris and 9
 * more" out of `total`, everyone who asked (the route names at most ten of
 * them, so the count, not the names, says how many more).
 */
export function askedByLine(names: readonly string[], total: number): string {
  const shown = names.slice(0, ASKED_BY_SHOWN);
  const rest = Math.max(total, names.length) - shown.length;
  if (rest > 0 && shown.length > 0) return `${shown.join(", ")} and ${rest} more`;
  if (shown.length <= 1) return shown[0] ?? "";
  return `${shown.slice(0, -1).join(", ")} and ${shown[shown.length - 1]}`;
}

/** Whether the row's Show more has anything the hint leaves out: a name past the third, or a note. */
export function askedByHasMore(names: readonly string[], total: number, notes: number): boolean {
  return notes > 0 || Math.max(total, names.length) > ASKED_BY_SHOWN;
}
