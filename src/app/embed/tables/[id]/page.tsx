"use client";

/* /embed/tables/[id] (spec-tables-forms section 2): a read-only view of a table
 * for a page outside WorkwrK.
 *
 * The server computes everything (GET /api/public/tables/[id]): the engine
 * evaluates every row, formula cells arrive as their values and never as
 * "[object Object]", headers arrive as names with the letter as fallback, and
 * rows arrive a page at a time instead of under a silent 5,000-row cap. This
 * page only draws what it is given, in tokens, following the viewer's colour
 * scheme. Denied (link off, public links off for the org, module off, deleted,
 * wrong id) is one neutral line that names nothing.
 */

import "@/app/(dashboard)/tokens.css";
import "@/app/(dashboard)/os.css";
import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { TableEmbedTable, type EmbedTablePage } from "@/components/tables/table-embed-table";

type Loaded = EmbedTablePage & { name: string; description: string | null; nextCursor: string | null };

const PAGE = 200;

export default function TableEmbedPage() {
  const { id } = useParams<{ id: string }>();
  const [state, setState] = useState<"loading" | "ready" | "invalid" | "error">("loading");
  const [data, setData] = useState<Loaded | null>(null);
  const [busy, setBusy] = useState(false);
  // A page turn that failed, and the offset it asked for. Kept apart from
  // `state` so a failed Next leaves the page the viewer is reading on screen
  // and Retry asks for the page they wanted, not page 1.
  const [pageError, setPageError] = useState<{ start: number } | null>(null);

  const load = useCallback(async (start: number, showBusy = true) => {
    if (!id) return;
    // The first load renders the skeleton; paging marks the table busy.
    if (showBusy) setBusy(true);
    setPageError(null);
    // Only a page turn has a table on screen to keep. The first load, and the
    // full card's Retry (both showBusy=false), still fall to the error card.
    const fail = () => { if (showBusy) setPageError({ start }); else setState("error"); };
    try {
      const res = await fetch(`/api/public/tables/${encodeURIComponent(id)}?cursor=${start}&limit=${PAGE}`);
      // A 404 is the link going off (or the table going away) mid-read, so it
      // replaces the table on a page turn too: nothing may stay shown.
      if (res.status === 404) { setState("invalid"); return; }
      if (!res.ok) { console.warn(`table embed load failed: HTTP ${res.status}`); fail(); return; }
      const d = await res.json();
      setData({
        name: typeof d.name === "string" ? d.name : "",
        description: typeof d.description === "string" && d.description.trim() ? d.description : null,
        columns: Array.isArray(d.columns) ? d.columns : [],
        rows: Array.isArray(d.rows) ? d.rows : [],
        start: typeof d.start === "number" ? d.start : 0,
        total: typeof d.total === "number" ? d.total : 0,
        updatedAt: typeof d.updatedAt === "string" ? d.updatedAt : null,
        nextCursor: typeof d.nextCursor === "string" ? d.nextCursor : null,
      });
      setState("ready");
    } catch (e) {
      console.warn("table embed load failed", e);
      fail();
    } finally {
      setBusy(false);
    }
  }, [id]);

  useEffect(() => { void load(0, false); }, [load]);

  return (
    <div className="os-chrome min-h-screen bg-app p-4 text-ink">
      {state === "loading" ? (
        <div className="overflow-hidden rounded-lg border border-line bg-raised" aria-busy="true" aria-label="Loading">
          <div className="h-9 border-b border-line bg-subtle" />
          {Array.from({ length: 10 }).map((_, i) => (
            <div key={i} className="flex h-8 items-center border-b border-line-soft px-3 last:border-b-0">
              <span className="h-3 rounded bg-skeleton os-skeleton-pulse" style={{ width: ["60%", "40%", "80%"][i % 3] }} />
            </div>
          ))}
        </div>
      ) : state === "invalid" ? (
        <div className="rounded-lg border border-line bg-raised px-6 py-12 text-center">
          <p className="text-row text-ink">This link is invalid or has been turned off.</p>
        </div>
      ) : state === "error" || !data ? (
        <div className="rounded-lg border border-line bg-raised px-6 py-12 text-center">
          <p className="text-row text-ink">We could not load this table.</p>
          <button type="button" onClick={() => { setState("loading"); void load(0, false); }} className="mt-3 text-sm font-medium text-brand-deep hover:underline">Retry</button>
        </div>
      ) : (
        <>
          <h1 className="text-lg font-semibold text-ink">{data.name}</h1>
          {data.description ? <p className="mt-0.5 text-sm text-ink-2">{data.description}</p> : null}
          <div className="mt-3">
            <TableEmbedTable
              page={data}
              busy={busy}
              onPrev={data.start > 0 ? () => void load(Math.max(0, data.start - PAGE)) : undefined}
              onNext={data.nextCursor ? () => void load(Number(data.nextCursor)) : undefined}
            />
            {pageError ? (
              <p role="alert" className="mt-2 flex items-center justify-end gap-2 text-sm text-ink-2">
                Could not load rows.
                <button type="button" onClick={() => void load(pageError.start)} disabled={busy} className="font-medium text-brand-deep hover:underline disabled:opacity-40">Retry</button>
              </p>
            ) : null}
          </div>
        </>
      )}
      <p className="mt-3 text-center text-xs text-ink-3">
        <a href="https://workwrk.com" target="_blank" rel="noopener" className="hover:underline">Powered by WorkwrK</a>
      </p>
    </div>
  );
}
