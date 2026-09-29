// Read every page of a paginated list endpoint (lib/pagination.ts shape:
// { data: T[], pagination: { page, totalPages, hasMore, total } }), so a
// directory, an org chart or an entry grid never silently stops at the
// server's 500-row page. Client safe.
//
// A page that fails throws, so the caller shows its error state instead of
// a partial list presented as whole. `maxPages` is a runaway guard only
// (500 x 200 = 100,000 rows), never a product cap.

export async function fetchAllPages<T>(
  url: string,
  opts: { pageSize?: number; maxPages?: number; fetcher?: typeof fetch; init?: RequestInit } = {},
): Promise<{ items: T[]; total: number }> {
  const pageSize = Math.min(500, Math.max(1, opts.pageSize ?? 500));
  const maxPages = opts.maxPages ?? 200;
  const doFetch = opts.fetcher ?? fetch;
  const sep = url.includes("?") ? "&" : "?";
  const items: T[] = [];
  let total = 0;
  for (let page = 1; page <= maxPages; page += 1) {
    const res = await doFetch(`${url}${sep}limit=${pageSize}&page=${page}`, opts.init);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const body = (await res.json()) as { data?: unknown; pagination?: { hasMore?: boolean; total?: number } } | unknown[];
    if (Array.isArray(body)) return { items: body as T[], total: body.length };
    const rows = Array.isArray(body?.data) ? (body.data as T[]) : [];
    items.push(...rows);
    total = body?.pagination?.total ?? items.length;
    if (!body?.pagination?.hasMore || rows.length === 0) break;
  }
  return { items, total };
}
