"use client";

/* Finance · Journal Entries — double-entry ledger with KPI strip + status filters.
 *
 * Each row expands to its balanced debit/credit lines. Status pills surface
 * Draft / Posted / Reversed. Search filters by ref, description, or period.
 *
 * Reads: GET /api/journal-entries?limit=200
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  BookText, ChevronRight, ChevronDown, FileCheck2, Search, Coins, Wallet,
  CheckCircle2, Clock, RotateCcw, Hash, Plus,
} from "lucide-react";
import { OsTitleBar } from "@/components/layout/os/title-bar";
import { OsEmptyView } from "@/components/layout/os/empty-view";
import { GRAD } from "@/components/layout/os/catalog";
import { useOsShell } from "@/components/layout/os/shell-context";
import { useOsToast } from "@/components/layout/os/toast";

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
const STATUS_ICON: Record<EntryStatus, typeof Clock> = {
  DRAFT: Clock, POSTED: CheckCircle2, REVERSED: RotateCcw,
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
  const [search, setSearch] = useState("");
  const { rowVersion } = useOsShell();
  const { toast } = useOsToast();

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/journal-entries?limit=200");
      if (res.status === 403) { setLoadError("Org-admin access required to view journal entries."); return; }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setEntries(data.data ?? (Array.isArray(data) ? data : []));
      setLoadError(null);
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

  const stats = useMemo(() => {
    const list = entries ?? [];
    const draft = list.filter((e) => e.status === "DRAFT").length;
    const posted = list.filter((e) => e.status === "POSTED").length;
    const reversed = list.filter((e) => e.status === "REVERSED").length;
    const now = new Date();
    const postedMonth = list.filter((e) => {
      if (e.status !== "POSTED") return false;
      const d = new Date(e.postedAt);
      return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
    }).length;
    return { total: list.length, draft, posted, reversed, postedMonth };
  }, [entries]);

  const filtered = useMemo(() => {
    let list = entries ?? [];
    if (filter !== "ALL") list = list.filter((e) => e.status === filter);
    const q = search.trim().toLowerCase();
    if (q) list = list.filter((e) =>
      e.description.toLowerCase().includes(q) ||
      (e.refNumber ?? "").toLowerCase().includes(q) ||
      (e.period?.label ?? "").toLowerCase().includes(q));
    return list;
  }, [entries, filter, search]);

  return (
    <>
      <OsTitleBar
        title="Journal entries"
        Icon={BookText}
        iconGradient={GRAD.indigoBlue}
        description={entries === null ? "Loading…" : `${stats.total} entr${stats.total === 1 ? "y" : "ies"} · ${stats.draft} draft · ${stats.posted} posted · ${stats.postedMonth} this month`}
        actions={
          <div className="jrn__head-actions">
            <Link href="/financials" className="jrn__nav-link"><Coins /> Finance</Link>
            <Link href="/financials/accounts" className="jrn__nav-link"><Wallet /> COA</Link>
            <button type="button" className="jrn__btn-primary" onClick={() => toast("Open the entry composer to post a new line set")}>
              <Plus /> New entry
            </button>
          </div>
        }
      />

      <div className="jrn">
        <div className="jrn__kpis">
          <KpiTile accent="var(--os-c-indigo)" Icon={BookText}    label="Total entries"  value={`${stats.total}`}       sub="all statuses" />
          <KpiTile accent="var(--os-c-green)"  Icon={CheckCircle2} label="Posted"         value={`${stats.posted}`}      sub={`${stats.postedMonth} this month`} />
          <KpiTile accent="var(--os-c-orange)" Icon={Clock}        label="Draft"          value={`${stats.draft}`}       sub="awaiting post" />
          <KpiTile accent="var(--os-c-red)"    Icon={RotateCcw}    label="Reversed"       value={`${stats.reversed}`}    sub="corrections" />
        </div>

        <div className="jrn__toolbar">
          <div className="jrn__search">
            <Search />
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search description, ref, period…" />
          </div>
          <div className="jrn__filters">
            {(["ALL", "DRAFT", "POSTED", "REVERSED"] as const).map((s) => (
              <button
                key={s}
                type="button"
                className={`jrn__filter${filter === s ? " is-active" : ""}`}
                style={s !== "ALL" ? { ["--f-c" as unknown as string]: STATUS_COLOR[s as EntryStatus] } : undefined}
                onClick={() => setFilter(s)}
              >
                {s === "ALL" ? <Hash /> : (() => { const I = STATUS_ICON[s as EntryStatus]; return <I />; })()}
                {s === "ALL" ? "All" : STATUS_LABEL[s as EntryStatus]}
                <span className="jrn__filter-n">
                  {s === "ALL" ? stats.total : s === "DRAFT" ? stats.draft : s === "POSTED" ? stats.posted : stats.reversed}
                </span>
              </button>
            ))}
          </div>
        </div>

        {loadError ? (
          <OsEmptyView Icon={BookText} iconGradient={GRAD.redPink} title="Couldn't load entries" subtitle={loadError} cta="Retry" />
        ) : entries === null ? (
          <div className="jrn__loading">Loading…</div>
        ) : stats.total === 0 ? (
          <OsEmptyView
            Icon={BookText}
            iconGradient={GRAD.indigoBlue}
            title="No journal entries yet"
            subtitle="Manual entries post against your chart of accounts. Drafts wait for approval before posting."
            chips={["Draft", "Posted", "Reversed"]}
            cta="Compose entry"
          />
        ) : filtered.length === 0 ? (
          <div className="jrn__no-match"><FileCheck2 /> No entries match the current filter.</div>
        ) : (
          <div className="jrn__table">
            <div className="jrn__row jrn__row--head">
              <div></div>
              <div>Posted</div>
              <div>Ref</div>
              <div>Description</div>
              <div>Period</div>
              <div className="text-right">Lines</div>
              <div>Status</div>
            </div>

            {filtered.map((e) => {
              const isOpen = expanded.has(e.id);
              const lines = linesById[e.id] ?? [];
              const totalDebit = lines.reduce((acc, l) => acc + (l.debitAccount ? num(l.amount) : 0), 0);
              const totalCredit = lines.reduce((acc, l) => acc + (l.creditAccount ? num(l.amount) : 0), 0);
              const StatusIcon = STATUS_ICON[e.status];
              return (
                <div key={e.id} className="jrn__entry">
                  <button type="button" className={`jrn__row${isOpen ? " is-open" : ""}`} onClick={() => toggle(e.id)}>
                    <span className="jrn__caret">{isOpen ? <ChevronDown /> : <ChevronRight />}</span>
                    <span className="jrn__date">{new Date(e.postedAt).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" })}</span>
                    <span className="jrn__ref">{e.refNumber ?? <em>—</em>}</span>
                    <span className="jrn__desc">{e.description}</span>
                    <span className="jrn__period">{e.period?.label ?? "—"}</span>
                    <span className="jrn__count text-right">{e._count?.lines ?? lines.length ?? "—"}</span>
                    <span className="jrn__status" style={{ ["--s-c" as unknown as string]: STATUS_COLOR[e.status] }}>
                      <StatusIcon /> {STATUS_LABEL[e.status]}
                    </span>
                  </button>
                  {isOpen && (
                    <div className="jrn__lines">
                      {lines.length === 0 ? (
                        <div className="jrn__lines-loading">Loading lines…</div>
                      ) : (
                        <>
                          <div className="jrn__line jrn__line--head">
                            <span>Account</span>
                            <span className="text-right">Debit</span>
                            <span className="text-right">Credit</span>
                            <span>Memo</span>
                          </div>
                          {lines.map((l) => {
                            const acct = l.debitAccount ?? l.creditAccount;
                            return (
                              <div key={l.id} className="jrn__line">
                                <span className="jrn__line-acct">
                                  <code>{acct?.code ?? "—"}</code>
                                  <span>{acct?.name ?? "—"}</span>
                                </span>
                                <span className="jrn__line-num">{l.debitAccount ? money(num(l.amount)) : ""}</span>
                                <span className="jrn__line-num">{l.creditAccount ? money(num(l.amount)) : ""}</span>
                                <span className="jrn__line-memo">{l.description ?? ""}</span>
                              </div>
                            );
                          })}
                          <div className="jrn__line jrn__line--foot">
                            <span><strong>Totals</strong></span>
                            <span className="jrn__line-num"><strong>{money(totalDebit)}</strong></span>
                            <span className="jrn__line-num"><strong>{money(totalCredit)}</strong></span>
                            <span className={`jrn__balance ${Math.abs(totalDebit - totalCredit) < 0.01 ? "is-balanced" : "is-off"}`}>
                              {Math.abs(totalDebit - totalCredit) < 0.01 ? "balanced ✓" : "UNBALANCED"}
                            </span>
                          </div>
                        </>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </>
  );
}

function KpiTile({ accent, Icon, label, value, sub }: { accent: string; Icon: typeof BookText; label: string; value: string; sub: string }) {
  return (
    <div className="jrn__kpi" style={{ ["--kpi-accent" as unknown as string]: accent }}>
      <span className="jrn__kpi-accent" aria-hidden="true" />
      <div className="jrn__kpi-row">
        <div className="jrn__kpi-icon"><Icon /></div>
        <div className="jrn__kpi-label">{label}</div>
      </div>
      <div className="jrn__kpi-value">{value}</div>
      <div className="jrn__kpi-sub">{sub}</div>
    </div>
  );
}
