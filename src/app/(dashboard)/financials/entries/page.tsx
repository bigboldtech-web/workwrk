"use client";

/* Finance · Journal Entries — double-entry ledger.
 *
 * Each entry is one transaction, expanding to show its balanced lines
 * (debits = credits). The ledger reads like accounting paper: posted
 * date, ref #, description, total amount, status pill (Draft / Posted /
 * Reversed). Click any row to expand the lines under it inline.
 *
 * Reads: GET /api/journal-entries?limit=100
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { BookText, ChevronRight, ChevronDown, FileCheck2 } from "lucide-react";
import { useOsShell } from "@/components/layout/os/shell-context";

type EntryStatus = "DRAFT" | "POSTED" | "REVERSED";
type ApiLine = {
  id: string;
  amount: number | string;
  description?: string | null;
  debitAccount?: { id: string; code: string; name: string } | null;
  creditAccount?: { id: string; code: string; name: string } | null;
};
type ApiEntry = {
  id: string;
  refNumber?: string | null;
  description: string;
  status: EntryStatus;
  postedAt: string;
  period?: { id: string; label: string } | null;
  _count?: { lines?: number };
  lines?: ApiLine[];
};

const STATUS_COLOR: Record<EntryStatus, string> = {
  DRAFT: "var(--os-c-orange)", POSTED: "var(--os-c-green)", REVERSED: "var(--os-c-red)",
};
const STATUS_LABEL: Record<EntryStatus, string> = {
  DRAFT: "Draft", POSTED: "Posted", REVERSED: "Reversed",
};

function num(v?: number | string | null): number {
  if (v == null) return 0;
  return typeof v === "string" ? parseFloat(v) : v;
}
function money(n: number): string {
  return new Intl.NumberFormat(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);
}

export default function JournalEntriesPage() {
  const [entries, setEntries] = useState<ApiEntry[] | null>(null);
  const [linesById, setLinesById] = useState<Record<string, ApiLine[]>>({});
  const [loadError, setLoadError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [filter, setFilter] = useState<"ALL" | EntryStatus>("ALL");
  const { rowVersion } = useOsShell();

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/journal-entries?limit=200");
      if (res.status === 403) { setLoadError("Org-admin access required to view journal entries."); return; }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setEntries(data.data ?? (Array.isArray(data) ? data : []));
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "load failed");
    }
  }, []);
  useEffect(() => { void load(); }, [load]);
  const v = rowVersion("financials");
  useEffect(() => { if (v > 0) void load(); }, [v, load]);

  async function loadLines(entryId: string) {
    if (linesById[entryId]) return;
    try {
      const res = await fetch(`/api/journal-entries/${entryId}`);
      if (!res.ok) return;
      const data = await res.json();
      const e = data.data ?? data;
      setLinesById((m) => ({ ...m, [entryId]: e.lines ?? [] }));
    } catch { /* ignore */ }
  }

  function toggle(id: string) {
    setExpanded((prev) => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id);
      else { n.add(id); void loadLines(id); }
      return n;
    });
  }

  const filtered = useMemo(() => {
    if (filter === "ALL") return entries ?? [];
    return (entries ?? []).filter((e) => e.status === filter);
  }, [entries, filter]);

  const total = entries?.length ?? 0;
  const draftCount = (entries ?? []).filter((e) => e.status === "DRAFT").length;
  const postedCount = (entries ?? []).filter((e) => e.status === "POSTED").length;
  const postedThisMonth = (entries ?? []).filter((e) => {
    if (e.status !== "POSTED") return false;
    const d = new Date(e.postedAt);
    const now = new Date();
    return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
  }).length;

  return (
    <div className="ledger">
      <header className="ledger__head">
        <div className="ledger__head-l">
          <div className="ledger__icon"><BookText /></div>
          <div>
            <h1 className="ledger__title">Journal entries</h1>
            <div className="ledger__sub">{entries === null ? "Loading…" : `${total} entries · ${draftCount} draft · ${postedCount} posted · ${postedThisMonth} posted this month`}</div>
          </div>
        </div>
        <div className="ledger__filters">
          {(["ALL", "DRAFT", "POSTED", "REVERSED"] as const).map((s) => (
            <button key={s} type="button" className={filter === s ? "is-active" : ""} onClick={() => setFilter(s)}>
              {s === "ALL" ? "All" : STATUS_LABEL[s]}
            </button>
          ))}
        </div>
      </header>

      {loadError ? (
        <div className="ledger__error">{loadError}</div>
      ) : entries === null ? (
        <div style={{ padding: 60, textAlign: "center", color: "var(--os-ink-3)", fontSize: 13 }}>Loading…</div>
      ) : (
        <div className="ledger__table">
          <div className="ledger__row ledger__row--head">
            <div></div>
            <div>Posted</div>
            <div>Ref</div>
            <div>Description</div>
            <div>Period</div>
            <div className="text-right">Amount</div>
            <div>Status</div>
          </div>

          {filtered.length === 0 ? (
            <div className="ledger__empty">
              <FileCheck2 />
              <h3>{filter === "ALL" ? "No journal entries yet" : `No ${STATUS_LABEL[filter as EntryStatus].toLowerCase()} entries`}</h3>
              <p>Manual entries post against your chart of accounts. Drafts wait for approval before posting.</p>
            </div>
          ) : filtered.map((e) => {
            const isOpen = expanded.has(e.id);
            const lines = linesById[e.id] ?? [];
            const totalDebit = lines.reduce((acc, l) => acc + (l.debitAccount ? num(l.amount) : 0), 0);
            const totalCredit = lines.reduce((acc, l) => acc + (l.creditAccount ? num(l.amount) : 0), 0);
            return (
              <div key={e.id}>
                <button type="button" className={`ledger__row ${isOpen ? "is-open" : ""}`} onClick={() => toggle(e.id)}>
                  <span className="ledger__caret">{isOpen ? <ChevronDown /> : <ChevronRight />}</span>
                  <span className="ledger__date">{new Date(e.postedAt).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" })}</span>
                  <span className="ledger__ref">{e.refNumber ?? <em style={{ color: "var(--os-ink-3)" }}>—</em>}</span>
                  <span className="ledger__desc">{e.description}</span>
                  <span className="ledger__period">{e.period?.label ?? "—"}</span>
                  <span className="ledger__amt">—</span>
                  <span className="ledger__status" style={{ background: STATUS_COLOR[e.status] }}>{STATUS_LABEL[e.status]}</span>
                </button>
                {isOpen ? (
                  <div className="ledger__lines">
                    {lines.length === 0 ? (
                      <div className="ledger__lines-loading">Loading lines…</div>
                    ) : (
                      <>
                        <div className="ledger__line ledger__line--head">
                          <span>Account</span>
                          <span className="text-right">Debit</span>
                          <span className="text-right">Credit</span>
                          <span>Memo</span>
                        </div>
                        {lines.map((l) => {
                          const acct = l.debitAccount ?? l.creditAccount;
                          return (
                            <div key={l.id} className="ledger__line">
                              <span className="ledger__line-acct">
                                <code>{acct?.code ?? "—"}</code>
                                <span>{acct?.name ?? "—"}</span>
                              </span>
                              <span className="ledger__line-num">{l.debitAccount ? money(num(l.amount)) : ""}</span>
                              <span className="ledger__line-num">{l.creditAccount ? money(num(l.amount)) : ""}</span>
                              <span className="ledger__line-memo">{l.description ?? ""}</span>
                            </div>
                          );
                        })}
                        <div className="ledger__line ledger__line--foot">
                          <span><strong>Totals</strong></span>
                          <span className="ledger__line-num"><strong>{money(totalDebit)}</strong></span>
                          <span className="ledger__line-num"><strong>{money(totalCredit)}</strong></span>
                          <span>{Math.abs(totalDebit - totalCredit) < 0.01 ? <em style={{ color: "var(--os-c-green)" }}>balanced ✓</em> : <em style={{ color: "var(--os-c-red)" }}>UNBALANCED</em>}</span>
                        </div>
                      </>
                    )}
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
