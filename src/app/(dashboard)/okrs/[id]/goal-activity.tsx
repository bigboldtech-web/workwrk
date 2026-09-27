"use client";

// Activity card on the goal page (spec-goals /okrs/[id] body 7): every
// check-in, newest first, twelve at a time from GET /api/okrs/[id]/check-ins
// with Show more (the page used to print the latest twelve and stop). A row
// reads "{Target}: 30 to 42 units" with the note on a second line (the one
// wrap block here, at most two lines, full note in the tooltip) and
// "2d ago · Priya" at the right.

import { forwardRef, useCallback, useEffect, useState } from "react";
import { useFormat } from "@/lib/format/use-date-prefs";

interface CheckIn {
  id: string;
  value: number;
  previous: number | null;
  note: string | null;
  createdAt: string;
  target: { id: string; title: string; unit: string | null };
  by: { firstName: string | null; lastName: string | null; email: string } | null;
}

const num = (n: number) => (Number.isInteger(n) ? String(n) : String(Math.round(n * 100) / 100));

export const GoalActivity = forwardRef<HTMLElement, { okrId: string; refreshKey?: string }>(function GoalActivity({ okrId, refreshKey }, ref) {
  const fmt = useFormat();
  const [items, setItems] = useState<CheckIn[] | null>(null);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [total, setTotal] = useState(0);
  const [err, setErr] = useState(false);
  const [busy, setBusy] = useState(false);

  const fetchPage = useCallback(async (p: number) => {
    setBusy(true);
    setErr(false);
    try {
      const r = await fetch(`/api/okrs/${okrId}/check-ins?page=${p}`, { cache: "no-store" });
      if (!r.ok) throw new Error(String(r.status));
      const j = await r.json();
      const d = j.data ?? j;
      setItems((cur) => (p === 1 ? d.items : [...(cur ?? []), ...d.items]));
      setPage(p);
      setHasMore(Boolean(d.hasMore));
      setTotal(Number(d.total) || 0);
    } catch {
      setErr(true);
    } finally {
      setBusy(false);
    }
  }, [okrId]);
  useEffect(() => { void fetchPage(1); }, [fetchPage, refreshKey]);

  return (
    <section ref={ref} className="rounded-lg border border-line bg-raised p-6" aria-labelledby="goal-activity-h">
      <h2 id="goal-activity-h" className="m-0 flex items-baseline gap-2 text-base font-semibold text-ink">
        Activity {total ? <span className="text-xs font-medium text-ink-2">{total}</span> : null}
      </h2>
      {err && !items ? (
        <p className="m-0 mt-3 text-sm text-ink-2">Couldn&apos;t load activity · <button type="button" onClick={() => void fetchPage(1)} className="text-brand-deep hover:underline">Retry</button></p>
      ) : !items ? (
        <div className="mt-3 flex flex-col gap-2" aria-hidden>
          {[0, 1, 2].map((i) => <span key={i} className="h-5 animate-pulse rounded bg-surface-2" />)}
        </div>
      ) : items.length === 0 ? (
        <p className="m-0 mt-3 text-row text-ink-2">No check-ins yet</p>
      ) : (
        <>
          <ol className="m-0 mt-2 flex list-none flex-col p-0">
            {items.map((c) => {
              const who = c.by ? `${c.by.firstName ?? ""} ${c.by.lastName ?? ""}`.trim() || c.by.email : "Someone";
              const unit = c.target.unit?.trim();
              return (
                <li key={c.id} className="flex min-h-9 items-start gap-3 border-b border-line py-2 last:border-b-0">
                  <div className="min-w-0 flex-1">
                    <p className="m-0 truncate text-row text-ink">
                      {c.target.title}: {c.previous != null ? `${num(c.previous)} to ` : ""}{num(c.value)}{unit ? ` ${unit}` : ""}
                    </p>
                    {c.note ? <p className="m-0 line-clamp-2 text-sm text-ink-2" title={c.note}>{c.note}</p> : null}
                  </div>
                  <span className="shrink-0 text-xs text-ink-2" title={fmt.title(c.createdAt)}>{fmt.relative(c.createdAt)} · {who}</span>
                </li>
              );
            })}
          </ol>
          {hasMore ? (
            <button type="button" disabled={busy} onClick={() => void fetchPage(page + 1)} className="mt-2 text-sm text-brand-deep hover:underline disabled:opacity-60">Show more</button>
          ) : null}
          {err ? <p className="m-0 mt-1 text-sm text-danger-text">Couldn&apos;t load more. <button type="button" onClick={() => void fetchPage(page + 1)} className="underline">Retry</button></p> : null}
        </>
      )}
    </section>
  );
});
