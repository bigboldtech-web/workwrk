"use client";

/* Finance · Accounting Periods — fiscal calendar ribbon.
 *
 * Vertical timeline of every accounting period grouped by fiscal year.
 * Each period shows its label, date span, status (Open / Closed),
 * journal-entry count, and a close/reopen action.
 *
 * Reads:  GET   /api/accounting-periods
 * Writes: PATCH /api/accounting-periods/[id]  { action: "close"|"reopen" }
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { CalendarRange, Lock, Unlock, FileCheck2, AlertTriangle } from "lucide-react";
import { useOsShell } from "@/components/layout/os/shell-context";
import { useOsToast } from "@/components/layout/os/toast";

type Status = "OPEN" | "LOCKED" | "CLOSED" | "REOPENED";
type ApiPeriod = {
  id: string;
  label: string;
  startDate: string;
  endDate: string;
  status: Status;
  closedAt?: string | null;
  fiscalYear?: { id: string; label: string; startDate: string; endDate: string } | null;
  _count?: { journalEntries?: number };
};

const STATUS_HUE: Record<Status, string> = {
  OPEN: "var(--os-c-green)", LOCKED: "var(--os-c-orange)",
  CLOSED: "var(--os-c-darkgray)", REOPENED: "var(--os-c-purple)",
};
const STATUS_LABEL: Record<Status, string> = {
  OPEN: "Open", LOCKED: "Locked", CLOSED: "Closed", REOPENED: "Reopened",
};

function fmtSpan(start: string, end: string): string {
  const s = new Date(start), e = new Date(end);
  return `${s.toLocaleDateString("en-US", { month: "short", day: "numeric" })} → ${e.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}`;
}
function isCurrent(p: ApiPeriod): boolean {
  const now = Date.now();
  return new Date(p.startDate).getTime() <= now && now <= new Date(p.endDate).getTime();
}

export default function PeriodsPage() {
  const [periods, setPeriods] = useState<ApiPeriod[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const { rowVersion } = useOsShell();
  const { toast } = useOsToast();

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/accounting-periods");
      if (res.status === 403) { setLoadError("Org-admin access required."); return; }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setPeriods(data.data ?? (Array.isArray(data) ? data : []));
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "load failed");
    }
  }, []);
  useEffect(() => { void load(); }, [load]);
  const v = rowVersion("financials");
  useEffect(() => { if (v > 0) void load(); }, [v, load]);

  async function act(id: string, action: "close" | "reopen") {
    try {
      const res = await fetch(`/api/accounting-periods/${id}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action }),
      });
      if (!res.ok) throw new Error(`PATCH ${res.status}`);
      toast(action === "close" ? "Period closed" : "Period reopened");
      void load();
    } catch { toast("Couldn't update period"); }
  }

  const grouped = useMemo(() => {
    const m = new Map<string, { fy: string; periods: ApiPeriod[] }>();
    for (const p of periods ?? []) {
      const k = p.fiscalYear?.label ?? "Unassigned";
      if (!m.has(k)) m.set(k, { fy: k, periods: [] });
      m.get(k)!.periods.push(p);
    }
    return Array.from(m.values()).sort((a, b) => b.fy.localeCompare(a.fy));
  }, [periods]);

  const total = periods?.length ?? 0;
  const openCount = (periods ?? []).filter((p) => p.status === "OPEN" || p.status === "REOPENED").length;
  const closedCount = (periods ?? []).filter((p) => p.status === "CLOSED" || p.status === "LOCKED").length;

  return (
    <div className="periods">
      <header className="periods__head">
        <div className="periods__head-l">
          <div className="periods__icon"><CalendarRange /></div>
          <div>
            <h1 className="periods__title">Accounting periods</h1>
            <div className="periods__sub">{periods === null ? "Loading…" : `${total} period${total === 1 ? "" : "s"} · ${openCount} open · ${closedCount} closed · ${grouped.length} fiscal year${grouped.length === 1 ? "" : "s"}`}</div>
          </div>
        </div>
        <p className="periods__caption">Closing a period freezes every entry inside it. Reopen is allowed but is recorded on the audit log.</p>
      </header>

      {loadError ? (
        <div className="periods__error">{loadError}</div>
      ) : periods === null ? (
        <div style={{ padding: 60, textAlign: "center", color: "var(--os-ink-3)", fontSize: 13 }}>Loading…</div>
      ) : grouped.length === 0 ? (
        <div className="periods__empty">
          <CalendarRange />
          <div>
            <h3>No fiscal year set up yet</h3>
            <p>Configure your fiscal year in Settings → Profile, then the system seeds monthly accounting periods for you.</p>
          </div>
        </div>
      ) : (
        <div className="periods__years">
          {grouped.map((g) => (
            <section key={g.fy} className="periods__year">
              <header className="periods__year-head">
                <h2>{g.fy}</h2>
                <span>{g.periods.length} periods</span>
              </header>
              <div className="periods__ribbon">
                {g.periods.map((p) => {
                  const current = isCurrent(p);
                  const isOpen = p.status === "OPEN" || p.status === "REOPENED";
                  const entries = p._count?.journalEntries ?? 0;
                  return (
                    <article key={p.id} className={`period ${current ? "is-current" : ""}`}>
                      <header className="period__head">
                        <span className="period__label">{p.label}</span>
                        <span className="period__status" style={{ background: STATUS_HUE[p.status] }}>{STATUS_LABEL[p.status]}</span>
                      </header>
                      <div className="period__span">{fmtSpan(p.startDate, p.endDate)}</div>
                      <div className="period__entries">
                        <FileCheck2 /> {entries} journal entr{entries === 1 ? "y" : "ies"}
                      </div>
                      {current && <div className="period__current">Current period</div>}
                      {p.closedAt && <div className="period__closed">Closed {new Date(p.closedAt).toLocaleDateString()}</div>}
                      <div className="period__actions">
                        {isOpen ? (
                          <button type="button" className="period__btn period__btn--close" onClick={() => act(p.id, "close")}>
                            <Lock /> Close period
                          </button>
                        ) : (
                          <button type="button" className="period__btn period__btn--reopen" onClick={() => act(p.id, "reopen")}>
                            <Unlock /> Reopen
                          </button>
                        )}
                      </div>
                      {!isOpen && entries === 0 ? (
                        <div className="period__warn"><AlertTriangle /> Closed with no entries posted</div>
                      ) : null}
                    </article>
                  );
                })}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
