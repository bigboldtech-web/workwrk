"use client";

// TableEmbedTable (spec-tables-forms section 3): the read-only bordered card the
// public embed renders. Name-or-letter headers, computed values from the
// server, numbers right aligned, and a paging footer. No actions: an embed
// has nothing to activate, so the only focus stop is the scroll container.

import { ChevronLeft, ChevronRight } from "lucide-react";
import { formatCount, formatRelative } from "@/lib/format/date";

export interface EmbedTablePage {
  columns: { id: string; name: string; type: string; align: "left" | "right" | "center" }[];
  rows: { id: string; cells: string[] }[];
  start: number;
  total: number;
  updatedAt?: string | null;
}

const ALIGN = { left: "text-left", right: "text-right", center: "text-center" } as const;

export function TableEmbedTable({
  page, onPrev, onNext, busy,
}: {
  page: EmbedTablePage;
  onPrev?: () => void;
  onNext?: () => void;
  busy?: boolean;
}) {
  const from = page.total === 0 ? 0 : page.start + 1;
  const to = page.start + page.rows.length;
  const paged = page.total > page.rows.length;
  return (
    <div className="overflow-hidden rounded-lg border border-line bg-raised">
      <div className="overflow-x-auto" tabIndex={0} aria-label="Table data">
        <table className="w-full border-collapse text-base">
          {/* No columns, no header. The server trims a fresh table to the
              columns that hold data, so a table made public before anything
              is typed arrives with none. A header row with no cells still
              keeps its h-9 height and reads as a blank band above the empty
              state, so it is left out and "No rows yet" stands alone. */}
          {page.columns.length > 0 ? (
            <thead>
              <tr className="h-9 bg-subtle">
                {page.columns.map((c) => (
                  <th key={c.id} scope="col" className={`whitespace-nowrap border-b border-line px-3 text-sm font-medium text-ink-2 ${ALIGN[c.align]}`}>
                    {c.name}
                  </th>
                ))}
              </tr>
            </thead>
          ) : null}
          <tbody aria-busy={busy || undefined}>
            {page.rows.length === 0 ? (
              <tr className="h-9">
                <td colSpan={Math.max(1, page.columns.length)} className="px-3 text-base text-ink-2">No rows yet</td>
              </tr>
            ) : page.rows.map((r) => (
              <tr key={r.id} className="h-8 border-b border-line-soft last:border-b-0">
                {page.columns.map((c, i) => (
                  <td key={c.id} className={`max-w-[320px] truncate px-3 text-ink ${c.align === "right" ? "tabular-nums" : ""} ${ALIGN[c.align]}`} title={r.cells[i] || undefined}>
                    {r.cells[i]}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="flex h-9 items-center gap-3 border-t border-line px-3 text-sm text-ink-2">
        <span className="tabular-nums">{formatCount(page.total)} {page.total === 1 ? "row" : "rows"}</span>
        {page.updatedAt ? <span className="text-xs">Updated {formatRelative(page.updatedAt)}</span> : null}
        <span className="flex-1" />
        {paged ? (
          <>
            <span className="tabular-nums">{formatCount(from)} to {formatCount(to)}</span>
            <button type="button" onClick={onPrev} disabled={!onPrev || busy} aria-label="Previous page" className="inline-flex h-8 w-8 items-center justify-center rounded-md hover:bg-hover disabled:opacity-40">
              <ChevronLeft className="h-4 w-4" />
            </button>
            <button type="button" onClick={onNext} disabled={!onNext || busy} aria-label="Next page" className="inline-flex h-8 w-8 items-center justify-center rounded-md hover:bg-hover disabled:opacity-40">
              <ChevronRight className="h-4 w-4" />
            </button>
          </>
        ) : null}
      </div>
    </div>
  );
}
