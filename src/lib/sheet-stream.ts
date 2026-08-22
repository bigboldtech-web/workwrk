// Client half of the Tables Phase 5a streaming transport (docs/plans/
// tables.md, amended decision): keyset pagination is TRANSPORT ONLY — the
// caller keeps fetching chunks until the whole table is resident, because
// the formula engine is client-side and an aggregate over a partial row
// set would be silently wrong. This module is only the cursor loop, kept
// pure (no fetch, no React) so the termination and progress contract can
// be unit-tested; the page supplies the real fetch and applies the chunks.

export interface RowStreamPage {
  data: unknown[];
  /** null on the last chunk; a string resumes the stream. */
  nextCursor: string | null;
  /** COUNT of all rows — present only on the cursor-less first response. */
  total?: number;
}

/**
 * Drive the cursor loop: first call with `cursor === null`, follow
 * `nextCursor` until it comes back null, accumulate every chunk, and
 * report progress after each one via `onChunk(rows, loaded, total)`
 * (`total` is null until/unless the first response carried one).
 * Resolves with all rows in arrival order; rejects with the first
 * fetch error untouched.
 *
 * Termination is guarded against a broken or malicious server — the
 * client must never spin forever on someone else's bug:
 *  - a cursor the stream has already followed (same string twice in a
 *    row included) throws: cursors encode a strictly-advancing (position,
 *    id), so any repeat can only be a loop;
 *  - an empty chunk that still claims a nextCursor throws: no forward
 *    progress means the stream can never end.
 */
export async function streamRows(
  fetchPage: (cursor: string | null) => Promise<RowStreamPage>,
  onChunk: (rows: unknown[], loaded: number, total: number | null) => void,
): Promise<unknown[]> {
  const all: unknown[] = [];
  const seen = new Set<string>();
  let cursor: string | null = null;
  let total: number | null = null;

  for (;;) {
    const page = await fetchPage(cursor);
    // A page without an array is a server contract break, not "no rows" —
    // treating it as empty would silently truncate the table.
    if (!Array.isArray(page.data)) throw new Error("row stream: malformed page (data is not an array)");
    // total is trusted only from the cursor-less response, per contract.
    if (cursor === null && typeof page.total === "number") total = page.total;
    for (const row of page.data) all.push(row);
    onChunk(page.data, all.length, total);

    const next = page.nextCursor ?? null;
    if (next === null) return all;
    if (seen.has(next) || next === cursor) throw new Error("row stream: server repeated a cursor (refusing to loop)");
    if (page.data.length === 0) throw new Error("row stream: empty chunk with a nextCursor (no forward progress)");
    seen.add(next);
    cursor = next;
  }
}
