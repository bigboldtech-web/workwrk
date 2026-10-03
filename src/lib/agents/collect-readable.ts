// Ask AI's list tools read candidates newest first and keep the ones the
// person may open. Reading one fixed batch (limit x 4, or the newest 200)
// and filtering it could leave a narrow reader with nothing while readable
// rows existed further down: the newest tasks of a big workspace may all sit
// in Lists they cannot open. collectReadable pages through the candidates in
// batches until it has `limit` readable rows, the candidates run out, or a
// hard cap is reached; at the cap it says so, so the assistant never answers
// "none" for a search it cut short. Pure: the tools hand in the page reader
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
  return { rows: out, scanned, capped: out.length < o.limit };
}

/** A model-supplied row limit as a whole number in 1..max (the fallback when it is not a number). */
export function clampLimit(raw: unknown, fallback: number, max: number): number {
  const n = Math.floor(Number(raw ?? fallback));
  return Number.isFinite(n) ? Math.max(1, Math.min(max, n)) : fallback;
}
