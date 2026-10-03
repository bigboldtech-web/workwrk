// Ask AI's list tools read candidates newest first and keep the ones the
// person may open. Reading one fixed batch (limit x 4, or the newest 200)
// and filtering it could leave a narrow reader with nothing while readable
// rows existed further down: the newest tasks of a big workspace may all sit
// in Lists they cannot open. collectReadable pages through the candidates in
// batches until it has `limit` readable rows, the candidates run out, or a
// hard cap is reached; at the cap it says so, so the assistant never answers
// "none" for a search it cut short (and, when the candidates ended exactly
// at the cap, it does not say so). Pure: the tools hand in the page reader
// and the access filter.

export async function collectReadable<T extends { id: string }>(o: {
  /** Readable rows wanted. */
  limit: number;
  /** Rows read per page. */
  batch: number;
  /** Hard cap on rows ever read. */
  maxScan: number;
  /** The next page after `after` (null: the first), newest first, a stable order. */
  page: (after: T | null, take: number) => Promise<T[]>;
  /** The rows of one page the person may open (and that pass the other filters). */
  keep: (rows: T[]) => Promise<T[]>;
}): Promise<{ rows: T[]; scanned: number; capped: boolean }> {
  const out: T[] = [];
  const seen = new Set<string>();
  let after: T | null = null;
  let scanned = 0;
  while (out.length < o.limit && scanned < o.maxScan) {
    const take = Math.min(o.batch, o.maxScan - scanned);
    const got = await o.page(after, take);
    scanned += got.length;
    // Row by row, so a row repeated within one page (a row updated while the
    // pages are read) is kept once, as one repeated across pages is.
    const fresh: T[] = [];
    for (const r of got) {
      if (seen.has(r.id)) continue;
      seen.add(r.id);
      fresh.push(r);
    }
    for (const r of await o.keep(fresh)) if (out.length < o.limit) out.push(r);
    if (got.length < take) return { rows: out, scanned, capped: false };
    after = got[got.length - 1];
  }
  if (out.length >= o.limit) return { rows: out, scanned, capped: false };
  // The cap was reached on a full page: one more row says whether any
  // candidate was left unread, or the candidates ended right at the cap.
  const more = after ? await o.page(after, 1) : [];
  return { rows: out, scanned, capped: more.length > 0 };
}

/**
 * The rows after `after` in the (updatedAt desc, id desc) order the tools
 * page by. A keyset on the values already read, not a cursor on the last
 * row's id: a row that changed, was archived or left mid-scan never makes
 * the next page skip a row or come back empty.
 */
export function olderThan(after: { id: string; updatedAt: Date } | null) {
  return after ? { OR: [{ updatedAt: { lt: after.updatedAt } }, { updatedAt: after.updatedAt, id: { lt: after.id } }] } : {};
}

/** A model-supplied row limit as a whole number in 1..max (the fallback when it is not a number). */
export function clampLimit(raw: unknown, fallback: number, max: number): number {
  const n = Math.floor(Number(raw ?? fallback));
  return Number.isFinite(n) ? Math.max(1, Math.min(max, n)) : fallback;
}
